import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { detectLetterheadMimeType, detectLogoMimeType } from "./branding.js";

function png(width = 320, height = 120) {
  const image = Buffer.alloc(24);
  image.set([137, 80, 78, 71, 13, 10, 26, 10]);
  image.write("IHDR", 12, "ascii");
  image.writeUInt32BE(width, 16);
  image.writeUInt32BE(height, 20);
  return image;
}

test("business logos accept PNG and JPEG image signatures", () => {
  assert.equal(detectLogoMimeType(png()), "image/png");
  assert.equal(detectLogoMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 120, 1, 64, 3, 1, 0, 0, 0xff, 0xd9])), "image/jpeg");
});

test("business logos reject unsupported, oversized, and extreme-dimension files", () => {
  assert.throws(() => detectLogoMimeType(Buffer.from("<svg></svg>")), /PNG or JPEG/);
  assert.throws(() => detectLogoMimeType(Buffer.alloc(2 * 1024 * 1024 + 1)), /smaller than 2 MB/);
  assert.throws(() => detectLogoMimeType(png(5001, 120)), /dimensions/);
});

test("business letterheads accept PNG and single-page PDF files", async () => {
  const document = await PDFDocument.create();
  document.addPage([595, 842]).drawText("Letterhead");
  const pdf = Buffer.from(await document.save());
  assert.equal(await detectLetterheadMimeType(png()), "image/png");
  assert.equal(await detectLetterheadMimeType(pdf), "application/pdf");
});

test("business letterheads reject invalid and multi-page PDFs", async () => {
  await assert.rejects(detectLetterheadMimeType(Buffer.from("%PDF-not-valid")), /invalid or damaged/);
  const blankDocument = await PDFDocument.create();
  blankDocument.addPage();
  await assert.rejects(detectLetterheadMimeType(Buffer.from(await blankDocument.save())), /printable page content/);
  const document = await PDFDocument.create();
  document.addPage();
  document.addPage();
  await assert.rejects(detectLetterheadMimeType(Buffer.from(await document.save())), /exactly one page/);
});
