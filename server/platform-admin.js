import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { pool, inTransaction } from "./db.js";
import { HttpError } from "./errors.js";

const router = Router();
const subscriptionStatuses = ["trialing", "active", "past_due", "suspended", "cancelled"];
const planInputSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[a-z0-9_-]+$/).optional(),
  name: z.string().trim().min(2).max(100).optional(),
  monthlyPriceCents: z.number().int().min(0).nullable().optional(),
  invoiceLimit: z.number().int().min(1).nullable().optional(),
  userLimit: z.number().int().min(1).nullable().optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  active: z.boolean().optional(),
});

function isPlatformAdmin(request) {
  return Boolean(request.auth?.email && config.platformAdminEmails.includes(request.auth.email.toLowerCase()));
}

function requirePlatformAdmin(request, _response, next) {
  if (!isPlatformAdmin(request)) {
    next(new HttpError(403, "PLATFORM_ADMIN_REQUIRED", "Platform administrator access is required."));
    return;
  }
  next();
}

function routeId(value) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(400, "INVALID_ID", "The requested record ID is invalid.");
  return parsed.data;
}

async function writePlatformAudit(connection, request, action, entityType, entityId, details) {
  await connection.execute(
    `INSERT INTO platform_admin_audit (id, admin_user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), request.auth.userId, action, entityType, entityId, JSON.stringify(details ?? {})],
  );
}

router.get("/me", (request, response) => {
  response.json({ data: { isPlatformAdmin: isPlatformAdmin(request) } });
});

router.get("/overview", requirePlatformAdmin, async (_request, response) => {
  const [tenantRows] = await pool.execute("SELECT COUNT(*) AS count FROM tenants");
  const [subscriptionRows] = await pool.execute(
    `SELECT status, COUNT(*) AS count FROM subscriptions GROUP BY status`,
  );
  const [invoiceRows] = await pool.execute(
    `SELECT COUNT(*) AS count FROM invoices WHERE status = 'issued' AND issued_at >= UTC_DATE() - INTERVAL 30 DAY`,
  );
  response.json({
    data: {
      tenantCount: Number(tenantRows[0].count),
      issuedInvoicesLast30Days: Number(invoiceRows[0].count),
      subscriptionsByStatus: Object.fromEntries(subscriptionRows.map((row) => [row.status, Number(row.count)])),
    },
  });
});

router.get("/plans", requirePlatformAdmin, async (_request, response) => {
  const [rows] = await pool.execute(
    `SELECT id, code, name, monthly_price_cents AS monthlyPriceCents,
            invoice_limit AS invoiceLimit, user_limit AS userLimit, features, active
     FROM subscription_plans ORDER BY monthly_price_cents IS NULL, monthly_price_cents, name`,
  );
  response.json({
    data: rows.map((row) => ({
      ...row,
      monthlyPriceCents: row.monthlyPriceCents === null ? null : Number(row.monthlyPriceCents),
      invoiceLimit: row.invoiceLimit === null ? null : Number(row.invoiceLimit),
      userLimit: row.userLimit === null ? null : Number(row.userLimit),
      features: typeof row.features === "string" ? JSON.parse(row.features) : row.features,
      active: Boolean(row.active),
    })),
  });
});

router.post("/plans", requirePlatformAdmin, async (request, response) => {
  const input = planInputSchema.extend({
    code: planInputSchema.shape.code.unwrap(),
    name: planInputSchema.shape.name.unwrap(),
  }).parse(request.body);
  if (!input.code || !input.name) throw new HttpError(400, "VALIDATION_ERROR", "A plan code and name are required.");
  const id = randomUUID();
  await inTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO subscription_plans
       (id, code, name, monthly_price_cents, invoice_limit, user_limit, features, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.code, input.name, input.monthlyPriceCents ?? null, input.invoiceLimit ?? null,
        input.userLimit ?? null, JSON.stringify(input.features ?? {}), input.active ?? true],
    );
    await writePlatformAudit(connection, request, "subscription_plan.created", "subscription_plan", id, { code: input.code });
  });
  response.status(201).json({ data: { id, ...input, active: input.active ?? true } });
});

router.patch("/plans/:id", requirePlatformAdmin, async (request, response) => {
  const id = routeId(request.params.id);
  const input = planInputSchema.omit({ code: true }).parse(request.body);
  const entries = Object.entries(input);
  if (entries.length === 0) throw new HttpError(400, "EMPTY_UPDATE", "Provide at least one plan field to update.");
  const columns = {
    name: "name",
    monthlyPriceCents: "monthly_price_cents",
    invoiceLimit: "invoice_limit",
    userLimit: "user_limit",
    features: "features",
    active: "active",
  };
  await inTransaction(async (connection) => {
    const [existing] = await connection.execute("SELECT id FROM subscription_plans WHERE id = ? FOR UPDATE", [id]);
    if (!existing.length) throw new HttpError(404, "PLAN_NOT_FOUND", "Subscription plan not found.");
    await connection.execute(
      `UPDATE subscription_plans SET ${entries.map(([key]) => `${columns[key]} = ?`).join(", ")} WHERE id = ?`,
      [...entries.map(([key, value]) => key === "features" ? JSON.stringify(value) : value), id],
    );
    await writePlatformAudit(connection, request, "subscription_plan.updated", "subscription_plan", id, { fields: entries.map(([key]) => key) });
  });
  response.json({ data: { id, ...input } });
});

router.get("/subscriptions", requirePlatformAdmin, async (request, response) => {
  const query = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    search: z.string().trim().max(120).optional().default(""),
  }).parse(request.query);
  const like = `%${query.search}%`;
  const [rows] = await pool.execute(
    `SELECT s.id, s.tenant_id AS tenantId, t.name AS tenantName, t.email AS tenantEmail,
            s.status, s.trial_ends_at AS trialEndsAt, s.current_period_start AS periodStart,
            s.current_period_end AS periodEnd, p.id AS planId, p.code AS planCode,
            p.name AS planName, p.invoice_limit AS invoiceLimit, p.user_limit AS userLimit,
            (SELECT COUNT(*) FROM memberships m WHERE m.tenant_id = s.tenant_id AND m.active = TRUE) AS activeUsers
     FROM subscriptions s
     INNER JOIN tenants t ON t.id = s.tenant_id
     INNER JOIN subscription_plans p ON p.id = s.plan_id
     WHERE (? = '' OR t.name LIKE ? OR t.email LIKE ?)
     ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [query.search, like, like, query.limit, query.offset],
  );
  response.json({
    data: rows.map((row) => ({
      ...row,
      invoiceLimit: row.invoiceLimit === null ? null : Number(row.invoiceLimit),
      userLimit: row.userLimit === null ? null : Number(row.userLimit),
      activeUsers: Number(row.activeUsers),
    })),
    meta: { limit: query.limit, offset: query.offset },
  });
});

