import { randomUUID } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import { writeAudit } from "./audit.js";
import { pool, inTransaction } from "./db.js";
import { calculateExpenseTax, calculateInvoice, createInvoiceSchema, customerSchema, expenseSchema, paymentSchema, productSchema, supplierSchema, tenantSettingsSchema } from "./domain.js";
import { HttpError } from "./errors.js";
import { detectLetterheadMimeType, detectLogoMimeType } from "./branding.js";
import { createDeliveryNotePdf, createInvoicePdf, createReceiptPdf } from "./pdf.js";
import { addDays } from "./recurring-domain.js";
import { assertInvoiceCapacity, assertUserCapacity, requirePlanFeature } from "./subscriptions.js";
import { requirePermission } from "./tenant.js";

const router = Router();
const uuidSchema = z.string().uuid();
const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional().default(""),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const taxRangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({ code: "custom", path: ["from"], message: "The start date must be on or before the end date." });
  }
});
const deliveryNoteSchema = z.object({
  deliveryDate: z.string().date(),
  recipientName: z.string().trim().min(1).max(160),
  deliveryAddress: z.string().trim().max(500).optional().default(""),
  deliveredBy: z.string().trim().max(160).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  items: z.array(z.object({
    invoiceItemId: z.string().uuid(),
    quantity: z.number().finite().min(0).max(1_000_000)
      .refine((quantity) => Number.isInteger(quantity * 1000), "Quantity supports up to 3 decimal places."),
  })).min(1).max(100),
}).superRefine((value, context) => {
  if (!value.items.some((item) => item.quantity > 0)) {
    context.addIssue({ code: "custom", path: ["items"], message: "At least one delivered quantity must be greater than zero." });
  }
});

function routeId(value) {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "INVALID_ID", "The requested record ID is invalid.");
  return parsed.data;
}

function pageQuery(request) {
  return listQuerySchema.parse(request.query);
}

function csvCell(value) {
  let content = String(value ?? "");
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(value)) content = `'${content}`;
  return `"${content.replaceAll('"', '""')}"`;
}

function csvResponse(response, filename, headers, rows) {
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  response.status(200).type("text/csv").attachment(filename).send(`\uFEFF${content}\r\n`);
}

async function taxSummaryRows(tenantId, range) {
  const invoiceFilters = [];
  const invoiceParams = [tenantId];
  const expenseFilters = [];
  const expenseParams = [tenantId];
  for (const [field, operator] of [["from", ">="], ["to", "<="]]) {
    if (!range[field]) continue;
    invoiceFilters.push(`i.issue_date ${operator} ?`);
    invoiceParams.push(range[field]);
    expenseFilters.push(`e.expense_date ${operator} ?`);
    expenseParams.push(range[field]);
  }
  const [invoiceRows] = await pool.execute(
    `SELECT i.currency,
            SUM(GREATEST(0, i.tax_cents - CASE WHEN i.total_cents > 0
              THEN ROUND(i.tax_cents * LEAST(i.total_cents, COALESCE(credits.amount_cents, 0)) / i.total_cents)
              ELSE 0 END)) AS vatCollectedCents,
            COUNT(*) AS invoiceCount
     FROM invoices i
     LEFT JOIN (
       SELECT tenant_id, invoice_id, SUM(amount_cents) AS amount_cents
       FROM credit_notes WHERE status = 'issued' GROUP BY tenant_id, invoice_id
     ) credits ON credits.tenant_id = i.tenant_id AND credits.invoice_id = i.id
     WHERE i.tenant_id = ? AND i.status = 'issued'${invoiceFilters.length ? ` AND ${invoiceFilters.join(" AND ")}` : ""}
     GROUP BY i.currency`,
    invoiceParams,
  );
  const [expenseRows] = await pool.execute(
    `SELECT currency, SUM(tax_cents) AS vatPaidCents, COUNT(*) AS expenseCount
     FROM expenses e
     WHERE e.tenant_id = ? AND e.voided_at IS NULL${expenseFilters.length ? ` AND ${expenseFilters.join(" AND ")}` : ""}
     GROUP BY currency`,
    expenseParams,
  );
  const result = new Map();
  for (const row of invoiceRows) {
    result.set(row.currency, {
      currency: row.currency, vatCollectedCents: Number(row.vatCollectedCents ?? 0),
      vatPaidCents: 0, netVatCents: Number(row.vatCollectedCents ?? 0),
      invoiceCount: Number(row.invoiceCount), expenseCount: 0,
    });
  }
  for (const row of expenseRows) {
    const summary = result.get(row.currency) ?? {
      currency: row.currency, vatCollectedCents: 0, vatPaidCents: 0, netVatCents: 0, invoiceCount: 0, expenseCount: 0,
    };
    summary.vatPaidCents = Number(row.vatPaidCents ?? 0);
    summary.netVatCents = summary.vatCollectedCents - summary.vatPaidCents;
    summary.expenseCount = Number(row.expenseCount);
    result.set(row.currency, summary);
  }
  return [...result.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

function invoiceStatus(invoice) {
  if (invoice.status === "draft") return "draft";
  if (invoice.status === "void") return "void";
  const balance = Number(invoice.total_cents) - Number(invoice.amount_paid_cents) - Number(invoice.credited_cents ?? 0);
  if (balance <= 0) return "paid";
  if (invoice.due_date < new Date().toISOString().slice(0, 10)) return "overdue";
  return "pending";
}

function serializeInvoice(row) {
  const templateConfig = row.template_config_snapshot ?? row.template_config ?? null;
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    invoiceNumber: row.invoice_number,
    status: invoiceStatus(row),
    currency: row.currency,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    subtotalCents: Number(row.subtotal_cents),
    discountCents: Number(row.discount_cents),
    taxRateBps: row.tax_rate_bps,
    taxCents: Number(row.tax_cents),
    totalCents: Number(row.total_cents),
    amountPaidCents: Number(row.amount_paid_cents),
    creditedCents: Number(row.credited_cents ?? 0),
    balanceDueCents: Math.max(0, Number(row.total_cents) - Number(row.amount_paid_cents) - Number(row.credited_cents ?? 0)),
    notes: row.notes ?? "",
    terms: row.terms ?? "",
    templateId: row.template_id ?? null,
    templateName: row.template_name_snapshot ?? row.template_name ?? null,
    templateConfig: typeof templateConfig === "string" ? JSON.parse(templateConfig) : templateConfig,
    deliveryNoteId: row.delivery_note_id ?? null,
    deliveryNoteNumber: row.delivery_number ?? null,
    items: row.items ?? [],
    createdAt: row.created_at,
  };
}

async function invoiceRow(tenantId, invoiceId, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT i.*, dn.id AS delivery_note_id, dn.delivery_number,
            c.name AS customer_name, c.email AS customer_email,
            COALESCE((SELECT SUM(cn.amount_cents) FROM credit_notes cn
              WHERE cn.tenant_id = i.tenant_id AND cn.invoice_id = i.id AND cn.status = 'issued'), 0) AS credited_cents
     FROM invoices i
     INNER JOIN customers c ON c.tenant_id = i.tenant_id AND c.id = i.customer_id
     LEFT JOIN delivery_notes dn ON dn.tenant_id = i.tenant_id AND dn.invoice_id = i.id
     WHERE i.tenant_id = ? AND i.id = ?
     LIMIT 1`,
    [tenantId, invoiceId],
  );
  return rows[0] ?? null;
}

async function invoiceItems(tenantId, invoiceId, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id, product_id, description, quantity, unit_price_cents, discount_cents, tax_rate_bps, line_total_cents
     FROM invoice_items WHERE tenant_id = ? AND invoice_id = ? ORDER BY created_at, id`,
    [tenantId, invoiceId],
  );
  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    description: row.description,
    quantity: Number(row.quantity),
    unitPriceCents: Number(row.unit_price_cents),
    discountCents: Number(row.discount_cents),
    taxRateBps: row.tax_rate_bps,
    lineTotalCents: Number(row.line_total_cents),
  }));
}

async function getNextInvoiceNumber(connection, tenantId, year, prefix) {
  await connection.execute(
    "INSERT IGNORE INTO invoice_counters (tenant_id, invoice_year, last_number) VALUES (?, ?, 0)",
    [tenantId, year],
  );
  const [rows] = await connection.execute(
    "SELECT last_number FROM invoice_counters WHERE tenant_id = ? AND invoice_year = ? FOR UPDATE",
    [tenantId, year],
  );
  const next = Number(rows[0].last_number) + 1;
  if (!Number.isSafeInteger(next)) throw new HttpError(409, "INVOICE_SEQUENCE_EXHAUSTED", "The invoice number sequence is exhausted.");
  await connection.execute(
    "UPDATE invoice_counters SET last_number = ? WHERE tenant_id = ? AND invoice_year = ?",
    [next, tenantId, year],
  );
  return `${prefix}-${year}-${String(next).padStart(5, "0")}`;
}

router.get("/tenants/current", requirePermission("business:read"), async (request, response) => {
  const [rows] = await pool.execute(
    `SELECT id, name, email, phone, address, kra_pin AS kraPin, currency,
            tax_rate_bps AS taxRateBps, invoice_prefix AS invoicePrefix,
            invoice_layout AS invoiceLayout,
            IF(invoice_logo IS NULL, NULL, '/api/v1/tenants/current/logo') AS logoUrl,
            IF(invoice_letterhead IS NULL, NULL, '/api/v1/tenants/current/letterhead') AS letterheadUrl,
            invoice_letterhead_mime_type AS letterheadMimeType,
            created_at AS createdAt
     FROM tenants WHERE id = ? LIMIT 1`,
    [request.tenant.id],
  );
  response.json({ data: rows[0] });
});

router.patch("/tenants/current", requirePermission("business:update"), async (request, response) => {
  const input = tenantSettingsSchema.parse(request.body);
  const columns = {
    name: "name",
    email: "email",
    phone: "phone",
    address: "address",
    kraPin: "kra_pin",
    currency: "currency",
    taxRateBps: "tax_rate_bps",
    invoicePrefix: "invoice_prefix",
    invoiceLayout: "invoice_layout",
  };
  const entries = Object.entries(input);
  const [currentRows] = await pool.execute(
    "SELECT name, email, phone, address, invoice_logo FROM tenants WHERE id = ? LIMIT 1",
    [request.tenant.id],
  );
  const current = currentRows[0];
  if (!current) throw new HttpError(404, "BUSINESS_NOT_FOUND", "Business not found.");
  if (current.invoice_logo) {
    const profile = {
      name: input.name ?? current.name,
      email: input.email ?? current.email,
      phone: input.phone ?? current.phone,
      address: input.address ?? current.address,
    };
    if (Object.values(profile).some((value) => !String(value ?? "").trim())) {
      throw new HttpError(400, "BUSINESS_PROFILE_REQUIRED", "Complete the business name, email, phone number, and address before using a logo.");
    }
  }
  const assignments = entries.map(([key]) => `${columns[key]} = ?`).join(", ");
  await inTransaction(async (connection) => {
    await connection.execute(
      `UPDATE tenants SET ${assignments} WHERE id = ?`,
      [...entries.map(([, value]) => value || null), request.tenant.id],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "tenant.settings_updated",
      entityType: "tenant", entityId: request.tenant.id, details: { fields: entries.map(([key]) => key) },
    });
  });
  const [rows] = await pool.execute(
    `SELECT id, name, email, phone, address, kra_pin AS kraPin, currency,
            tax_rate_bps AS taxRateBps, invoice_prefix AS invoicePrefix,
            invoice_layout AS invoiceLayout,
            IF(invoice_logo IS NULL, NULL, '/api/v1/tenants/current/logo') AS logoUrl,
            IF(invoice_letterhead IS NULL, NULL, '/api/v1/tenants/current/letterhead') AS letterheadUrl,
            invoice_letterhead_mime_type AS letterheadMimeType,
            created_at AS createdAt
     FROM tenants WHERE id = ? LIMIT 1`,
    [request.tenant.id],
  );
  response.json({ data: rows[0] });
});

router.get("/tenants/current/logo", requirePermission("business:read"), async (request, response) => {
  const [rows] = await pool.execute(
    "SELECT invoice_logo AS logo, invoice_logo_mime_type AS mimeType FROM tenants WHERE id = ? LIMIT 1",
    [request.tenant.id],
  );
  const logo = rows[0];
  if (!logo?.logo) throw new HttpError(404, "BUSINESS_LOGO_NOT_FOUND", "This business has not uploaded a logo.");
  response.set({
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
  }).type(logo.mimeType).send(logo.logo);
});

