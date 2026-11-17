import { pool } from "./db.js";
import { HttpError } from "./errors.js";

const rolePermissions = {
  owner: new Set(["*"]),
  admin: new Set(["business:read", "business:update", "users:manage", "customers:write", "products:write", "invoices:write", "payments:write", "suppliers:write", "expenses:write", "reports:read", "audit:read"]),
  finance_manager: new Set(["business:read", "customers:write", "products:write", "invoices:write", "payments:write", "suppliers:write", "expenses:write", "reports:read", "audit:read"]),
  accountant: new Set(["business:read", "customers:write", "products:write", "invoices:write", "payments:write", "suppliers:write", "expenses:write", "reports:read", "audit:read"]),
  sales_officer: new Set(["business:read", "customers:write", "products:write", "invoices:write", "reports:read"]),
  cashier: new Set(["business:read", "payments:write", "payments:read", "invoices:read"]),
  auditor: new Set(["business:read", "customers:read", "products:read", "invoices:read", "payments:read", "suppliers:read", "expenses:read", "reports:read", "audit:read"]),
};

export function requireAuth(request, _response, next) {
  if (!request.auth) {
    next(new HttpError(401, "AUTH_REQUIRED", "Sign in to access this resource."));
    return;
  }
  next();
}

export async function requireTenant(request, _response, next) {
  try {
    if (!request.auth?.tenantId) throw new HttpError(403, "TENANT_REQUIRED", "Choose a business to continue.");
    const [rows] = await pool.execute(
      `SELECT m.role, t.id, t.name, t.email, t.phone, t.address, t.kra_pin,
              t.currency, t.tax_rate_bps, t.invoice_prefix
       FROM memberships m
       INNER JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = ? AND m.tenant_id = ? AND m.active = TRUE
       LIMIT 1`,
      [request.auth.userId, request.auth.tenantId],
    );
    if (rows.length === 0) throw new HttpError(403, "TENANT_ACCESS_DENIED", "You do not belong to the selected business.");
    request.tenant = { ...rows[0], role: rows[0].role };
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePermission(permission) {
  return function authorize(request, _response, next) {
    const permissions = rolePermissions[request.tenant?.role];
    const readGrantedByWrite = permission.endsWith(":read")
      && permissions?.has(`${permission.slice(0, -5)}:write`);
    if (!permissions || (!permissions.has("*") && !permissions.has(permission) && !readGrantedByWrite)) {
      next(new HttpError(403, "PERMISSION_DENIED", "Your business role does not allow this action."));
      return;
    }
    next();
  };
}