router.patch("/subscriptions/:id", requirePlatformAdmin, async (request, response) => {
  const id = routeId(request.params.id);
  const input = z.object({
    planId: z.string().uuid().optional(),
    status: z.enum(subscriptionStatuses).optional(),
    trialEndsAt: z.string().datetime().nullable().optional(),
    periodStart: z.string().datetime().nullable().optional(),
    periodEnd: z.string().datetime().nullable().optional(),
  }).refine((value) => Object.keys(value).length > 0, "Provide at least one subscription field to update.").parse(request.body);
  if (input.periodStart && input.periodEnd && input.periodStart >= input.periodEnd) {
    throw new HttpError(400, "INVALID_BILLING_PERIOD", "The billing period end must be after its start.");
  }
  await inTransaction(async (connection) => {
    const [rows] = await connection.execute("SELECT id FROM subscriptions WHERE id = ? FOR UPDATE", [id]);
    if (!rows.length) throw new HttpError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
    if (input.planId) {
      const [plans] = await connection.execute("SELECT id FROM subscription_plans WHERE id = ? AND active = TRUE", [input.planId]);
      if (!plans.length) throw new HttpError(400, "PLAN_UNAVAILABLE", "Choose an active subscription plan.");
    }
    const columns = {
      planId: "plan_id",
      status: "status",
      trialEndsAt: "trial_ends_at",
      periodStart: "current_period_start",
      periodEnd: "current_period_end",
    };
    const entries = Object.entries(input);
    await connection.execute(
      `UPDATE subscriptions SET ${entries.map(([key]) => `${columns[key]} = ?`).join(", ")} WHERE id = ?`,
      [...entries.map(([, value]) => value), id],
    );
    await writePlatformAudit(connection, request, "subscription.updated", "subscription", id, input);
  });
  response.json({ data: { id, ...input } });
});

router.get("/audit", requirePlatformAdmin, async (request, response) => {
  const { limit, offset } = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).parse(request.query);
  const [rows] = await pool.execute(
    `SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
            a.details, a.created_at AS createdAt, u.email AS adminEmail
     FROM platform_admin_audit a INNER JOIN users u ON u.id = a.admin_user_id
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  response.json({
    data: rows.map((row) => ({ ...row, details: typeof row.details === "string" ? JSON.parse(row.details) : row.details })),
    meta: { limit, offset },
  });
});

export const platformAdminRouter = router;