router.put(
  "/tenants/current/logo",
  requirePermission("business:update"),
  express.raw({ type: () => true, limit: "2mb" }),
  async (request, response) => {
    const [businessRows] = await pool.execute(
      "SELECT name, email, phone, address FROM tenants WHERE id = ? LIMIT 1",
      [request.tenant.id],
    );
    const business = businessRows[0];
    if (!business || Object.values(business).some((value) => !String(value ?? "").trim())) {
      throw new HttpError(400, "BUSINESS_PROFILE_REQUIRED", "Complete the business name, email, phone number, and address before uploading a logo.");
    }
    let mimeType;
    try {
      mimeType = detectLogoMimeType(request.body);
    } catch (error) {
      throw new HttpError(400, "INVALID_BUSINESS_LOGO", error.message);
    }
    await inTransaction(async (connection) => {
      await connection.execute(
        "UPDATE tenants SET invoice_logo = ?, invoice_logo_mime_type = ?, invoice_letterhead = NULL, invoice_letterhead_mime_type = NULL WHERE id = ?",
        [request.body, mimeType, request.tenant.id],
      );
      await writeAudit(connection, {
        tenantId: request.tenant.id, userId: request.auth.userId, action: "tenant.logo_updated",
        entityType: "tenant", entityId: request.tenant.id, details: { mimeType, sizeBytes: request.body.length },
      });
    });
    response.json({ data: { logoUrl: "/api/v1/tenants/current/logo", mimeType } });
  },
);

router.delete("/tenants/current/logo", requirePermission("business:update"), async (request, response) => {
  await inTransaction(async (connection) => {
    const [result] = await connection.execute(
      "UPDATE tenants SET invoice_logo = NULL, invoice_logo_mime_type = NULL WHERE id = ?",
      [request.tenant.id],
    );
    if (result.affectedRows !== 1) throw new HttpError(404, "BUSINESS_NOT_FOUND", "Business not found.");
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "tenant.logo_removed",
      entityType: "tenant", entityId: request.tenant.id,
    });
  });
  response.status(204).end();
});

router.get("/tenants/current/letterhead", requirePermission("business:read"), async (request, response) => {
  const [rows] = await pool.execute(
    "SELECT invoice_letterhead AS letterhead, invoice_letterhead_mime_type AS mimeType FROM tenants WHERE id = ? LIMIT 1",
    [request.tenant.id],
  );
  const letterhead = rows[0];
  if (!letterhead?.letterhead) throw new HttpError(404, "BUSINESS_LETTERHEAD_NOT_FOUND", "This business has not uploaded a letterhead.");
  response.set({
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
  }).type(letterhead.mimeType).send(letterhead.letterhead);
});

router.put(
  "/tenants/current/letterhead",
  requirePermission("business:update"),
  express.raw({ type: () => true, limit: "5mb" }),
  async (request, response) => {
    let mimeType;
    try {
      mimeType = await detectLetterheadMimeType(request.body);
    } catch (error) {
      throw new HttpError(400, "INVALID_BUSINESS_LETTERHEAD", error.message);
    }
    await inTransaction(async (connection) => {
      await connection.execute(
        "UPDATE tenants SET invoice_letterhead = ?, invoice_letterhead_mime_type = ?, invoice_logo = NULL, invoice_logo_mime_type = NULL WHERE id = ?",
        [request.body, mimeType, request.tenant.id],
      );
      await writeAudit(connection, {
        tenantId: request.tenant.id, userId: request.auth.userId, action: "tenant.letterhead_updated",
        entityType: "tenant", entityId: request.tenant.id, details: { mimeType, sizeBytes: request.body.length },
      });
    });
    response.json({ data: { letterheadUrl: "/api/v1/tenants/current/letterhead", mimeType } });
  },
);

router.delete("/tenants/current/letterhead", requirePermission("business:update"), async (request, response) => {
  await inTransaction(async (connection) => {
    const [result] = await connection.execute(
      "UPDATE tenants SET invoice_letterhead = NULL, invoice_letterhead_mime_type = NULL WHERE id = ?",
      [request.tenant.id],
    );
    if (result.affectedRows !== 1) throw new HttpError(404, "BUSINESS_NOT_FOUND", "Business not found.");
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "tenant.letterhead_removed",
      entityType: "tenant", entityId: request.tenant.id,
    });
  });
  response.status(204).end();
});

const invoiceTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6385ff"),
  footerNote: z.string().trim().max(500).default("Thank you for your business."),
});

function parseTemplateConfig(config) {
  return typeof config === "string" ? JSON.parse(config) : config;
}

router.get("/subscription", requirePermission("business:read"), async (request, response) => {
  const subscription = request.subscription;
  if (!subscription && !request.isPlatformAdmin) throw new HttpError(503, "SUBSCRIPTION_NOT_CONFIGURED", "This business does not have a subscription record.");
  const start = subscription?.periodStart
    ? new Date(subscription.periodStart)
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const end = subscription?.periodEnd
    ? new Date(subscription.periodEnd)
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
  const [[invoiceRows], [userRows], [plans]] = await Promise.all([
    pool.execute(
      "SELECT COUNT(*) AS used FROM invoices WHERE tenant_id = ? AND status IN ('issued', 'void') AND issued_at >= ? AND issued_at < ?",
      [request.tenant.id, start, end],
    ),
    pool.execute("SELECT COUNT(*) AS used FROM memberships WHERE tenant_id = ? AND active = TRUE", [request.tenant.id]),
    pool.execute(
      `SELECT id, code, name, monthly_price_cents AS monthlyPriceCents,
              invoice_limit AS invoiceLimit, user_limit AS userLimit, features
       FROM subscription_plans WHERE active = TRUE ORDER BY monthly_price_cents IS NULL, monthly_price_cents`,
    ),
  ]);
  response.json({
    data: {
      exemptFromPlan: Boolean(request.isPlatformAdmin),
      subscription: subscription ? {
        id: subscription.id,
        planId: subscription.planId,
        planCode: subscription.planCode,
        planName: subscription.planName,
        monthlyPriceCents: subscription.monthlyPriceCents === null ? null : Number(subscription.monthlyPriceCents),
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt,
        periodStart: subscription.periodStart,
        periodEnd: subscription.periodEnd,
        invoiceLimit: subscription.invoiceLimit === null ? null : Number(subscription.invoiceLimit),
        userLimit: subscription.userLimit === null ? null : Number(subscription.userLimit),
        features: subscription.features,
      } : null,
      usage: { issuedInvoices: Number(invoiceRows[0].used), activeUsers: Number(userRows[0].used) },
      availablePlans: plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        monthlyPriceCents: plan.monthlyPriceCents === null ? null : Number(plan.monthlyPriceCents),
        invoiceLimit: plan.invoiceLimit === null ? null : Number(plan.invoiceLimit),
        userLimit: plan.userLimit === null ? null : Number(plan.userLimit),
        features: typeof plan.features === "string" ? JSON.parse(plan.features) : plan.features,
      })),
    },
  });
});

router.get("/invoice-templates", requirePermission("business:read"), async (request, response) => {
  const [rows] = await pool.execute(
    `SELECT id, name, config, is_default AS isDefault, created_at AS createdAt
     FROM invoice_templates WHERE tenant_id = ? ORDER BY is_default DESC, name ASC`,
    [request.tenant.id],
  );
  response.json({
    data: rows.map((row) => ({ ...row, config: parseTemplateConfig(row.config), isDefault: Boolean(row.isDefault) })),
  });
});

router.post("/invoice-templates", requirePermission("business:update"), async (request, response) => {
  const input = invoiceTemplateSchema.extend({ isDefault: z.boolean().optional().default(false) }).parse(request.body);
  const id = randomUUID();
  const config = { primaryColor: input.primaryColor, footerNote: input.footerNote };
  let isDefault = input.isDefault;
  await inTransaction(async (connection) => {
    await connection.execute("SELECT id FROM tenants WHERE id = ? FOR UPDATE", [request.tenant.id]);
    const [existing] = await connection.execute("SELECT COUNT(*) AS count FROM invoice_templates WHERE tenant_id = ?", [request.tenant.id]);
    if (Number(existing[0].count) >= 20) throw new HttpError(409, "TEMPLATE_LIMIT_REACHED", "A business can have at most 20 invoice templates.");
    isDefault = input.isDefault || Number(existing[0].count) === 0;
    if (isDefault) {
      await connection.execute("UPDATE invoice_templates SET is_default = FALSE WHERE tenant_id = ?", [request.tenant.id]);
    }
    await connection.execute(
      "INSERT INTO invoice_templates (id, tenant_id, name, config, is_default) VALUES (?, ?, ?, ?, ?)",
      [id, request.tenant.id, input.name, JSON.stringify(config), isDefault],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "invoice_template.created",
      entityType: "invoice_template", entityId: id, details: { name: input.name },
    });
  });
  response.status(201).json({ data: { id, name: input.name, config, isDefault } });
});

router.patch("/invoice-templates/:id", requirePermission("business:update"), async (request, response) => {
  const id = routeId(request.params.id);
  const input = invoiceTemplateSchema.extend({ isDefault: z.boolean() }).parse(request.body);
  const config = { primaryColor: input.primaryColor, footerNote: input.footerNote };
  await inTransaction(async (connection) => {
    await connection.execute("SELECT id FROM tenants WHERE id = ? FOR UPDATE", [request.tenant.id]);
    const [templates] = await connection.execute(
      "SELECT id FROM invoice_templates WHERE tenant_id = ? AND id = ? FOR UPDATE",
      [request.tenant.id, id],
    );
    if (!templates.length) throw new HttpError(404, "TEMPLATE_NOT_FOUND", "Invoice template not found.");
    if (input.isDefault) {
      await connection.execute("UPDATE invoice_templates SET is_default = FALSE WHERE tenant_id = ?", [request.tenant.id]);
    }
    await connection.execute(
      "UPDATE invoice_templates SET name = ?, config = ?, is_default = ? WHERE tenant_id = ? AND id = ?",
      [input.name, JSON.stringify(config), input.isDefault, request.tenant.id, id],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "invoice_template.updated",
      entityType: "invoice_template", entityId: id, details: { name: input.name, isDefault: input.isDefault },
    });
  });
  response.json({ data: { id, name: input.name, config, isDefault: input.isDefault } });
});

router.delete("/invoice-templates/:id", requirePermission("business:update"), async (request, response) => {
  const id = routeId(request.params.id);
  await inTransaction(async (connection) => {
    const [templates] = await connection.execute(
      "SELECT name FROM invoice_templates WHERE tenant_id = ? AND id = ? FOR UPDATE",
      [request.tenant.id, id],
    );
    if (!templates.length) throw new HttpError(404, "TEMPLATE_NOT_FOUND", "Invoice template not found.");
    const [invoices] = await connection.execute(
      "SELECT COUNT(*) AS count FROM invoices WHERE tenant_id = ? AND template_id = ?",
      [request.tenant.id, id],
    );
    if (Number(invoices[0].count) > 0) throw new HttpError(409, "TEMPLATE_IN_USE", "This template is assigned to invoices and cannot be deleted.");
    await connection.execute("DELETE FROM invoice_templates WHERE tenant_id = ? AND id = ?", [request.tenant.id, id]);
    const [defaults] = await connection.execute(
      "SELECT id FROM invoice_templates WHERE tenant_id = ? AND is_default = TRUE LIMIT 1",
      [request.tenant.id],
    );
    if (!defaults.length) {
      await connection.execute(
        "UPDATE invoice_templates SET is_default = TRUE WHERE tenant_id = ? ORDER BY created_at ASC LIMIT 1",
        [request.tenant.id],
      );
    }
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "invoice_template.deleted",
      entityType: "invoice_template", entityId: id, details: { name: templates[0].name },
    });
  });
  response.status(204).end();
});

router.get("/customers", requirePermission("customers:read"), async (request, response) => {
  const { search, limit, offset } = pageQuery(request);
  const like = `%${search}%`;
  const [rows] = await pool.execute(
    `SELECT c.id, c.name, c.company, c.email, c.phone, c.billing_address AS billingAddress,
            c.kra_pin AS kraPin, c.notes, c.created_at AS createdAt,
            COUNT(i.id) AS invoiceCount
     FROM customers c
     LEFT JOIN invoices i ON i.tenant_id = c.tenant_id AND i.customer_id = c.id
     WHERE c.tenant_id = ? AND c.archived_at IS NULL
       AND (? = '' OR c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ?)
     GROUP BY c.id
     ORDER BY c.name ASC LIMIT ? OFFSET ?`,
    [request.tenant.id, search, like, like, like, limit, offset],
  );
  response.json({ data: rows.map((row) => ({ ...row, invoiceCount: Number(row.invoiceCount) })), meta: { limit, offset } });
});

router.post("/customers", requirePermission("customers:write"), async (request, response) => {
  const input = customerSchema.parse(request.body);
  const id = randomUUID();
  await inTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO customers (id, tenant_id, name, company, email, phone, billing_address, kra_pin, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, request.tenant.id, input.name, input.company || null, input.email || null, input.phone || null,
        input.billingAddress || null, input.kraPin || null, input.notes || null],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "customer.created",
      entityType: "customer", entityId: id,
    });
  });
  response.status(201).json({ data: { id, ...input, archivedAt: null } });
});

router.patch("/customers/:id", requirePermission("customers:write"), async (request, response) => {
  const id = routeId(request.params.id);
  const input = customerSchema.partial().parse(request.body);
  if (Object.keys(input).length === 0) throw new HttpError(400, "EMPTY_UPDATE", "Provide at least one customer field to update.");
  const columns = { name: "name", company: "company", email: "email", phone: "phone", billingAddress: "billing_address", kraPin: "kra_pin", notes: "notes" };
  const entries = Object.entries(input);
  const [result] = await pool.execute(
    `UPDATE customers SET ${entries.map(([key]) => `${columns[key]} = ?`).join(", ")}
     WHERE tenant_id = ? AND id = ? AND archived_at IS NULL`,
    [...entries.map(([, value]) => value || null), request.tenant.id, id],
  );
  if (!result.affectedRows) throw new HttpError(404, "CUSTOMER_NOT_FOUND", "Customer not found.");
  await inTransaction((connection) => writeAudit(connection, {
    tenantId: request.tenant.id, userId: request.auth.userId, action: "customer.updated",
    entityType: "customer", entityId: id, details: { fields: entries.map(([key]) => key) },
  }));
  response.json({ data: { id, ...input } });
});

