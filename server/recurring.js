import { randomUUID } from "node:crypto";
import { writeAudit } from "./audit.js";
import { pool, inTransaction } from "./db.js";
import { calculateInvoice } from "./domain.js";
import { addDays, addRecurringFrequency } from "./recurring-domain.js";
import { assertInvoiceCapacity } from "./subscriptions.js";

function jsonValue(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function generateNextDueInvoice() {
  return inTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT r.id, r.tenant_id, r.customer_id, r.frequency, r.next_run_at, r.end_date,
              r.template, r.created_by, t.name AS business_name, t.email AS business_email,
              t.phone AS business_phone, t.address AS business_address, t.currency AS business_currency,
              t.tax_rate_bps AS business_tax_rate_bps, t.invoice_prefix,
              c.name AS customer_name, c.company AS customer_company, c.email AS customer_email,
              c.phone AS customer_phone, c.billing_address AS customer_address, c.kra_pin AS customer_kra_pin,
              c.archived_at AS customer_archived_at
       FROM recurring_invoices r
       INNER JOIN tenants t ON t.id = r.tenant_id
       INNER JOIN customers c ON c.tenant_id = r.tenant_id AND c.id = r.customer_id
       WHERE r.active = TRUE AND r.next_run_at <= UTC_DATE()
       ORDER BY r.next_run_at, r.created_at
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [],
    );
    const schedule = rows[0];
    if (!schedule) return null;

    const issueDate = String(schedule.next_run_at).slice(0, 10);
    const endDate = schedule.end_date ? String(schedule.end_date).slice(0, 10) : null;
    if (endDate && issueDate > endDate) {
      await connection.execute(
        "UPDATE recurring_invoices SET active = FALSE WHERE tenant_id = ? AND id = ?",
        [schedule.tenant_id, schedule.id],
      );
      await writeAudit(connection, {
        tenantId: schedule.tenant_id, userId: schedule.created_by, action: "recurring_invoice.completed",
        entityType: "recurring_invoice", entityId: schedule.id, details: { endDate },
      });
      return { completed: true };
    }

    if (schedule.customer_archived_at) {
      await connection.execute(
        "UPDATE recurring_invoices SET active = FALSE WHERE tenant_id = ? AND id = ?",
        [schedule.tenant_id, schedule.id],
      );
      await writeAudit(connection, {
        tenantId: schedule.tenant_id, userId: schedule.created_by, action: "recurring_invoice.paused_customer_archived",
        entityType: "recurring_invoice", entityId: schedule.id,
      });
      return { paused: true };
    }

    try {
      await assertInvoiceCapacity(connection, schedule.tenant_id, new Date(), "recurringInvoices");
    } catch (error) {
      if (!["SUBSCRIPTION_READ_ONLY", "INVOICE_LIMIT_REACHED", "PLAN_FEATURE_UNAVAILABLE"].includes(error?.code)) throw error;
      await connection.execute(
        "UPDATE recurring_invoices SET active = FALSE WHERE tenant_id = ? AND id = ?",
        [schedule.tenant_id, schedule.id],
      );
      await writeAudit(connection, {
        tenantId: schedule.tenant_id, userId: schedule.created_by, action: "recurring_invoice.paused_subscription",
        entityType: "recurring_invoice", entityId: schedule.id, details: { reason: error.code },
      });
      await connection.execute(
        `INSERT INTO notifications (id, tenant_id, user_id, type, title, body)
         VALUES (?, ?, ?, 'recurring_invoice.paused_subscription', ?, ?)`,
        [randomUUID(), schedule.tenant_id, schedule.created_by, "Recurring invoice paused", "The schedule was paused because the current plan cannot issue another recurring invoice."],
      );
      return { paused: true };
    }

    const template = jsonValue(schedule.template);
    const dueInDays = Number(template.dueInDays ?? 14);
    const dueDate = addDays(issueDate, dueInDays);
    const anchorDay = Number(template.anchorDay ?? issueDate.slice(8, 10));
    const nextRunAt = addRecurringFrequency(issueDate, schedule.frequency, anchorDay);
    const calculated = calculateInvoice(
      template.items,
      Number(template.discountCents ?? 0),
      Number(template.taxRateBps ?? schedule.business_tax_rate_bps),
    );
    if (calculated.totalCents <= 0) throw new Error(`Recurring invoice ${schedule.id} has a zero total.`);

    await connection.execute(
      "INSERT IGNORE INTO invoice_counters (tenant_id, invoice_year, last_number) VALUES (?, ?, 0)",
      [schedule.tenant_id, Number(issueDate.slice(0, 4))],
    );
    const [counterRows] = await connection.execute(
      "SELECT last_number FROM invoice_counters WHERE tenant_id = ? AND invoice_year = ? FOR UPDATE",
      [schedule.tenant_id, Number(issueDate.slice(0, 4))],
    );
    const sequence = Number(counterRows[0].last_number) + 1;
    if (!Number.isSafeInteger(sequence)) throw new Error(`Invoice sequence exhausted for business ${schedule.tenant_id}.`);
    await connection.execute(
      "UPDATE invoice_counters SET last_number = ? WHERE tenant_id = ? AND invoice_year = ?",
      [sequence, schedule.tenant_id, Number(issueDate.slice(0, 4))],
    );
    const invoiceNumber = `${schedule.invoice_prefix}-${issueDate.slice(0, 4)}-${String(sequence).padStart(5, "0")}`;
    const invoiceId = randomUUID();
    const currency = template.currency ?? schedule.business_currency;
    const taxRateBps = Number(template.taxRateBps ?? schedule.business_tax_rate_bps);
    const items = calculated.items.map((item, index) => ({
      id: randomUUID(),
      productId: template.items[index].productId ?? null,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.lineDiscountCents,
      taxRateBps: item.taxRateBps,
      lineTotalCents: item.lineTotalCents,
    }));
    const snapshot = {
      business: {
        name: schedule.business_name,
        email: schedule.business_email,
        phone: schedule.business_phone,
        address: schedule.business_address,
      },
      customer: {
        name: schedule.customer_name,
        company: schedule.customer_company,
        email: schedule.customer_email,
        phone: schedule.customer_phone,
        billingAddress: schedule.customer_address,
        kraPin: schedule.customer_kra_pin,
      },
      invoice: { invoiceNumber, issueDate, dueDate, currency, ...calculated, items },
    };

    await connection.execute(
      `INSERT INTO invoices
       (id, tenant_id, customer_id, invoice_number, status, currency, issue_date, due_date,
        subtotal_cents, discount_cents, tax_rate_bps, tax_cents, total_cents, notes, terms,
        issued_snapshot, issued_at, created_by)
       VALUES (?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)`,
      [invoiceId, schedule.tenant_id, schedule.customer_id, invoiceNumber, currency, issueDate, dueDate,
        calculated.subtotalCents, calculated.discountCents, taxRateBps, calculated.taxCents, calculated.totalCents,
        template.notes || null, template.terms || null, JSON.stringify(snapshot), schedule.created_by],
    );
    for (let index = 0; index < calculated.items.length; index += 1) {
      const item = calculated.items[index];
      const source = template.items[index];
      await connection.execute(
        `INSERT INTO invoice_items
         (id, tenant_id, invoice_id, product_id, description, quantity, unit_price_cents, discount_cents, tax_rate_bps, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [items[index].id, schedule.tenant_id, invoiceId, source.productId ?? null, item.description, item.quantity,
          item.unitPriceCents, item.lineDiscountCents, item.taxRateBps, item.lineTotalCents],
      );
    }
    const active = !endDate || nextRunAt <= endDate;
    await connection.execute(
      "UPDATE recurring_invoices SET next_run_at = ?, active = ? WHERE tenant_id = ? AND id = ?",
      [nextRunAt, active, schedule.tenant_id, schedule.id],
    );
    await writeAudit(connection, {
      tenantId: schedule.tenant_id, userId: schedule.created_by, action: "recurring_invoice.generated",
      entityType: "invoice", entityId: invoiceId,
      details: { recurringInvoiceId: schedule.id, invoiceNumber, issueDate, totalCents: calculated.totalCents, currency },
    });
    await connection.execute(
      `INSERT INTO notifications (id, tenant_id, user_id, type, title, body)
       VALUES (?, ?, ?, 'recurring_invoice.generated', ?, ?)`,
      [randomUUID(), schedule.tenant_id, schedule.created_by, "Recurring invoice generated", `${invoiceNumber} for ${schedule.customer_name} was issued.`],
    );
    if (!active) {
      await writeAudit(connection, {
        tenantId: schedule.tenant_id, userId: schedule.created_by, action: "recurring_invoice.completed",
        entityType: "recurring_invoice", entityId: schedule.id, details: { endDate },
      });
    }
    return { invoiceId, invoiceNumber, tenantId: schedule.tenant_id };
  });
}

export async function processDueRecurringInvoices(batchSize = 25) {
  let generated = 0;
  let paused = 0;
  let completed = 0;
  for (let index = 0; index < batchSize; index += 1) {
    const result = await generateNextDueInvoice();
    if (!result) break;
    if (result.invoiceId) {
      generated += 1;
      console.info(`Generated recurring invoice ${result.invoiceNumber} for business ${result.tenantId}.`);
    }
    if (result.paused) paused += 1;
    if (result.completed) completed += 1;
  }
  return { generated, paused, completed };
}

export function startRecurringScheduler() {
  let running = false;
  let stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await processDueRecurringInvoices();
    } catch (error) {
      console.error("Recurring invoice processing failed; due schedules will be retried on the next run.", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), 60_000);
  timer.unref();
  void run();
  return async () => {
    stopped = true;
    clearInterval(timer);
    while (running) await new Promise((resolve) => setTimeout(resolve, 10));
  };
}
