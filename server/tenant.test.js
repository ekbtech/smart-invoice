import assert from "node:assert/strict";
import test from "node:test";
import { requireBusinessAdmin, requirePermission } from "./tenant.js";

function authorize(role, permission) {
  let error;
  requirePermission(permission)({ tenant: { role } }, {}, (value) => {
    error = value;
  });
  return error;
}

test("roles with write access can also read the same resource", () => {
  assert.equal(authorize("accountant", "invoices:read"), undefined);
  assert.equal(authorize("sales_officer", "invoices:read"), undefined);
  assert.equal(authorize("cashier", "payments:read"), undefined);
});

test("read-only roles do not gain write access", () => {
  assert.equal(authorize("auditor", "invoices:write")?.code, "PERMISSION_DENIED");
  assert.equal(authorize("cashier", "invoices:write")?.code, "PERMISSION_DENIED");
});

test("finance roles manage suppliers and expenses while auditors have read-only access", () => {
  assert.equal(authorize("accountant", "expenses:write"), undefined);
  assert.equal(authorize("finance_manager", "suppliers:read"), undefined);
  assert.equal(authorize("auditor", "expenses:read"), undefined);
  assert.equal(authorize("auditor", "suppliers:write")?.code, "PERMISSION_DENIED");
  assert.equal(authorize("sales_officer", "expenses:read")?.code, "PERMISSION_DENIED");
});

test("only the business admin role can create user accounts", () => {
  for (const role of ["owner", "finance_manager", "accountant", "sales_officer", "cashier", "auditor"]) {
    let error;
    requireBusinessAdmin({ tenant: { role }, auth: { email: "admin@example.com" } }, {}, (value) => { error = value; });
    assert.equal(error?.code, "BUSINESS_ADMIN_REQUIRED", `${role} must not create accounts`);
  }
  let error;
  requireBusinessAdmin({ tenant: { role: "admin" } }, {}, (value) => { error = value; });
  assert.equal(error, undefined);
});

test("the business admin role has all workspace permissions", () => {
  for (const permission of ["business:delete", "users:manage", "invoices:write", "expenses:write", "audit:read"]) {
    assert.equal(authorize("admin", permission), undefined, `admin should have ${permission}`);
  }
});