router.delete("/customers/:id", requirePermission("customers:write"), async (request, response) => {
  const id = routeId(request.params.id);
  const [result] = await pool.execute(
    "UPDATE customers SET archived_at = UTC_TIMESTAMP(3) WHERE tenant_id = ? AND id = ? AND archived_at IS NULL",
    [request.tenant.id, id],
  );
  if (!result.affectedRows) throw new HttpError(404, "CUSTOMER_NOT_FOUND", "Customer not found.");
  await inTransaction((connection) => writeAudit(connection, {
    tenantId: request.tenant.id, userId: request.auth.userId, action: "customer.archived",
    entityType: "customer", entityId: id,
  }));
  response.status(204).end();
});

router.get("/products", requirePermission("products:read"), async (request, response) => {
  const { search, limit, offset } = pageQuery(request);
  const like = `%${search}%`;
  const [rows] = await pool.execute(
    `SELECT id, name, description, category, unit_price_cents AS unitPriceCents,
            tax_rate_bps AS taxRateBps, created_at AS createdAt
     FROM products
     WHERE tenant_id = ? AND archived_at IS NULL
       AND (? = '' OR name LIKE ? OR description LIKE ? OR category LIKE ?)
     ORDER BY name ASC LIMIT ? OFFSET ?`,
    [request.tenant.id, search, like, like, like, limit, offset],
  );
  response.json({ data: rows.map((row) => ({ ...row, unitPriceCents: Number(row.unitPriceCents) })), meta: { limit, offset } });
});

router.post("/products", requirePermission("products:write"), async (request, response) => {
  const input = productSchema.parse(request.body);
  const id = randomUUID();
  await inTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO products (id, tenant_id, name, description, category, unit_price_cents, tax_rate_bps)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, request.tenant.id, input.name, input.description || null, input.category || null,
        input.unitPriceCents, input.taxRateBps ?? null],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "product.created",
      entityType: "product", entityId: id,
    });
  });
  response.status(201).json({ data: { id, ...input } });
});

router.patch("/products/:id", requirePermission("products:write"), async (request, response) => {
  const id = routeId(request.params.id);
  const input = productSchema.partial().parse(request.body);
  if (Object.keys(input).length === 0) throw new HttpError(400, "EMPTY_UPDATE", "Provide at least one product field to update.");
  const columns = { name: "name", description: "description", category: "category", unitPriceCents: "unit_price_cents", taxRateBps: "tax_rate_bps" };
  const entries = Object.entries(input);
  const [result] = await pool.execute(
    `UPDATE products SET ${entries.map(([key]) => `${columns[key]} = ?`).join(", ")}
     WHERE tenant_id = ? AND id = ? AND archived_at IS NULL`,
    [...entries.map(([, value]) => value === "" ? null : value), request.tenant.id, id],
  );
  if (!result.affectedRows) throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product not found.");
  await inTransaction((connection) => writeAudit(connection, {
    tenantId: request.tenant.id, userId: request.auth.userId, action: "product.updated",
    entityType: "product", entityId: id, details: { fields: entries.map(([key]) => key) },
  }));
  response.json({ data: { id, ...input } });
});

router.delete("/products/:id", requirePermission("products:write"), async (request, response) => {
  const id = routeId(request.params.id);
  const [result] = await pool.execute(
    "UPDATE products SET archived_at = UTC_TIMESTAMP(3) WHERE tenant_id = ? AND id = ? AND archived_at IS NULL",
    [request.tenant.id, id],
  );
  if (!result.affectedRows) throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product not found.");
  await inTransaction((connection) => writeAudit(connection, {
    tenantId: request.tenant.id, userId: request.auth.userId, action: "product.archived",
    entityType: "product", entityId: id,
  }));
  response.status(204).end();
});

router.get("/invoices", requirePermission("invoices:read"), async (request, response) => {
  const { search, limit, offset } = pageQuery(request);
  const like = `%${search}%`;
  const [rows] = await pool.execute(
    `SELECT i.*, dn.id AS delivery_note_id, dn.delivery_number,
            c.name AS customer_name, c.email AS customer_email,
            COALESCE((SELECT SUM(cn.amount_cents) FROM credit_notes cn
              WHERE cn.tenant_id = i.tenant_id AND cn.invoice_id = i.id AND cn.status = 'issued'), 0) AS credited_cents
     FROM invoices i
     INNER JOIN customers c ON c.tenant_id = i.tenant_id AND c.id = i.customer_id
     LEFT JOIN delivery_notes dn ON dn.tenant_id = i.tenant_id AND dn.invoice_id = i.id
     WHERE i.tenant_id = ?
       AND (? = '' OR i.invoice_number LIKE ? OR c.name LIKE ? OR c.email LIKE ?)
     ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
    [request.tenant.id, search, like, like, like, limit, offset],
  );
  const [itemRows] = rows.length
    ? await pool.execute(
      `SELECT id, invoice_id, product_id, description, quantity, unit_price_cents,
              discount_cents, tax_rate_bps, line_total_cents
       FROM invoice_items WHERE tenant_id = ? AND invoice_id IN (${rows.map(() => "?").join(",")})
       ORDER BY created_at, id`,
      [request.tenant.id, ...rows.map((row) => row.id)],
    )
    : [[]];
  const itemsByInvoice = new Map();
  for (const item of itemRows) {
    const items = itemsByInvoice.get(item.invoice_id) ?? [];
    items.push({
      id: item.id,
      productId: item.product_id,
      description: item.description,
      quantity: Number(item.quantity),
      unitPriceCents: Number(item.unit_price_cents),
      discountCents: Number(item.discount_cents),
      taxRateBps: item.tax_rate_bps,
      lineTotalCents: Number(item.line_total_cents),
    });
    itemsByInvoice.set(item.invoice_id, items);
  }
  response.json({
    data: rows.map((row) => serializeInvoice({ ...row, items: itemsByInvoice.get(row.id) ?? [] })),
    meta: { limit, offset },
  });
});

router.get("/invoices/:id", requirePermission("invoices:read"), async (request, response) => {
  const id = routeId(request.params.id);
  const [rows] = await pool.execute(
    `SELECT i.*, dn.id AS delivery_note_id, dn.delivery_number,
            c.name AS customer_name, c.email AS customer_email,
            COALESCE((SELECT SUM(cn.amount_cents) FROM credit_notes cn
              WHERE cn.tenant_id = i.tenant_id AND cn.invoice_id = i.id AND cn.status = 'issued'), 0) AS credited_cents,
            tpl.name AS template_name, i.template_config_snapshot AS template_config_snapshot
     FROM invoices i
     INNER JOIN customers c ON c.tenant_id = i.tenant_id AND c.id = i.customer_id
     LEFT JOIN delivery_notes dn ON dn.tenant_id = i.tenant_id AND dn.invoice_id = i.id
     LEFT JOIN invoice_templates tpl ON tpl.tenant_id = i.tenant_id AND tpl.id = i.template_id
     WHERE i.tenant_id = ? AND i.id = ? LIMIT 1`,
    [request.tenant.id, id],
  );
  const row = rows[0] ?? null;
  if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
  row.items = await invoiceItems(request.tenant.id, id);
  response.json({ data: serializeInvoice({ ...row, templateName: row.template_name }) });
});

router.get("/invoices/:id/pdf", requirePermission("invoices:read"), async (request, response) => {
  const id = routeId(request.params.id);
  const [rows] = await pool.execute(
    `SELECT i.*, t.invoice_logo, t.invoice_logo_mime_type, t.invoice_letterhead,
            t.invoice_letterhead_mime_type, t.invoice_layout,
            c.name AS customer_name, c.company AS customer_company, c.email AS customer_email,
            c.phone AS customer_phone, c.billing_address AS customer_address, c.kra_pin AS customer_kra_pin,
            COALESCE((SELECT SUM(cn.amount_cents) FROM credit_notes cn
              WHERE cn.tenant_id = i.tenant_id AND cn.invoice_id = i.id AND cn.status = 'issued'), 0) AS credited_cents
     FROM invoices i
     INNER JOIN tenants t ON t.id = i.tenant_id
     INNER JOIN customers c ON c.tenant_id = i.tenant_id AND c.id = i.customer_id
     WHERE i.tenant_id = ? AND i.id = ? LIMIT 1`,
    [request.tenant.id, id],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
  let snapshot = row.issued_snapshot;
  if (typeof snapshot === "string") snapshot = JSON.parse(snapshot);
  const savedInvoice = snapshot?.invoice ?? {};
  const items = savedInvoice.items ?? await invoiceItems(request.tenant.id, id);
  const invoice = {
    business: {
      ...(snapshot?.business ?? {
      name: request.tenant.name,
      email: request.tenant.email,
      phone: request.tenant.phone,
      address: request.tenant.address,
      }),
      logo: row.invoice_logo,
      logoMimeType: row.invoice_logo_mime_type,
      letterhead: row.invoice_letterhead,
      letterheadMimeType: row.invoice_letterhead_mime_type,
      invoiceLayout: snapshot?.business?.invoiceLayout ?? row.invoice_layout,
    },
    customer: snapshot?.customer ?? {
      name: row.customer_name,
      company: row.customer_company,
      email: row.customer_email,
      phone: row.customer_phone,
      billingAddress: row.customer_address,
      kraPin: row.customer_kra_pin,
    },
    template: snapshot?.template ?? {
      name: row.template_name_snapshot,
      config: parseTemplateConfig(row.template_config_snapshot),
    },
    invoiceNumber: row.invoice_number,
    status: row.status,
    issueDate: savedInvoice.issueDate ?? row.issue_date,
    dueDate: savedInvoice.dueDate ?? row.due_date,
    currency: savedInvoice.currency ?? row.currency,
    subtotalCents: Number(savedInvoice.subtotalCents ?? row.subtotal_cents),
    discountCents: Number(savedInvoice.discountCents ?? row.discount_cents),
    taxRateBps: Number(savedInvoice.taxRateBps ?? row.tax_rate_bps),
    taxCents: Number(savedInvoice.taxCents ?? row.tax_cents),
    totalCents: Number(savedInvoice.totalCents ?? row.total_cents),
    amountPaidCents: Number(row.amount_paid_cents),
    creditedCents: Number(row.credited_cents ?? 0),
    notes: row.notes,
    terms: row.terms,
    items,
  };
  const pdf = await createInvoicePdf(invoice);
  const filename = `${String(row.invoice_number).replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`;
  response.status(200).type("application/pdf").attachment(filename).send(pdf);
});

router.post("/invoices/:id/delivery-note", requirePermission("invoices:write"), async (request, response) => {
  const invoiceId = routeId(request.params.id);
  const input = deliveryNoteSchema.parse(request.body);
  const deliveryNote = await inTransaction(async (connection) => {
    const [invoiceRows] = await connection.execute(
      "SELECT id, invoice_number, status FROM invoices WHERE tenant_id = ? AND id = ? FOR UPDATE",
      [request.tenant.id, invoiceId],
    );
    const invoice = invoiceRows[0];
    if (!invoice) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found in this business.");
    if (invoice.status !== "issued") throw new HttpError(409, "DELIVERY_NOTE_REQUIRES_ISSUED_INVOICE", "A delivery note can only be created for an issued invoice.");
    const [existing] = await connection.execute(
      "SELECT id, delivery_number FROM delivery_notes WHERE tenant_id = ? AND invoice_id = ? LIMIT 1",
      [request.tenant.id, invoiceId],
    );
    if (existing.length) throw new HttpError(409, "DELIVERY_NOTE_ALREADY_EXISTS", "A delivery note already exists for this invoice.");
    const sourceItems = await invoiceItems(request.tenant.id, invoiceId, connection);
    if (input.items.length !== sourceItems.length) {
      throw new HttpError(400, "INVALID_DELIVERY_ITEMS", "Include a delivered quantity for every invoice item.");
    }
    const requestedItems = new Map(input.items.map((item) => [item.invoiceItemId, item.quantity]));
    const items = sourceItems.map((item) => {
      if (!requestedItems.has(item.id)) {
        throw new HttpError(400, "INVALID_DELIVERY_ITEMS", "The delivery quantities must match this invoice's items.");
      }
      const quantity = requestedItems.get(item.id);
      if (quantity > item.quantity) {
        throw new HttpError(400, "DELIVERY_QUANTITY_EXCEEDS_INVOICE", `Delivered quantity for "${item.description}" cannot exceed the invoiced quantity.`);
      }
      return { invoiceItemId: item.id, description: item.description, quantity };
    });
    const id = randomUUID();
    const deliveryNumber = `DN-${invoice.invoice_number}`;
    await connection.execute(
      `INSERT INTO delivery_notes
       (id, tenant_id, invoice_id, delivery_number, delivery_date, recipient_name, delivery_address, delivered_by, notes, items, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, request.tenant.id, invoiceId, deliveryNumber, input.deliveryDate, input.recipientName,
        input.deliveryAddress || null, input.deliveredBy || null, input.notes || null, JSON.stringify(items), request.auth.userId],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "delivery_note.created",
      entityType: "delivery_note", entityId: id, details: { invoiceId, deliveryNumber },
    });
    return {
      id, invoiceId, invoiceNumber: invoice.invoice_number, deliveryNumber, deliveryDate: input.deliveryDate,
      recipientName: input.recipientName, deliveryAddress: input.deliveryAddress, deliveredBy: input.deliveredBy,
      notes: input.notes, items,
    };
  });
  response.status(201).json({ data: deliveryNote });
});

