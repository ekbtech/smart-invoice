import test from "node:test";
import assert from "node:assert/strict";
import { calculateExpenseTax, calculateInvoice, createInvoiceSchema, expenseSchema, registerSchema, supplierSchema } from "./domain.js";

test("register accepts a four-character password and normalizes email", () => {
  const input = {
    businessName: "Lumina Studio",
    fullName: "Evans Kimani",
    email: "  EVANS@example.com ",
    password: "1234",
  };
  assert.equal(registerSchema.parse(input).email, "evans@example.com");
  assert.equal(registerSchema.safeParse({ ...input, password: "123" }).success, false);
});

test("invoice calculation uses integer cents and configured VAT", () => {
  const result = calculateInvoice([
    { description: "Design", quantity: 1, unitPriceCents: 8500000 },
    { description: "Consultation", quantity: 1.5, unitPriceCents: 20000 },
  ], 0, 1600);
  assert.equal(result.subtotalCents, 8530000);
  assert.equal(result.taxCents, 1364800);
  assert.equal(result.totalCents, 9894800);
  assert.equal(result.items.reduce((sum, item) => sum + item.lineTotalCents, 0), result.totalCents);
});

test("invoice discount is allocated to lines and total, tax, and items reconcile", () => {
  const result = calculateInvoice([
    { description: "First", quantity: 1, unitPriceCents: 10001, discountCents: 100, taxRateBps: 1600 },
    { description: "Second", quantity: 2, unitPriceCents: 5000, taxRateBps: 800 },
  ], 1001, 1600);
  assert.equal(result.discountCents, 1101);
  assert.equal(result.items.reduce((sum, item) => sum + item.lineDiscountCents, 0), result.discountCents);
  assert.equal(result.items.reduce((sum, item) => sum + item.lineTaxCents, 0), result.taxCents);
  assert.equal(result.items.reduce((sum, item) => sum + item.lineTotalCents, 0), result.totalCents);
});

test("discounts cannot exceed taxable line amounts", () => {
  assert.throws(() => calculateInvoice([
    { description: "Item", quantity: 1, unitPriceCents: 100 },
  ], 101, 1600), /discount cannot exceed/);
});

test("invoice input rejects excessive quantity precision and empty line items", () => {
  const invoice = {
    customerId: "8a50a9bd-b2c8-4ed8-891f-4644ec94e703",
    dueDate: "2026-12-01",
    items: [{ description: "Item", quantity: 1.0001, unitPriceCents: 100 }],
  };
  assert.equal(createInvoiceSchema.safeParse(invoice).success, false);
  assert.equal(createInvoiceSchema.safeParse({ ...invoice, items: [] }).success, false);
});

test("supplier and expense inputs are validated and normalized", () => {
  assert.equal(supplierSchema.parse({ name: "  Office Co " }).name, "Office Co");
  assert.equal(supplierSchema.safeParse({ name: "", email: "not-an-email" }).success, false);
  const expense = expenseSchema.parse({
    expenseDate: "2026-03-10", category: "Supplies", description: "Printer paper",
    subtotalCents: 10000, taxRateBps: 1600, currency: "KES",
  });
  assert.equal(expense.supplierId, null);
  assert.equal(expenseSchema.safeParse({ ...expense, taxRateBps: 10001 }).success, false);
  assert.equal(expenseSchema.safeParse({ ...expense, currency: "KES-1" }).success, false);
});

test("input VAT uses integer-cent rounding", () => {
  assert.equal(calculateExpenseTax(10001, 1600), 1600);
  assert.equal(calculateExpenseTax(1, 5000), 1);
  assert.equal(calculateExpenseTax(10000, 0), 0);
});
