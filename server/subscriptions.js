import { pool } from "./db.js";
import { HttpError } from "./errors.js";
import { config } from "./config.js";

export function isPlatformAdminRequest(request) {
  return Boolean(request.auth?.email && config.platformAdminEmails.includes(request.auth.email.toLowerCase()));
}

export function subscriptionAllowsWrites(subscription, now = new Date()) {
  if (subscription.status === "active") return true;
  if (subscription.status !== "trialing" || !subscription.trialEndsAt) return false;
  const trialEndsAt = new Date(subscription.trialEndsAt);
  return !Number.isNaN(trialEndsAt.getTime()) && trialEndsAt.getTime() > now.getTime();
}

export async function loadTenantSubscription(request, _response, next) {
  try {
    request.isPlatformAdmin = isPlatformAdminRequest(request);
    const [rows] = await pool.execute(
      `SELECT s.id, s.plan_id AS planId, s.status, s.trial_ends_at AS trialEndsAt,
              s.current_period_start AS periodStart, s.current_period_end AS periodEnd,
              p.code AS planCode, p.name AS planName, p.monthly_price_cents AS monthlyPriceCents,
              p.invoice_limit AS invoiceLimit, p.user_limit AS userLimit, p.features
       FROM subscriptions s INNER JOIN subscription_plans p ON p.id = s.plan_id
       WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1`,
      [request.tenant.id],
    );
    const subscription = rows[0] ?? null;
    if (subscription && typeof subscription.features === "string") subscription.features = JSON.parse(subscription.features);
    request.subscription = subscription;
    if (!request.isPlatformAdmin && !subscription && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      throw new HttpError(503, "SUBSCRIPTION_NOT_CONFIGURED", "This business does not have a subscription record. Contact the platform administrator.");
    }
    if (!request.isPlatformAdmin && subscription && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !subscriptionAllowsWrites(subscription)) {
      throw new HttpError(402, "SUBSCRIPTION_READ_ONLY", "This workspace is read-only until its subscription is reactivated. Existing records remain available.");
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePlanFeature(feature) {
  return function requireFeature(request, _response, next) {
    if (request.isPlatformAdmin) {
      next();
      return;
    }
    const features = request.subscription?.features;
    if (features?.[feature] !== true) {
      next(new HttpError(403, "PLAN_FEATURE_UNAVAILABLE", "This feature is not included in the business's current plan."));
      return;
    }
    next();
  };
}

export async function assertInvoiceCapacity(connection, tenantId, now = new Date(), requiredFeature, isPlatformAdmin = false) {
  if (isPlatformAdmin) return;
  const [subscriptions] = await connection.execute(
    `SELECT s.id, s.status, s.trial_ends_at AS trialEndsAt, s.current_period_start AS periodStart,
            s.current_period_end AS periodEnd, p.invoice_limit AS invoiceLimit, p.features
     FROM subscriptions s INNER JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1 FOR UPDATE`,
    [tenantId],
  );
  const subscription = subscriptions[0];
  if (!subscription) throw new HttpError(503, "SUBSCRIPTION_NOT_CONFIGURED", "This business does not have a subscription record.");
  if (!subscriptionAllowsWrites(subscription, now)) {
    throw new HttpError(402, "SUBSCRIPTION_READ_ONLY", "This workspace is read-only until its subscription is reactivated.");
  }
  const features = typeof subscription.features === "string" ? JSON.parse(subscription.features) : subscription.features;
  if (requiredFeature && features?.[requiredFeature] !== true) {
    throw new HttpError(403, "PLAN_FEATURE_UNAVAILABLE", "This feature is not included in the business's current plan.");
  }
  if (subscription.invoiceLimit === null) return;

  const start = subscription.periodStart
    ? new Date(subscription.periodStart)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = subscription.periodEnd
    ? new Date(subscription.periodEnd)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const [usageRows] = await connection.execute(
    `SELECT COUNT(*) AS used
     FROM invoices
     WHERE tenant_id = ? AND status IN ('issued', 'void') AND issued_at >= ? AND issued_at < ?`,
    [tenantId, start, end],
  );
  if (Number(usageRows[0].used) >= Number(subscription.invoiceLimit)) {
    throw new HttpError(409, "INVOICE_LIMIT_REACHED", "The current plan's invoice limit has been reached for this billing period.");
  }
}

export async function assertUserCapacity(connection, tenantId, isPlatformAdmin = false) {
  if (isPlatformAdmin) return;
  const [subscriptions] = await connection.execute(
    `SELECT s.id, p.user_limit AS userLimit
     FROM subscriptions s INNER JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1 FOR UPDATE`,
    [tenantId],
  );
  const subscription = subscriptions[0];
  if (!subscription) throw new HttpError(503, "SUBSCRIPTION_NOT_CONFIGURED", "This business does not have a subscription record.");
  if (subscription.userLimit === null) return;
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS used FROM memberships WHERE tenant_id = ? AND active = TRUE",
    [tenantId],
  );
  if (Number(rows[0].used) >= Number(subscription.userLimit)) {
    throw new HttpError(409, "USER_LIMIT_REACHED", "The current plan's active user limit has been reached.");
  }
}