router.get("/delivery-notes/:id/pdf", requirePermission("invoices:read"), async (request, response) => {
  const id = routeId(request.params.id);
  const [rows] = await pool.execute(
    `SELECT dn.*, i.invoice_number, t.name AS business_name, t.email AS business_email,
            t.phone AS business_phone, t.address AS business_address, t.invoice_logo,
            t.invoice_logo_mime_type, t.invoice_letterhead, t.invoice_letterhead_mime_type, t.invoice_layout
     FROM delivery_notes dn
     INNER JOIN invoices i ON i.tenant_id = dn.tenant_id AND i.id = dn.invoice_id
     INNER JOIN tenants t ON t.id = dn.tenant_id
     WHERE dn.tenant_id = ? AND dn.id = ? LIMIT 1`,
    [request.tenant.id, id],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, "DELIVERY_NOTE_NOT_FOUND", "Delivery note not found.");
  let items = row.items;
  if (typeof items === "string") items = JSON.parse(items);
  const pdf = await createDeliveryNotePdf({
    id: row.id,
    deliveryNumber: row.delivery_number,
    deliveryDate: row.delivery_date,
    invoiceNumber: row.invoice_number,
    recipientName: row.recipient_name,
    deliveryAddress: row.delivery_address,
    deliveredBy: row.delivered_by,
    notes: row.notes,
    items,
    business: {
      name: row.business_name,
      email: row.business_email,
      phone: row.business_phone,
      address: row.business_address,
      logo: row.invoice_logo,
      logoMimeType: row.invoice_logo_mime_type,
      letterhead: row.invoice_letterhead,
      letterheadMimeType: row.invoice_letterhead_mime_type,
      invoiceLayout: row.invoice_layout,
    },
  });
  response.status(200).type("application/pdf").attachment(`${row.delivery_number}.pdf`).send(pdf);
});

router.get("/proformas", requirePermission("invoices:read"), async (request, response) => {
  const { search, limit, offset } = pageQuery(request);
  const like = `%${search}%`;
  const [rows] = await pool.execute(
    `SELECT p.id, p.proforma_number AS proformaNumber, p.status, p.currency,
            p.issue_date AS issueDate, p.expiry_date AS expiryDate,
            p.subtotal_cents AS subtotalCents, p.discount_cents AS discountCents,
            p.tax_rate_bps AS taxRateBps, p.tax_cents AS taxCents, p.total_cents AS totalCents,
            p.converted_invoice_id AS convertedInvoiceId, c.id AS customerId,
            c.name AS customerName, c.email AS customerEmail
     FROM proforma_invoices p
     INNER JOIN customers c ON c.tenant_id = p.tenant_id AND c.id = p.customer_id
     WHERE p.tenant_id = ? AND (? = '' OR p.proforma_number LIKE ? OR c.name LIKE ?)
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    [request.tenant.id, search, like, like, limit, offset],
  );
  const [items] = rows.length
    ? await pool.execute(
      `SELECT proforma_id, id, description, quantity, unit_price_cents, discount_cents, tax_rate_bps, line_total_cents
       FROM proforma_items WHERE tenant_id = ? AND proforma_id IN (${rows.map(() => "?").join(",")})
       ORDER BY id`,
      [request.tenant.id, ...rows.map((row) => row.id)],
    )
    : [[]];
  const byProforma = new Map();
  for (const item of items) {
    const list = byProforma.get(item.proforma_id) ?? [];
    list.push({
      id: item.id,
      description: item.description,
      quantity: Number(item.quantity),
      unitPriceCents: Number(item.unit_price_cents),
      discountCents: Number(item.discount_cents),
      taxRateBps: item.tax_rate_bps,
      lineTotalCents: Number(item.line_total_cents),
    });
    byProforma.set(item.proforma_id, list);
  }
  response.json({
    data: rows.map((row) => ({
      ...row,
      subtotalCents: Number(row.subtotalCents),
      discountCents: Number(row.discountCents),
      taxCents: Number(row.taxCents),
      totalCents: Number(row.totalCents),
      items: byProforma.get(row.id) ?? [],
    })),
    meta: { limit, offset },
  });
});

router.post("/proformas", requirePermission("invoices:write"), async (request, response) => {
  const input = createInvoiceSchema.extend({ expiryDate: z.string().date() }).omit({ dueDate: true, issueNow: true }).parse(request.body);
  const proforma = await inTransaction(async (connection) => {
    const [customers] = await connection.execute(
      "SELECT id, name, company, email, phone, billing_address, kra_pin FROM customers WHERE tenant_id = ? AND id = ? AND archived_at IS NULL FOR UPDATE",
      [request.tenant.id, input.customerId],
    );
    const customer = customers[0];
    if (!customer) throw new HttpError(404, "CUSTOMER_NOT_FOUND", "Customer not found in this business.");
    const calculation = calculateInvoice(input.items, input.discountCents, input.taxRateBps ?? request.tenant.tax_rate_bps);
    if (calculation.totalCents <= 0) throw new HttpError(400, "ZERO_TOTAL", "A proforma invoice must have a total greater than zero.");
    const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10);
    if (input.expiryDate < issueDate) throw new HttpError(400, "INVALID_EXPIRY_DATE", "The proforma expiry date must be on or after its issue date.");
    const year = Number(issueDate.slice(0, 4));
    await connection.execute(
      "INSERT IGNORE INTO proforma_counters (tenant_id, document_year, last_number) VALUES (?, ?, 0)",
      [request.tenant.id, year],
    );
    const [counters] = await connection.execute(
      "SELECT last_number FROM proforma_counters WHERE tenant_id = ? AND document_year = ? FOR UPDATE",
      [request.tenant.id, year],
    );
    const nextNumber = Number(counters[0].last_number) + 1;
    if (!Number.isSafeInteger(nextNumber)) throw new HttpError(409, "PROFORMA_SEQUENCE_EXHAUSTED", "The proforma number sequence is exhausted.");
    await connection.execute(
      "UPDATE proforma_counters SET last_number = ? WHERE tenant_id = ? AND document_year = ?",
      [nextNumber, request.tenant.id, year],
    );
    const proformaNumber = `${request.tenant.invoice_prefix}-PF-${year}-${String(nextNumber).padStart(5, "0")}`;
    const currency = input.currency ?? request.tenant.currency;
    const taxRateBps = input.taxRateBps ?? request.tenant.tax_rate_bps;
    const snapshot = {
      business: { name: request.tenant.name, email: request.tenant.email, phone: request.tenant.phone, address: request.tenant.address },
      customer: {
        name: customer.name, company: customer.company, email: customer.email, phone: customer.phone,
        billingAddress: customer.billing_address, kraPin: customer.kra_pin,
      },
      proforma: { proformaNumber, issueDate, expiryDate: input.expiryDate, currency, ...calculation },
    };
    const id = randomUUID();
    await connection.execute(
      `INSERT INTO proforma_invoices
       (id, tenant_id, customer_id, proforma_number, status, currency, issue_date, expiry_date,
        subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents, notes, issued_snapshot, created_by)
       VALUES (?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, request.tenant.id, customer.id, proformaNumber, currency, issueDate, input.expiryDate,
        calculation.subtotalCents, calculation.discountCents, taxRateBps, calculation.taxCents,
        calculation.totalCents, input.notes || null, JSON.stringify(snapshot), request.auth.userId],
    );
    for (const item of calculation.items) {
      await connection.execute(
        `INSERT INTO proforma_items
         (id, tenant_id, proforma_id, description, quantity, unit_price_cents, discount_cents, tax_rate_bps, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), request.tenant.id, id, item.description, item.quantity, item.unitPriceCents,
          item.lineDiscountCents, item.taxRateBps, item.lineTotalCents],
      );
    }
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "proforma.issued",
      entityType: "proforma", entityId: id, details: { proformaNumber, totalCents: calculation.totalCents, currency },
    });
    return {
      id, proformaNumber, status: "issued", customerId: customer.id, customerName: customer.name,
      customerEmail: customer.email, issueDate, expiryDate: input.expiryDate, currency,
      taxRateBps, notes: input.notes, ...calculation,
    };
  });
  response.status(201).json({ data: proforma });
});

router.post("/proformas/:id/convert", requirePermission("invoices:write"), async (request, response) => {
  const proformaId = routeId(request.params.id);
  const invoice = await inTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT p.*, c.name AS customer_name, c.email AS customer_email
       FROM proforma_invoices p
       INNER JOIN customers c ON c.tenant_id = p.tenant_id AND c.id = p.customer_id
       WHERE p.tenant_id = ? AND p.id = ? FOR UPDATE`,
      [request.tenant.id, proformaId],
    );
    const proforma = rows[0];
    if (!proforma) throw new HttpError(404, "PROFORMA_NOT_FOUND", "Proforma invoice not found.");
    if (proforma.status !== "issued") throw new HttpError(409, "PROFORMA_NOT_CONVERTIBLE", "Only an unconverted proforma can be converted.");
    if (String(proforma.expiry_date).slice(0, 10) < new Date().toISOString().slice(0, 10)) {
      throw new HttpError(409, "PROFORMA_EXPIRED", "This proforma invoice has expired.");
    }
    const [items] = await connection.execute(
      `SELECT id, description, quantity, unit_price_cents, discount_cents, tax_rate_bps, line_total_cents
       FROM proforma_items WHERE tenant_id = ? AND proforma_id = ? ORDER BY id`,
      [request.tenant.id, proformaId],
    );
    const invoiceId = randomUUID();
    const issueDate = new Date().toISOString().slice(0, 10);
    const invoiceNumber = await getNextInvoiceNumber(connection, request.tenant.id, Number(issueDate.slice(0, 4)), request.tenant.invoice_prefix);
    const dueDate = proforma.expiry_date < issueDate ? issueDate : String(proforma.expiry_date).slice(0, 10);
    await connection.execute(
      `INSERT INTO invoices
       (id, tenant_id, customer_id, invoice_number, status, currency, issue_date, due_date,
        subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents, notes, created_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [invoiceId, request.tenant.id, proforma.customer_id, invoiceNumber, proforma.currency, issueDate, dueDate,
        proforma.subtotal_cents, proforma.discount_cents, proforma.tax_rate_bps, proforma.tax_cents,
        proforma.total_cents, `Converted from ${proforma.proforma_number}${proforma.notes ? `\n${proforma.notes}` : ""}`, request.auth.userId],
    );
    for (const item of items) {
      await connection.execute(
        `INSERT INTO invoice_items
         (id, tenant_id, invoice_id, description, quantity, unit_price_cents, discount_cents, tax_rate_bps, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), request.tenant.id, invoiceId, item.description, item.quantity, item.unit_price_cents,
          item.discount_cents, item.tax_rate_bps, item.line_total_cents],
      );
    }
    await connection.execute(
      "UPDATE proforma_invoices SET status = 'converted', converted_invoice_id = ? WHERE tenant_id = ? AND id = ?",
      [invoiceId, request.tenant.id, proformaId],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "proforma.converted",
      entityType: "proforma", entityId: proformaId, details: { invoiceId, invoiceNumber },
    });
    return { id: invoiceId, invoiceNumber, customerName: proforma.customer_name, status: "draft", totalCents: Number(proforma.total_cents) };
  });
  response.status(201).json({ data: invoice });
});

router.get("/quotations", requirePermission("invoices:read"), async (request, response) => {
  const { search, limit, offset } = pageQuery(request);
  const like = `%${search}%`;
  const [rows] = await pool.execute(
    `SELECT q.id, q.quotation_number AS quotationNumber, q.status, q.currency,
            q.issue_date AS issueDate, q.expiry_date AS expiryDate,
            q.subtotal_cents AS subtotalCents, q.tax_rate_bps AS taxRateBps,
          q.discount_cents AS discountCents, q.tax_cents AS taxCents, q.total_cents AS totalCents,
            q.converted_invoice_id AS convertedInvoiceId, c.id AS customerId,
            c.name AS customerName, c.email AS customerEmail
     FROM quotations q
     INNER JOIN customers c ON c.tenant_id = q.tenant_id AND c.id = q.customer_id
     WHERE q.tenant_id = ? AND (? = '' OR q.quotation_number LIKE ? OR c.name LIKE ?)
     ORDER BY q.created_at DESC LIMIT ? OFFSET ?`,
    [request.tenant.id, search, like, like, limit, offset],
  );
  const [items] = rows.length
    ? await pool.execute(
      `SELECT quotation_id, id, description, quantity, unit_price_cents, tax_rate_bps, line_total_cents
       FROM quotation_items WHERE tenant_id = ? AND quotation_id IN (${rows.map(() => "?").join(",")})
       ORDER BY id`,
      [request.tenant.id, ...rows.map((row) => row.id)],
    )
    : [[]];
  const byQuotation = new Map();
  for (const item of items) {
    const list = byQuotation.get(item.quotation_id) ?? [];
    list.push({
      id: item.id,
      description: item.description,
      quantity: Number(item.quantity),
      unitPriceCents: Number(item.unit_price_cents),
      taxRateBps: item.tax_rate_bps,
      lineTotalCents: Number(item.line_total_cents),
    });
    byQuotation.set(item.quotation_id, list);
  }
  response.json({
    data: rows.map((row) => ({
      ...row,
      subtotalCents: Number(row.subtotalCents),
      discountCents: Number(row.discountCents),
      taxCents: Number(row.taxCents),
      totalCents: Number(row.totalCents),
      items: byQuotation.get(row.id) ?? [],
    })),
    meta: { limit, offset },
  });
});

