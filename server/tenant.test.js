import assert from "node:assert/strict";
import test from "node:test";
import { requirePermission } from "./tenant.js";

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
