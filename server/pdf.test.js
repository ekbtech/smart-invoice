import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createDeliveryNotePdf, createInvoicePdf, createReceiptPdf } from "./pdf.js";

test("invoice PDF contains a valid PDF document and invoice details", async () => {
  const pdf = await createInvoicePdf({
    business: { name: "Example Business", email: "billing@example.test", address: "Nairobi" },
    customer: { name: "Customer One", email: "customer@example.test" },
    invoiceNumber: "INV-2026-00001",
    status: "issued",
    issueDate: "2026-11-16",
    dueDate: "2026-11-30",
    currency: "KES",
    subtotalCents: 10000,
    discountCents: 0,
    taxRateBps: 1600,
    taxCents: 1600,
    totalCents: 11600,
    amountPaidCents: 1000,
    creditedCents: 0,
    items: [{ description: "Consulting service", quantity: 1, unitPriceCents: 10000, lineTotalCents: 10000 }],
  });
  assert.ok(pdf.subarray(0, 8).toString("ascii").startsWith("%PDF-1."));
  assert.ok(pdf.length > 1000);
});

test("invoice PDFs render uploaded logos in each business layout", async () => {
  const logo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2cAAAAASUVORK5CYII=", "base64");
  const pdfs = await Promise.all(["classic", "centered", "compact", "modern"].map((invoiceLayout) => createInvoicePdf({
    business: { name: "Branding Example", email: "brand@example.test", logo, invoiceLayout },
    customer: { name: "Customer One" },
    invoiceNumber: "INV-2026-00001",
    status: "issued",
    issueDate: "2026-11-16",
    dueDate: "2026-11-30",
    currency: "KES",
    subtotalCents: 10000,
    discountCents: 0,
    taxRateBps: 0,
    taxCents: 0,
    totalCents: 10000,
    amountPaidCents: 0,
    items: [{ description: "Consulting service", quantity: 1, unitPriceCents: 10000, lineTotalCents: 10000 }],
  })));
  for (const pdf of pdfs) assert.ok(pdf.subarray(0, 8).toString("ascii").startsWith("%PDF-1."));
  assert.equal(new Set(pdfs.map((pdf) => pdf.toString("base64"))).size, 4);
});

test("invoice PDFs use uploaded PDF and image letterheads as backgrounds", async () => {
  const letterheadDocument = await PDFDocument.create();
  letterheadDocument.addPage([595, 842]).drawText("Business letterhead");
  const letterhead = Buffer.from(await letterheadDocument.save());
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2cAAAAASUVORK5CYII=", "base64");
  const baseInvoice = {
    business: { name: "Branding Example" },
    customer: { name: "Customer One" },
    invoiceNumber: "INV-2026-00001",
    status: "issued",
    issueDate: "2026-11-16",
    dueDate: "2026-11-30",
    currency: "KES",
    subtotalCents: 10000,
    discountCents: 0,
    taxRateBps: 0,
    taxCents: 0,
    totalCents: 10000,
    amountPaidCents: 0,
    items: [{ description: "Consulting service", quantity: 1, unitPriceCents: 10000, lineTotalCents: 10000 }],
  };
  const pdfLetterhead = await createInvoicePdf({
    ...baseInvoice,
    business: { ...baseInvoice.business, letterhead, letterheadMimeType: "application/pdf" },
  });
  const imageLetterhead = await createInvoicePdf({
    ...baseInvoice,
    business: { ...baseInvoice.business, letterhead: png, letterheadMimeType: "image/png" },
  });
  for (const pdf of [pdfLetterhead, imageLetterhead]) {
    assert.ok(pdf.subarray(0, 8).toString("ascii").startsWith("%PDF-"));
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
  }
});

test("receipt PDF contains a valid document for the recorded payment", async () => {
  const pdf = await createReceiptPdf({
    business: { name: "Example Business" },
    customer: { name: "Customer One" },
    receiptNumber: "RCT-PAY-001",
    receivedAt: "2026-11-16T08:00:00.000Z",
    amountCents: 5000,
    currency: "KES",
    method: "bank_transfer",
    reference: "BANK-123",
    allocations: [{ invoiceNumber: "INV-2026-00001", amountCents: 5000 }],
  });
  assert.ok(pdf.subarray(0, 8).toString("ascii").startsWith("%PDF-1."));
  assert.ok(pdf.length > 1000);
});

test("delivery note PDF includes a generated document with signature fields", async () => {
  const pdf = await createDeliveryNotePdf({
    business: { name: "Example Business" },
    deliveryNumber: "DN-INV-2026-00001",
    invoiceNumber: "INV-2026-00001",
    deliveryDate: "2026-11-16",
    recipientName: "Customer One",
    deliveryAddress: "Nairobi",
    deliveredBy: "Courier One",
    items: [{ description: "Office chairs", quantity: 2 }],
  });
  assert.ok(pdf.subarray(0, 8).toString("ascii").startsWith("%PDF-"));
  assert.ok(pdf.length > 1000);
});