router.post("/quotations", requirePermission("invoices:write"), requirePlanFeature("quotations"), async (request, response) => {
  const input = createInvoiceSchema.extend({ expiryDate: z.string().date() }).omit({ dueDate: true, issueNow: true }).parse(request.body);
  const quotation = await inTransaction(async (connection) => {
    const [customers] = await connection.execute(
      "SELECT id, name FROM customers WHERE tenant_id = ? AND id = ? AND archived_at IS NULL FOR UPDATE",
      [request.tenant.id, input.customerId],
    );
    if (!customers.length) throw new HttpError(404, "CUSTOMER_NOT_FOUND", "Customer not found in this business.");
    const calculation = calculateInvoice(input.items, input.discountCents, input.taxRateBps ?? request.tenant.tax_rate_bps);
    const id = randomUUID();
    const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10);
    const year = Number(issueDate.slice(0, 4));
    const quotationNumber = await getNextInvoiceNumber(connection, request.tenant.id, year, `${request.tenant.invoice_prefix}-Q`);
    await connection.execute(
      `INSERT INTO quotations (id, tenant_id, customer_id, quotation_number, status, currency, issue_date,
       expiry_date, subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents, created_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, request.tenant.id, input.customerId, quotationNumber, input.currency ?? request.tenant.currency,
        issueDate, input.expiryDate, calculation.subtotalCents, calculation.discountCents, input.taxRateBps ?? request.tenant.tax_rate_bps,
        calculation.taxCents, calculation.totalCents, request.auth.userId],
    );
    for (const item of calculation.items) {
      await connection.execute(
        `INSERT INTO quotation_items (id, tenant_id, quotation_id, description, quantity, unit_price_cents, tax_rate_bps, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), request.tenant.id, id, item.description, item.quantity, item.unitPriceCents, item.taxRateBps, item.lineTotalCents],
      );
    }
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "quotation.created",
      entityType: "quotation", entityId: id, details: { quotationNumber, totalCents: calculation.totalCents },
    });
    return {
      id, quotationNumber, customerId: customers[0].id, customerName: customers[0].name,
      status: "draft", currency: input.currency ?? request.tenant.currency,
      issueDate, expiryDate: input.expiryDate, ...calculation, items: calculation.items,
    };
  });
  response.status(201).json({ data: quotation });
});

router.post("/quotations/:id/convert", requirePermission("invoices:write"), requirePlanFeature("quotations"), async (request, response) => {
  const quotationId = routeId(request.params.id);
  const invoice = await inTransaction(async (connection) => {
    const [quotations] = await connection.execute(
      `SELECT q.*, c.name AS customer_name, c.email AS customer_email
       FROM quotations q INNER JOIN customers c ON c.tenant_id = q.tenant_id AND c.id = q.customer_id
       WHERE q.tenant_id = ? AND q.id = ? FOR UPDATE`,
      [request.tenant.id, quotationId],
    );
    const quotation = quotations[0];
    if (!quotation) throw new HttpError(404, "QUOTATION_NOT_FOUND", "Quotation not found.");
    if (!["accepted", "draft"].includes(quotation.status)) throw new HttpError(409, "QUOTATION_NOT_CONVERTIBLE", "Only an accepted or draft quotation can be converted.");
    if (quotation.expiry_date < new Date().toISOString().slice(0, 10)) throw new HttpError(409, "QUOTATION_EXPIRED", "This quotation has expired.");
    const [items] = await connection.execute(
      `SELECT description, quantity, unit_price_cents, tax_rate_bps, line_total_cents
       FROM quotation_items WHERE tenant_id = ? AND quotation_id = ?`,
      [request.tenant.id, quotationId],
    );
    const invoiceId = randomUUID();
    const issueDate = new Date().toISOString().slice(0, 10);
    const invoiceNumber = await getNextInvoiceNumber(connection, request.tenant.id, Number(issueDate.slice(0, 4)), request.tenant.invoice_prefix);
    const snapshot = {
      business: { name: request.tenant.name, email: request.tenant.email, phone: request.tenant.phone, address: request.tenant.address },
      customer: { name: quotation.customer_name, email: quotation.customer_email },
      invoice: {
        invoiceNumber, issueDate, dueDate: quotation.expiry_date, currency: quotation.currency,
        subtotalCents: Number(quotation.subtotal_cents), discountCents: Number(quotation.discount_cents),
        taxRateBps: quotation.tax_rate_bps, taxCents: Number(quotation.tax_cents),
        totalCents: Number(quotation.total_cents),
      },
    };
    await connection.execute(
      `INSERT INTO invoices (id, tenant_id, customer_id, invoice_number, status, currency, issue_date, due_date,
       subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents, issued_snapshot, issued_at, created_by)
       VALUES (?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)`,
      [invoiceId, request.tenant.id, quotation.customer_id, invoiceNumber, quotation.currency, issueDate,
        quotation.expiry_date, quotation.subtotal_cents, quotation.discount_cents, quotation.tax_rate_bps, quotation.tax_cents,
        quotation.total_cents, JSON.stringify(snapshot), request.auth.userId],
    );
    for (const item of items) {
      await connection.execute(
        `INSERT INTO invoice_items (id, tenant_id, invoice_id, description, quantity, unit_price_cents, tax_rate_bps, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), request.tenant.id, invoiceId, item.description, item.quantity,
          item.unit_price_cents, item.tax_rate_bps, item.line_total_cents],
      );
    }
    await connection.execute(
      "UPDATE quotations SET status = 'converted', converted_invoice_id = ? WHERE tenant_id = ? AND id = ?",
      [invoiceId, request.tenant.id, quotationId],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "quotation.converted",
      entityType: "quotation", entityId: quotationId, details: { invoiceId, invoiceNumber },
    });
    return { id: invoiceId, invoiceNumber, customerId: quotation.customer_id, customerName: quotation.customer_name, status: "issued", currency: quotation.currency, totalCents: Number(quotation.total_cents) };
  });
  response.status(201).json({ data: invoice });
});

async function createAdjustmentNote(request, response, kind) {
  const noteSchema = z.object({
    invoiceId: z.string().uuid(),
    reason: z.string().trim().min(3).max(1000),
    amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  });
  const input = noteSchema.parse(request.body);
  const note = await inTransaction(async (connection) => {
    const [invoices] = await connection.execute(
      "SELECT id, invoice_number, status, currency, total_cents, amount_paid_cents FROM invoices WHERE tenant_id = ? AND id = ? FOR UPDATE",
      [request.tenant.id, input.invoiceId],
    );
    const invoice = invoices[0];
    if (!invoice) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found in this business.");
    if (invoice.status !== "issued") throw new HttpError(409, "INVOICE_NOT_ISSUED", "Adjustment notes require an issued invoice.");
    const [creditRows] = kind === "credit" ? await connection.execute(
      "SELECT COALESCE(SUM(amount_cents), 0) AS credited_cents FROM credit_notes WHERE tenant_id = ? AND invoice_id = ? AND status = 'issued'",
      [request.tenant.id, invoice.id],
    ) : [[]];
    const creditedCents = Number(creditRows[0]?.credited_cents ?? 0);
    if (kind === "credit" && input.amountCents > Number(invoice.total_cents) - creditedCents) {
      throw new HttpError(400, "CREDIT_EXCEEDS_INVOICE", "Total issued credits cannot exceed the invoice total.");
    }
    const id = randomUUID();
    const number = await getNextInvoiceNumber(connection, request.tenant.id, new Date().getUTCFullYear(), `${request.tenant.invoice_prefix}-${kind === "credit" ? "CN" : "DN"}`);
    const table = kind === "credit" ? "credit_notes" : "debit_notes";
    await connection.execute(
      `INSERT INTO ${table} (id, tenant_id, invoice_id, note_number, reason, amount_cents, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'issued', ?)`,
      [id, request.tenant.id, invoice.id, number, input.reason, input.amountCents, request.auth.userId],
    );
    if (kind === "debit") {
      await connection.execute(
        "UPDATE invoices SET total_cents = total_cents + ? WHERE tenant_id = ? AND id = ?",
        [input.amountCents, request.tenant.id, invoice.id],
      );
    }
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: `${kind}_note.issued`,
      entityType: `${kind}_note`, entityId: id,
      details: { invoiceId: invoice.id, amountCents: input.amountCents, reason: input.reason },
    });
    return { id, noteNumber: number, invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, amountCents: input.amountCents, reason: input.reason };
  });
  response.status(201).json({ data: note });
}

router.post("/credit-notes", requirePermission("invoices:write"), async (request, response) => createAdjustmentNote(request, response, "credit"));
router.post("/debit-notes", requirePermission("invoices:write"), async (request, response) => createAdjustmentNote(request, response, "debit"));

router.get("/adjustment-notes", requirePermission("invoices:read"), async (request, response) => {
  const { limit, offset } = pageQuery(request);
  const [rows] = await pool.execute(
    `SELECT * FROM (
       SELECT n.id, 'credit' AS kind, n.note_number AS noteNumber, n.invoice_id AS invoiceId,
              i.invoice_number AS invoiceNumber, i.currency, c.name AS customerName, n.reason,
              n.amount_cents AS amountCents, n.status, n.created_at AS createdAt
       FROM credit_notes n
       INNER JOIN invoices i ON i.tenant_id = n.tenant_id AND i.id = n.invoice_id
       INNER JOIN customers c ON c.tenant_id = i.tenant_id AND c.id = i.customer_id
       WHERE n.tenant_id = ?
       UNION ALL
       SELECT n.id, 'debit' AS kind, n.note_number AS noteNumber, n.invoice_id AS invoiceId,
              i.invoice_number AS invoiceNumber, i.currency, c.name AS customerName, n.reason,
              n.amount_cents AS amountCents, n.status, n.created_at AS createdAt
       FROM debit_notes n
       INNER JOIN invoices i ON i.tenant_id = n.tenant_id AND i.id = n.invoice_id
       INNER JOIN customers c ON c.tenant_id = i.tenant_id AND c.id = i.customer_id
       WHERE n.tenant_id = ?
     ) adjustment_notes
     ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    [request.tenant.id, request.tenant.id, limit, offset],
  );
  response.json({
    data: rows.map((row) => ({ ...row, amountCents: Number(row.amountCents) })),
    meta: { limit, offset },
  });
});

router.get("/recurring-invoices", requirePermission("invoices:read"), async (request, response) => {
  const [rows] = await pool.execute(
    `SELECT r.id, r.frequency, r.next_run_at AS nextRunAt, r.end_date AS endDate,
            r.active, c.id AS customerId, c.name AS customerName, r.template, r.created_at AS createdAt
     FROM recurring_invoices r INNER JOIN customers c ON c.tenant_id = r.tenant_id AND c.id = r.customer_id
     WHERE r.tenant_id = ? ORDER BY r.next_run_at`,
    [request.tenant.id],
  );
  response.json({ data: rows.map((row) => ({ ...row, template: typeof row.template === "string" ? JSON.parse(row.template) : row.template })) });
});

router.post("/recurring-invoices", requirePermission("invoices:write"), requirePlanFeature("recurringInvoices"), async (request, response) => {
  const recurringSchema = z.object({
    customerId: z.string().uuid(),
    frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    nextRunAt: z.string().date(),
    endDate: z.string().date().nullable().optional(),
    invoice: createInvoiceSchema.omit({ customerId: true, issueDate: true, issueNow: true }).extend({
      dueInDays: z.number().int().min(0).max(365).optional().default(14),
    }),
  }).superRefine((value, context) => {
    if (value.endDate && value.endDate < value.nextRunAt) {
      context.addIssue({ code: "custom", path: ["endDate"], message: "The end date must be on or after the first scheduled date." });
    }
  });
  const input = recurringSchema.parse(request.body);
  const recurring = await inTransaction(async (connection) => {
    const [customers] = await connection.execute(
      "SELECT id FROM customers WHERE tenant_id = ? AND id = ? AND archived_at IS NULL FOR UPDATE",
      [request.tenant.id, input.customerId],
    );
    if (!customers.length) throw new HttpError(404, "CUSTOMER_NOT_FOUND", "Customer not found in this business.");
    const calculation = calculateInvoice(input.invoice.items, input.invoice.discountCents, input.invoice.taxRateBps ?? request.tenant.tax_rate_bps);
    const id = randomUUID();
    const template = {
      ...input.invoice,
      dueDate: addDays(input.nextRunAt, input.invoice.dueInDays),
      issueDate: null,
      customerId: input.customerId,
      anchorDay: Number(input.nextRunAt.slice(8, 10)),
      subtotalCents: calculation.subtotalCents,
      taxCents: calculation.taxCents,
      totalCents: calculation.totalCents,
    };
    await connection.execute(
      `INSERT INTO recurring_invoices (id, tenant_id, customer_id, frequency, next_run_at, end_date, template, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, request.tenant.id, input.customerId, input.frequency, input.nextRunAt, input.endDate ?? null, JSON.stringify(template), request.auth.userId],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "recurring_invoice.created",
      entityType: "recurring_invoice", entityId: id, details: { frequency: input.frequency, nextRunAt: input.nextRunAt },
    });
    return { id, customerId: input.customerId, frequency: input.frequency, nextRunAt: input.nextRunAt, endDate: input.endDate ?? null, active: true, template };
  });
  response.status(201).json({ data: recurring });
});

router.patch("/recurring-invoices/:id", requirePermission("invoices:write"), async (request, response) => {
  const id = routeId(request.params.id);
  const { active } = z.object({ active: z.boolean() }).parse(request.body);
  const [result] = await pool.execute(
    "UPDATE recurring_invoices SET active = ? WHERE tenant_id = ? AND id = ?",
    [active, request.tenant.id, id],
  );
  if (!result.affectedRows) throw new HttpError(404, "RECURRING_INVOICE_NOT_FOUND", "Recurring invoice not found.");
  await inTransaction((connection) => writeAudit(connection, {
    tenantId: request.tenant.id, userId: request.auth.userId, action: active ? "recurring_invoice.activated" : "recurring_invoice.paused",
    entityType: "recurring_invoice", entityId: id,
  }));
  response.json({ data: { id, active } });
});

router.get("/branches", requirePermission("business:read"), async (request, response) => {
  const [rows] = await pool.execute(
    `SELECT id, name, address, phone, is_default AS isDefault, created_at AS createdAt
     FROM branches WHERE tenant_id = ? ORDER BY is_default DESC, name ASC`,
    [request.tenant.id],
  );
  response.json({ data: rows });
});

router.get("/users", requirePermission("users:manage"), async (request, response) => {
  const { limit, offset } = pageQuery(request);
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name AS fullName, u.email, m.role, m.created_at AS joinedAt
     FROM memberships m INNER JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = ? AND m.active = TRUE
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.full_name
     LIMIT ? OFFSET ?`,
    [request.tenant.id, limit, offset],
  );
  response.json({ data: rows, meta: { limit, offset } });
});

router.post("/users/invitations", requirePermission("users:manage"), async (request, response) => {
  const input = z.object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    role: z.enum(["admin", "finance_manager", "accountant", "sales_officer", "cashier", "auditor"]),
  }).parse(request.body);
  const [alreadyMember] = await pool.execute(
    `SELECT 1 FROM memberships m INNER JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = ? AND m.active = TRUE AND u.email = ? LIMIT 1`,
    [request.tenant.id, input.email],
  );
  if (alreadyMember.length) throw new HttpError(409, "ALREADY_A_MEMBER", "This person already belongs to the business.");
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await inTransaction(async (connection) => {
    await assertUserCapacity(connection, request.tenant.id, request.isPlatformAdmin);
    await connection.execute(
      `UPDATE membership_invitations SET expires_at = UTC_TIMESTAMP(3)
       WHERE tenant_id = ? AND invited_email = ? AND accepted_at IS NULL AND expires_at > UTC_TIMESTAMP(3)`,
      [request.tenant.id, input.email],
    );
    await connection.execute(
      `INSERT INTO membership_invitations (id, tenant_id, invited_email, role, token_hash, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY))`,
      [id, request.tenant.id, input.email, input.role, createHash("sha256").update(token).digest(), request.auth.userId],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "membership.invitation_created",
      entityType: "membership_invitation", entityId: id, details: { email: input.email, role: input.role },
    });
  });
  response.status(201).json({
    data: {
      id,
      email: input.email,
      role: input.role,
      expiresInDays: 7,
      acceptPath: `/accept-invitation?token=${encodeURIComponent(token)}`,
    },
  });
});

router.delete("/users/:id", requirePermission("users:manage"), async (request, response) => {
  const userId = routeId(request.params.id);
  if (userId === request.auth.userId) throw new HttpError(409, "CANNOT_REMOVE_SELF", "You cannot remove your own active session from this business.");
  await inTransaction(async (connection) => {
    const [members] = await connection.execute(
      `SELECT role, active FROM memberships WHERE tenant_id = ? AND user_id = ? FOR UPDATE`,
      [request.tenant.id, userId],
    );
    if (!members.length || !members[0].active) throw new HttpError(404, "MEMBERSHIP_NOT_FOUND", "Business member not found.");
    if (members[0].role === "owner") throw new HttpError(409, "OWNER_CANNOT_BE_REMOVED", "Transfer business ownership before removing an owner.");
    await connection.execute(
      "UPDATE memberships SET active = FALSE WHERE tenant_id = ? AND user_id = ?",
      [request.tenant.id, userId],
    );
    await connection.execute(
      "UPDATE sessions SET active_tenant_id = NULL WHERE user_id = ? AND active_tenant_id = ?",
      [userId, request.tenant.id],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId,
      action: "membership.removed", entityType: "membership", entityId: userId,
    });
  });
  response.status(204).end();
});

router.post("/branches", requirePermission("business:update"), requirePlanFeature("branches"), async (request, response) => {
  const input = z.object({
    name: z.string().trim().min(1).max(160),
    address: z.string().trim().max(500).optional().default(""),
    phone: z.string().trim().max(40).optional().default(""),
  }).parse(request.body);
  const id = randomUUID();
  await inTransaction(async (connection) => {
    await connection.execute(
      "INSERT INTO branches (id, tenant_id, name, address, phone) VALUES (?, ?, ?, ?, ?)",
      [id, request.tenant.id, input.name, input.address || null, input.phone || null],
    );
    await writeAudit(connection, { tenantId: request.tenant.id, userId: request.auth.userId, action: "branch.created", entityType: "branch", entityId: id });
  });
  response.status(201).json({ data: { id, ...input, isDefault: false } });
});

router.get("/suppliers", requirePermission("suppliers:read"), async (request, response) => {
  const { limit, offset, search } = pageQuery(request);
  const term = `%${search}%`;
  const [rows] = await pool.execute(
    `SELECT id, name, email, phone, tax_pin AS taxPin, address, notes, created_at AS createdAt
     FROM suppliers
     WHERE tenant_id = ? AND archived_at IS NULL
       AND (? = '' OR CONCAT_WS(' ', name, email, phone, tax_pin) LIKE ?)
     ORDER BY name, created_at DESC LIMIT ? OFFSET ?`,
    [request.tenant.id, search, term, limit, offset],
  );
  response.json({ data: rows, meta: { limit, offset } });
});

router.post("/suppliers", requirePermission("suppliers:write"), async (request, response) => {
  const input = supplierSchema.parse(request.body);
  const id = randomUUID();
  await inTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO suppliers (id, tenant_id, name, email, phone, tax_pin, address, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, request.tenant.id, input.name, input.email || null, input.phone || null, input.taxPin || null,
        input.address || null, input.notes || null, request.auth.userId],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "supplier.created",
      entityType: "supplier", entityId: id,
    });
  });
  response.status(201).json({ data: { id, ...input, createdAt: new Date().toISOString() } });
});

router.patch("/suppliers/:id", requirePermission("suppliers:write"), async (request, response) => {
  const id = routeId(request.params.id);
  const input = supplierSchema.parse(request.body);
  await inTransaction(async (connection) => {
    const [existing] = await connection.execute(
      "SELECT id FROM suppliers WHERE tenant_id = ? AND id = ? AND archived_at IS NULL FOR UPDATE",
      [request.tenant.id, id],
    );
    if (!existing.length) throw new HttpError(404, "SUPPLIER_NOT_FOUND", "Supplier not found.");
    await connection.execute(
      `UPDATE suppliers SET name = ?, email = ?, phone = ?, tax_pin = ?, address = ?, notes = ?
       WHERE tenant_id = ? AND id = ? AND archived_at IS NULL`,
      [input.name, input.email || null, input.phone || null, input.taxPin || null, input.address || null,
        input.notes || null, request.tenant.id, id],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "supplier.updated",
      entityType: "supplier", entityId: id,
    });
  });
  response.json({ data: { id, ...input } });
});

router.post("/suppliers/:id/archive", requirePermission("suppliers:write"), async (request, response) => {
  const id = routeId(request.params.id);
  await inTransaction(async (connection) => {
    const [result] = await connection.execute(
      "UPDATE suppliers SET archived_at = UTC_TIMESTAMP(3) WHERE tenant_id = ? AND id = ? AND archived_at IS NULL",
      [request.tenant.id, id],
    );
    if (!result.affectedRows) throw new HttpError(404, "SUPPLIER_NOT_FOUND", "Supplier not found.");
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "supplier.archived",
      entityType: "supplier", entityId: id,
    });
  });
  response.json({ data: { id, archived: true } });
});

router.get("/expenses", requirePermission("expenses:read"), async (request, response) => {
  const { limit, offset, search } = pageQuery(request);
  const term = `%${search}%`;
  const [rows] = await pool.execute(
    `SELECT e.id, e.supplier_id AS supplierId, s.name AS supplierName, e.expense_date AS expenseDate,
            e.category, e.description, e.reference, e.subtotal_cents AS subtotalCents,
            e.tax_rate_bps AS taxRateBps, e.tax_cents AS taxCents, e.currency,
            e.created_at AS createdAt
     FROM expenses e
     LEFT JOIN suppliers s ON s.tenant_id = e.tenant_id AND s.id = e.supplier_id
     WHERE e.tenant_id = ? AND e.voided_at IS NULL
       AND (? = '' OR CONCAT_WS(' ', e.category, e.description, e.reference, s.name) LIKE ?)
     ORDER BY e.expense_date DESC, e.created_at DESC LIMIT ? OFFSET ?`,
    [request.tenant.id, search, term, limit, offset],
  );
  response.json({
    data: rows.map((row) => ({
      ...row,
      subtotalCents: Number(row.subtotalCents),
      taxCents: Number(row.taxCents),
      taxRateBps: Number(row.taxRateBps),
    })),
    meta: { limit, offset },
  });
});

router.post("/expenses", requirePermission("expenses:write"), async (request, response) => {
  const input = expenseSchema.parse(request.body);
  const taxCents = calculateExpenseTax(input.subtotalCents, input.taxRateBps);
  const id = randomUUID();
  await inTransaction(async (connection) => {
    if (input.supplierId) {
      const [suppliers] = await connection.execute(
        "SELECT id FROM suppliers WHERE tenant_id = ? AND id = ? AND archived_at IS NULL",
        [request.tenant.id, input.supplierId],
      );
      if (!suppliers.length) throw new HttpError(400, "INVALID_SUPPLIER", "Choose an active supplier in this business.");
    }
    await connection.execute(
      `INSERT INTO expenses
         (id, tenant_id, supplier_id, expense_date, category, description, reference,
          subtotal_cents, tax_rate_bps, tax_cents, currency, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, request.tenant.id, input.supplierId, input.expenseDate, input.category, input.description,
        input.reference || null, input.subtotalCents, input.taxRateBps, taxCents, input.currency, request.auth.userId],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "expense.created",
      entityType: "expense", entityId: id,
      details: { supplierId: input.supplierId, subtotalCents: input.subtotalCents, taxCents, currency: input.currency },
    });
  });
  response.status(201).json({ data: { id, ...input, taxCents, createdAt: new Date().toISOString() } });
});

router.patch("/expenses/:id", requirePermission("expenses:write"), async (request, response) => {
  const id = routeId(request.params.id);
  const input = expenseSchema.parse(request.body);
  const taxCents = calculateExpenseTax(input.subtotalCents, input.taxRateBps);
  await inTransaction(async (connection) => {
    const [existing] = await connection.execute(
      "SELECT id FROM expenses WHERE tenant_id = ? AND id = ? AND voided_at IS NULL FOR UPDATE",
      [request.tenant.id, id],
    );
    if (!existing.length) throw new HttpError(404, "EXPENSE_NOT_FOUND", "Expense not found.");
    if (input.supplierId) {
      const [suppliers] = await connection.execute(
        "SELECT id FROM suppliers WHERE tenant_id = ? AND id = ? AND archived_at IS NULL",
        [request.tenant.id, input.supplierId],
      );
      if (!suppliers.length) throw new HttpError(400, "INVALID_SUPPLIER", "Choose an active supplier in this business.");
    }
    await connection.execute(
      `UPDATE expenses SET supplier_id = ?, expense_date = ?, category = ?, description = ?, reference = ?,
              subtotal_cents = ?, tax_rate_bps = ?, tax_cents = ?, currency = ?
       WHERE tenant_id = ? AND id = ? AND voided_at IS NULL`,
      [input.supplierId, input.expenseDate, input.category, input.description, input.reference || null,
        input.subtotalCents, input.taxRateBps, taxCents, input.currency, request.tenant.id, id],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "expense.updated",
      entityType: "expense", entityId: id,
      details: { supplierId: input.supplierId, subtotalCents: input.subtotalCents, taxCents, currency: input.currency },
    });
  });
  response.json({ data: { id, ...input, taxCents } });
});

router.post("/expenses/:id/void", requirePermission("expenses:write"), async (request, response) => {
  const id = routeId(request.params.id);
  await inTransaction(async (connection) => {
    const [result] = await connection.execute(
      "UPDATE expenses SET voided_at = UTC_TIMESTAMP(3) WHERE tenant_id = ? AND id = ? AND voided_at IS NULL",
      [request.tenant.id, id],
    );
    if (!result.affectedRows) throw new HttpError(404, "EXPENSE_NOT_FOUND", "Expense not found.");
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "expense.voided",
      entityType: "expense", entityId: id,
    });
  });
  response.json({ data: { id, voided: true } });
});

router.get("/notifications", async (request, response) => {
  const { limit, offset } = pageQuery(request);
  const [rows] = await pool.execute(
    `SELECT id, type, title, body, read_at AS readAt, created_at AS createdAt
     FROM notifications WHERE tenant_id = ? AND (user_id IS NULL OR user_id = ?)
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [request.tenant.id, request.auth.userId, limit, offset],
  );
  response.json({ data: rows, meta: { limit, offset } });
});

router.post("/notifications/:id/read", async (request, response) => {
  const id = routeId(request.params.id);
  const [result] = await pool.execute(
    `UPDATE notifications SET read_at = UTC_TIMESTAMP(3)
     WHERE tenant_id = ? AND id = ? AND (user_id IS NULL OR user_id = ?)`,
    [request.tenant.id, id, request.auth.userId],
  );
  if (!result.affectedRows) throw new HttpError(404, "NOTIFICATION_NOT_FOUND", "Notification not found.");
  response.json({ data: { id, read: true } });
});

router.get("/audit-logs", requirePermission("audit:read"), async (request, response) => {
  const { limit, offset } = pageQuery(request);
  const [rows] = await pool.execute(
    `SELECT l.id, l.action, l.entity_type AS entityType, l.entity_id AS entityId,
            l.details, l.created_at AS createdAt, u.full_name AS actorName, u.email AS actorEmail
     FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id
     WHERE l.tenant_id = ? ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
    [request.tenant.id, limit, offset],
  );
  response.json({ data: rows.map((row) => ({ ...row, details: typeof row.details === "string" ? JSON.parse(row.details) : row.details })), meta: { limit, offset } });
});

router.post("/invoices", requirePermission("invoices:write"), async (request, response) => {
  const input = createInvoiceSchema.parse(request.body);
  let invoice;
  try {
    invoice = await inTransaction(async (connection) => {
      if (input.issueNow) await assertInvoiceCapacity(connection, request.tenant.id, undefined, undefined, request.isPlatformAdmin);
      const [customers] = await connection.execute(
        `SELECT id, name, company, email, phone, billing_address, kra_pin
         FROM customers WHERE tenant_id = ? AND id = ? AND archived_at IS NULL FOR UPDATE`,
        [request.tenant.id, input.customerId],
      );
      if (!customers.length) throw new HttpError(404, "CUSTOMER_NOT_FOUND", "Customer not found in this business.");
      const customer = customers[0];
      const calculated = calculateInvoice(input.items, input.discountCents, input.taxRateBps ?? request.tenant.tax_rate_bps);
      if (input.issueNow && calculated.totalCents <= 0) throw new HttpError(400, "ZERO_TOTAL", "An issued invoice must have a total greater than zero.");
      const [templates] = input.templateId
        ? await connection.execute(
          "SELECT id, name, config FROM invoice_templates WHERE tenant_id = ? AND id = ? LIMIT 1",
          [request.tenant.id, input.templateId],
        )
        : await connection.execute(
          "SELECT id, name, config FROM invoice_templates WHERE tenant_id = ? AND is_default = TRUE ORDER BY created_at ASC LIMIT 1",
          [request.tenant.id],
        );
      if (input.templateId && !templates.length) throw new HttpError(404, "TEMPLATE_NOT_FOUND", "Invoice template not found in this business.");
      const template = templates[0] ?? null;
      const templateConfig = template ? parseTemplateConfig(template.config) : null;
      const id = randomUUID();
      const issueDate = input.issueDate ?? new Date().toISOString().slice(0, 10);
      const year = Number(issueDate.slice(0, 4));
      const invoiceNumber = await getNextInvoiceNumber(connection, request.tenant.id, year, request.tenant.invoice_prefix);
      const currency = input.currency ?? request.tenant.currency;
      const status = input.issueNow ? "issued" : "draft";
      const snapshot = input.issueNow ? {
        business: {
          name: request.tenant.name,
          email: request.tenant.email,
          phone: request.tenant.phone,
          address: request.tenant.address,
        },
        customer: {
          name: customer.name,
          company: customer.company,
          email: customer.email,
          phone: customer.phone,
          billingAddress: customer.billing_address,
          kraPin: customer.kra_pin,
        },
        invoice: { invoiceNumber, issueDate, dueDate: input.dueDate, currency, ...calculated },
        template: template ? { id: template.id, name: template.name, config: templateConfig } : null,
      } : null;

      await connection.execute(
        `INSERT INTO invoices
         (id, tenant_id, customer_id, template_id, template_name_snapshot, template_config_snapshot,
          invoice_number, status, currency, issue_date, due_date,
          subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents, notes, terms,
          issued_snapshot, issued_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, request.tenant.id, customer.id, template?.id ?? null, template?.name ?? null,
          templateConfig ? JSON.stringify(templateConfig) : null, invoiceNumber, status, currency, issueDate, input.dueDate,
          calculated.subtotalCents, calculated.discountCents, input.taxRateBps ?? request.tenant.tax_rate_bps,
          calculated.taxCents, calculated.totalCents, input.notes || null, input.terms || null,
          snapshot ? JSON.stringify(snapshot) : null, input.issueNow ? new Date() : null, request.auth.userId],
      );
      for (let index = 0; index < calculated.items.length; index += 1) {
        const item = calculated.items[index];
        const source = input.items[index];
        await connection.execute(
          `INSERT INTO invoice_items
           (id, tenant_id, invoice_id, product_id, description, quantity, unit_price_cents, discount_cents, tax_rate_bps, line_total_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), request.tenant.id, id, source.productId ?? null, item.description, item.quantity,
            item.unitPriceCents, item.lineDiscountCents, item.taxRateBps, item.lineTotalCents],
        );
      }
      await writeAudit(connection, {
        tenantId: request.tenant.id, userId: request.auth.userId,
        action: input.issueNow ? "invoice.issued" : "invoice.draft_created",
        entityType: "invoice", entityId: id, details: { invoiceNumber, totalCents: calculated.totalCents, currency },
      });
      return {
        id, customerId: customer.id, customerName: customer.name, customerEmail: customer.email, invoiceNumber,
        status, currency, issueDate, dueDate: input.dueDate, templateId: template?.id ?? null,
        templateName: template?.name ?? null, templateConfig, ...calculated,
        amountPaidCents: 0, notes: input.notes, terms: input.terms,
      };
    });
  } catch (error) {
    if (error instanceof RangeError) throw new HttpError(400, "INVALID_TOTAL", error.message);
    throw error;
  }
  response.status(201).json({ data: invoice });
});

router.post("/invoices/:id/issue", requirePermission("invoices:write"), async (request, response) => {
  const id = routeId(request.params.id);
  const invoice = await inTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT i.*, c.name AS customer_name, c.company AS customer_company, c.email AS customer_email,
              c.phone AS customer_phone, c.billing_address AS customer_address, c.kra_pin AS customer_kra_pin
       FROM invoices i
       INNER JOIN customers c ON c.tenant_id = i.tenant_id AND c.id = i.customer_id
       WHERE i.tenant_id = ? AND i.id = ? FOR UPDATE`,
      [request.tenant.id, id],
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
    if (row.status !== "draft") throw new HttpError(409, "INVOICE_NOT_DRAFT", "Only a draft invoice can be issued.");
    if (Number(row.total_cents) <= 0) throw new HttpError(400, "ZERO_TOTAL", "An issued invoice must have a total greater than zero.");
    await assertInvoiceCapacity(connection, request.tenant.id, undefined, undefined, request.isPlatformAdmin);
    const items = await invoiceItems(request.tenant.id, id, connection);
    const snapshot = {
      business: {
        name: request.tenant.name, email: request.tenant.email,
        phone: request.tenant.phone, address: request.tenant.address,
      },
      customer: {
        name: row.customer_name, company: row.customer_company, email: row.customer_email,
        phone: row.customer_phone, billingAddress: row.customer_address, kraPin: row.customer_kra_pin,
      },
      invoice: {
        invoiceNumber: row.invoice_number, issueDate: row.issue_date, dueDate: row.due_date,
        currency: row.currency, subtotalCents: Number(row.subtotal_cents),
        discountCents: Number(row.discount_cents), taxRateBps: row.tax_rate_bps,
        taxCents: Number(row.tax_cents), totalCents: Number(row.total_cents), items,
      },
      template: row.template_id ? {
        id: row.template_id,
        name: row.template_name_snapshot,
        config: parseTemplateConfig(row.template_config_snapshot),
      } : null,
    };
    await connection.execute(
      "UPDATE invoices SET status = 'issued', issued_snapshot = ?, issued_at = UTC_TIMESTAMP(3) WHERE tenant_id = ? AND id = ?",
      [JSON.stringify(snapshot), request.tenant.id, id],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "invoice.issued",
      entityType: "invoice", entityId: id, details: { invoiceNumber: row.invoice_number, totalCents: Number(row.total_cents) },
    });
    return { ...row, status: "issued", items };
  });
  response.json({ data: serializeInvoice(invoice) });
});

router.post("/invoices/:id/void", requirePermission("invoices:write"), async (request, response) => {
  const id = routeId(request.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3).max(1000) }).parse(request.body);
  const invoice = await inTransaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT id, invoice_number, status, amount_paid_cents FROM invoices WHERE tenant_id = ? AND id = ? FOR UPDATE",
      [request.tenant.id, id],
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
    if (row.status !== "issued") throw new HttpError(409, "INVOICE_NOT_ISSUED", "Only an issued invoice can be voided.");
    if (Number(row.amount_paid_cents) !== 0) throw new HttpError(409, "INVOICE_HAS_PAYMENTS", "Create a credit note or reverse the payments before voiding this invoice.");
    await connection.execute(
      "UPDATE invoices SET status = 'void', voided_at = UTC_TIMESTAMP(3) WHERE tenant_id = ? AND id = ?",
      [request.tenant.id, id],
    );
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "invoice.voided",
      entityType: "invoice", entityId: id, details: { reason },
    });
    return row;
  });
  response.json({ data: { id: invoice.id, invoiceNumber: invoice.invoice_number, status: "void" } });
});

router.get("/payments", requirePermission("payments:read"), async (request, response) => {
  const { search, limit, offset } = pageQuery(request);
  const like = `%${search}%`;
  const [rows] = await pool.execute(
    `SELECT p.id, p.amount_cents AS amountCents, p.currency, p.method, p.reference,
            p.received_at AS receivedAt, i.id AS invoiceId, i.invoice_number AS invoiceNumber,
            c.name AS customerName, a.amount_cents AS allocatedCents
     FROM payments p
     INNER JOIN customers c ON c.tenant_id = p.tenant_id AND c.id = p.customer_id
     LEFT JOIN payment_allocations a ON a.tenant_id = p.tenant_id AND a.payment_id = p.id
     LEFT JOIN invoices i ON i.tenant_id = a.tenant_id AND i.id = a.invoice_id
     WHERE p.tenant_id = ? AND p.status = 'completed'
       AND (? = '' OR c.name LIKE ? OR p.reference LIKE ? OR i.invoice_number LIKE ?)
     ORDER BY p.received_at DESC LIMIT ? OFFSET ?`,
    [request.tenant.id, search, like, like, like, limit, offset],
  );
  response.json({ data: rows.map((row) => ({
    ...row,
    amountCents: Number(row.amountCents),
    allocatedCents: Number(row.allocatedCents ?? 0),
    date: row.receivedAt,
  })), meta: { limit, offset } });
});

router.get("/payments/:id/receipt.pdf", requirePermission("payments:read"), async (request, response) => {
  const id = routeId(request.params.id);
  const [rows] = await pool.execute(
    `SELECT p.id, p.amount_cents, p.currency, p.method, p.reference, p.received_at, p.status,
            c.name AS customer_name, c.company AS customer_company, c.email AS customer_email
     FROM payments p
     INNER JOIN customers c ON c.tenant_id = p.tenant_id AND c.id = p.customer_id
     WHERE p.tenant_id = ? AND p.id = ? LIMIT 1`,
    [request.tenant.id, id],
  );
  const payment = rows[0];
  if (!payment) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
  if (payment.status !== "completed") throw new HttpError(409, "PAYMENT_NOT_COMPLETED", "A receipt is only available for a completed payment.");
  const [businessRows] = await pool.execute(
    "SELECT invoice_logo AS logo, invoice_logo_mime_type AS logoMimeType, invoice_letterhead AS letterhead, invoice_letterhead_mime_type AS letterheadMimeType, invoice_layout AS invoiceLayout FROM tenants WHERE id = ? LIMIT 1",
    [request.tenant.id],
  );
  const [allocations] = await pool.execute(
    `SELECT i.invoice_number AS invoiceNumber, a.amount_cents AS amountCents
     FROM payment_allocations a
     INNER JOIN invoices i ON i.tenant_id = a.tenant_id AND i.id = a.invoice_id
     WHERE a.tenant_id = ? AND a.payment_id = ? ORDER BY i.invoice_number`,
    [request.tenant.id, id],
  );
  const pdf = await createReceiptPdf({
    business: {
      name: request.tenant.name,
      email: request.tenant.email,
      phone: request.tenant.phone,
      address: request.tenant.address,
      logo: businessRows[0]?.logo,
      logoMimeType: businessRows[0]?.logoMimeType,
      letterhead: businessRows[0]?.letterhead,
      letterheadMimeType: businessRows[0]?.letterheadMimeType,
      invoiceLayout: businessRows[0]?.invoiceLayout,
    },
    customer: { name: payment.customer_name, company: payment.customer_company, email: payment.customer_email },
    receiptNumber: `RCT-${id.slice(0, 8).toUpperCase()}`,
    receivedAt: payment.received_at,
    amountCents: Number(payment.amount_cents),
    currency: payment.currency,
    method: payment.method,
    reference: payment.reference,
    allocations: allocations.map((allocation) => ({ ...allocation, amountCents: Number(allocation.amountCents) })),
  });
  response.status(200).type("application/pdf").attachment(`receipt-${id.slice(0, 8)}.pdf`).send(pdf);
});

router.post("/payments", requirePermission("payments:write"), requirePlanFeature("payments"), async (request, response) => {
  const input = paymentSchema.parse(request.body);
  const payment = await inTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT i.id, i.customer_id, i.invoice_number, i.status, i.currency,
              i.total_cents, i.amount_paid_cents,
              COALESCE((SELECT SUM(cn.amount_cents) FROM credit_notes cn
                WHERE cn.tenant_id = i.tenant_id AND cn.invoice_id = i.id AND cn.status = 'issued'), 0) AS credited_cents
       FROM invoices i
       WHERE i.tenant_id = ? AND i.id = ? FOR UPDATE`,
      [request.tenant.id, input.invoiceId],
    );
    const invoice = rows[0];
    if (!invoice) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found in this business.");
    if (invoice.status !== "issued") throw new HttpError(409, "INVOICE_NOT_PAYABLE", "Payments can only be recorded against issued invoices.");
    const remaining = Number(invoice.total_cents) - Number(invoice.amount_paid_cents) - Number(invoice.credited_cents);
    if (input.amountCents > remaining) throw new HttpError(400, "PAYMENT_EXCEEDS_BALANCE", "Payment amount exceeds the invoice balance.");
    const id = randomUUID();
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    await connection.execute(
      `INSERT INTO payments (id, tenant_id, customer_id, amount_cents, currency, method, reference, received_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, request.tenant.id, invoice.customer_id, input.amountCents, invoice.currency, input.method,
        input.reference || null, receivedAt, request.auth.userId],
    );
    await connection.execute(
      "INSERT INTO payment_allocations (id, tenant_id, payment_id, invoice_id, amount_cents) VALUES (?, ?, ?, ?, ?)",
      [randomUUID(), request.tenant.id, id, invoice.id, input.amountCents],
    );
    const [update] = await connection.execute(
      "UPDATE invoices SET amount_paid_cents = amount_paid_cents + ? WHERE tenant_id = ? AND id = ?",
      [input.amountCents, request.tenant.id, invoice.id],
    );
    if (update.affectedRows !== 1) throw new HttpError(409, "PAYMENT_NOT_APPLIED", "Invoice balance changed while recording the payment.");
    await writeAudit(connection, {
      tenantId: request.tenant.id, userId: request.auth.userId, action: "payment.recorded",
      entityType: "payment", entityId: id,
      details: { invoiceId: invoice.id, amountCents: input.amountCents, method: input.method },
    });
    const [customers] = await connection.execute(
      "SELECT name FROM customers WHERE tenant_id = ? AND id = ? LIMIT 1",
      [request.tenant.id, invoice.customer_id],
    );
    return {
      id, invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, customerName: customers[0]?.name ?? "",
      amountCents: input.amountCents, currency: invoice.currency, method: input.method,
      reference: input.reference || "", receivedAt,
    };
  });
  response.status(201).json({ data: payment });
});

router.get("/reports/summary", requirePermission("reports:read"), requirePlanFeature("reports"), async (request, response) => {
  const [invoiceRows] = await pool.execute(
    `SELECT currency,
            SUM(status = 'issued') AS count,
            SUM(CASE WHEN status = 'issued' THEN total_cents ELSE 0 END) AS billed_cents,
            SUM(amount_paid_cents) AS received_cents,
            SUM(CASE WHEN status = 'issued' THEN GREATEST(0, total_cents - amount_paid_cents - COALESCE(
              (SELECT SUM(cn.amount_cents) FROM credit_notes cn
               WHERE cn.tenant_id = invoices.tenant_id AND cn.invoice_id = invoices.id AND cn.status = 'issued'), 0) ELSE 0 END) AS outstanding_cents,
            SUM(status = 'draft') AS drafts,
            SUM(status = 'issued' AND amount_paid_cents + COALESCE(
              (SELECT SUM(cn.amount_cents) FROM credit_notes cn
               WHERE cn.tenant_id = invoices.tenant_id AND cn.invoice_id = invoices.id AND cn.status = 'issued'), 0) >= total_cents) AS paid,
            SUM(status = 'issued' AND amount_paid_cents + COALESCE(
              (SELECT SUM(cn.amount_cents) FROM credit_notes cn
               WHERE cn.tenant_id = invoices.tenant_id AND cn.invoice_id = invoices.id AND cn.status = 'issued'), 0) < total_cents AND due_date >= UTC_DATE()) AS pending,
            SUM(status = 'issued' AND amount_paid_cents + COALESCE(
              (SELECT SUM(cn.amount_cents) FROM credit_notes cn
               WHERE cn.tenant_id = invoices.tenant_id AND cn.invoice_id = invoices.id AND cn.status = 'issued'), 0) < total_cents AND due_date < UTC_DATE()) AS overdue
     FROM invoices WHERE tenant_id = ? AND status IN ('issued','draft')
     GROUP BY currency`,
    [request.tenant.id],
  );
  const [paymentRows] = await pool.execute(
    `SELECT currency, SUM(amount_cents) AS amount_cents, COUNT(*) AS count
     FROM payments WHERE tenant_id = ? AND status = 'completed'
     GROUP BY currency`,
    [request.tenant.id],
  );
  response.json({
    data: {
      invoicesByCurrency: invoiceRows.map((row) => ({
        currency: row.currency, count: Number(row.count),
        billedCents: Number(row.billed_cents ?? 0), receivedCents: Number(row.received_cents ?? 0),
        outstandingCents: Number(row.outstanding_cents ?? 0), drafts: Number(row.drafts ?? 0),
        paid: Number(row.paid ?? 0), pending: Number(row.pending ?? 0), overdue: Number(row.overdue ?? 0),
      })),
      paymentsByCurrency: paymentRows.map((row) => ({
        currency: row.currency, amountCents: Number(row.amount_cents ?? 0), count: Number(row.count),
      })),
    },
  });
});

router.get("/reports/tax-summary", requirePermission("reports:read"), requirePlanFeature("reports"), async (request, response) => {
  const range = taxRangeSchema.parse(request.query);
  response.json({ data: await taxSummaryRows(request.tenant.id, range) });
});

router.get("/reports/exports/tax-management", requirePermission("reports:read"), requirePlanFeature("reports"), async (request, response) => {
  const range = taxRangeSchema.parse(request.query);
  const summaries = await taxSummaryRows(request.tenant.id, range);
  const headers = [
    "from", "to", "currency", "vat_collected_cents", "vat_paid_cents", "net_vat_cents", "invoice_count", "expense_count",
  ];
  csvResponse(response, `tax-management-${new Date().toISOString().slice(0, 10)}.csv`, headers,
    summaries.map((row) => [range.from ?? "", range.to ?? "", row.currency, row.vatCollectedCents, row.vatPaidCents,
      row.netVatCents, row.invoiceCount, row.expenseCount]));
});

router.get("/reports/exports/:report", requirePermission("reports:read"), requirePlanFeature("reports"), async (request, response) => {
  const report = z.enum(["invoices", "payments", "outstanding", "tax"]).parse(request.params.report);
  const range = z.object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  }).superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({ code: "custom", path: ["from"], message: "The start date must be on or before the end date." });
    }
  }).parse(request.query);
  const dateColumn = report === "payments" ? "p.received_at" : "i.issue_date";
  const filters = [];
  const parameters = [request.tenant.id];
  if (range.from) {
    filters.push(`${dateColumn} >= ?`);
    parameters.push(`${range.from} 00:00:00.000`);
  }
  if (range.to) {
    filters.push(`${dateColumn} <= ?`);
    parameters.push(`${range.to} 23:59:59.999`);
  }
  const rangeFilterSql = filters.length ? ` AND ${filters.join(" AND ")}` : "";

  if (report === "invoices" || report === "outstanding") {
    const outstandingOnly = report === "outstanding" ? "AND i.status = 'issued' AND i.total_cents > i.amount_paid_cents + COALESCE(credited.amount_cents, 0)" : "";
    const [rows] = await pool.execute(
      `SELECT i.invoice_number, c.name AS customer_name, c.email AS customer_email, i.status,
              i.issue_date, i.due_date, i.currency, i.subtotal_cents, i.discount_cents,
              i.tax_rate_bps, i.tax_cents, i.total_cents, i.amount_paid_cents,
              COALESCE(credited.amount_cents, 0) AS credited_cents,
              GREATEST(0, i.total_cents - i.amount_paid_cents - COALESCE(credited.amount_cents, 0)) AS balance_cents
       FROM invoices i
       INNER JOIN customers c ON c.tenant_id = i.tenant_id AND c.id = i.customer_id
       LEFT JOIN (
         SELECT tenant_id, invoice_id, SUM(amount_cents) AS amount_cents
         FROM credit_notes WHERE status = 'issued' GROUP BY tenant_id, invoice_id
       ) credited ON credited.tenant_id = i.tenant_id AND credited.invoice_id = i.id
       WHERE i.tenant_id = ?${rangeFilterSql} ${outstandingOnly}
       ORDER BY i.issue_date DESC, i.invoice_number DESC`,
      parameters,
    );
    const headers = [
      "invoice_number", "customer_name", "customer_email", "status", "issue_date", "due_date",
      "currency", "subtotal_cents", "discount_cents", "tax_rate_bps", "tax_cents", "total_cents",
      "amount_paid_cents", "credited_cents", "balance_cents",
    ];
    csvResponse(response, `${report}-${new Date().toISOString().slice(0, 10)}.csv`, headers,
      rows.map((row) => headers.map((header) => row[header])));
    return;
  }

  if (report === "payments") {
    const [rows] = await pool.execute(
      `SELECT p.id AS payment_id, DATE_FORMAT(p.received_at, '%Y-%m-%d %H:%i:%s') AS received_at,
              p.status, c.name AS customer_name, c.email AS customer_email,
              i.invoice_number, a.amount_cents AS allocated_cents, p.amount_cents, p.currency,
              p.method, p.reference
       FROM payments p
       INNER JOIN customers c ON c.tenant_id = p.tenant_id AND c.id = p.customer_id
       LEFT JOIN payment_allocations a ON a.tenant_id = p.tenant_id AND a.payment_id = p.id
       LEFT JOIN invoices i ON i.tenant_id = a.tenant_id AND i.id = a.invoice_id
       WHERE p.tenant_id = ?${rangeFilterSql}
       ORDER BY p.received_at DESC, p.id`,
      parameters,
    );
    const headers = [
      "payment_id", "received_at", "status", "customer_name", "customer_email", "invoice_number",
      "allocated_cents", "amount_cents", "currency", "method", "reference",
    ];
    csvResponse(response, `payments-${new Date().toISOString().slice(0, 10)}.csv`, headers,
      rows.map((row) => headers.map((header) => row[header])));
    return;
  }

  const [rows] = await pool.execute(
    `SELECT DATE_FORMAT(i.issue_date, '%Y-%m') AS period, i.currency,
            SUM(i.tax_cents) AS tax_cents, COUNT(*) AS invoice_count
     FROM invoices i
     WHERE i.tenant_id = ? AND i.status = 'issued'${rangeFilterSql}
     GROUP BY DATE_FORMAT(i.issue_date, '%Y-%m'), i.currency
     ORDER BY period DESC, i.currency`,
    parameters,
  );
  const headers = ["period", "currency", "tax_cents", "invoice_count"];
  csvResponse(response, `tax-summary-${new Date().toISOString().slice(0, 10)}.csv`, headers,
    rows.map((row) => headers.map((header) => row[header])));
});

export const businessRouter = router;
