import PDFDocument from "pdfkit";
import { PDFDocument as EditablePdfDocument } from "pdf-lib";

function text(value) {
  return String(value ?? "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function money(amountCents, currency) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: String(currency).toUpperCase(),
    currencyDisplay: "code",
  }).format(Number(amountCents) / 100);
}

function date(value) {
  if (!value) return "-";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? text(value) : new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

function newDocument() {
  const document = new PDFDocument({ size: "A4", margin: 48, info: { Creator: "Smart Invoice Pro" } });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));
  const result = new Promise((resolve, reject) => {
    document.once("end", () => resolve(Buffer.concat(chunks)));
    document.once("error", reject);
  });
  return { document, result };
}

async function applyLetterhead(pdf, business) {
  if (!Buffer.isBuffer(business?.letterhead)) return pdf;
  const source = await EditablePdfDocument.load(pdf);
  const output = await EditablePdfDocument.create();
  let backgroundPdf;
  let backgroundImage;
  if (business.letterheadMimeType === "application/pdf") {
    [backgroundPdf] = await output.embedPdf(business.letterhead, [0]);
  } else if (business.letterheadMimeType === "image/png") {
    backgroundImage = await output.embedPng(business.letterhead);
  } else if (business.letterheadMimeType === "image/jpeg") {
    backgroundImage = await output.embedJpg(business.letterhead);
  } else {
    throw new TypeError("The stored letterhead has an unsupported format.");
  }
  for (const sourcePage of source.getPages()) {
    const page = output.addPage([595.28, 841.89]);
    const width = page.getWidth();
    const height = page.getHeight();
    if (backgroundPdf) page.drawPage(backgroundPdf, { x: 0, y: 0, width, height });
    else page.drawImage(backgroundImage, { x: 0, y: 0, width, height });
    page.drawPage(await output.embedPage(sourcePage), { x: 0, y: 0, width, height });
  }
  return Buffer.from(await output.save());
}

function addHeader(document, business, title, number, accent, layout = "classic") {
  const safeAccent = /^#[0-9a-f]{6}$/i.test(accent ?? "") ? accent : "#315eea";
  const validLayouts = new Set(["classic", "centered", "compact", "modern"]);
  const selectedLayout = validLayouts.has(layout) ? layout : "classic";
  const contact = [business?.address, business?.email, business?.phone].filter(Boolean).map(text).join(" | ");
  const logo = Buffer.isBuffer(business?.logo) ? business.logo : null;
  const drawLogo = (x, y, width, height) => {
    if (logo) document.image(logo, x, y, { fit: [width, height] });
  };

  if (selectedLayout === "centered") {
    drawLogo(273, 38, 48, 48);
    document.fillColor(safeAccent).font("Helvetica-Bold").fontSize(21)
      .text(text(business?.name || "Business"), 48, logo ? 94 : 52, { width: 500, align: "center" });
    document.fillColor("#64748b").font("Helvetica").fontSize(9).text(contact, { width: 500, align: "center" });
    document.moveDown(0.7);
    document.fillColor(safeAccent).font("Helvetica-Bold").fontSize(15).text(`${text(title)}  ${text(number)}`, { width: 500, align: "center" });
    document.y += 14;
    return;
  }

  if (selectedLayout === "compact") {
    drawLogo(498, 41, 48, 48);
    document.fillColor(safeAccent).font("Helvetica-Bold").fontSize(17)
      .text(text(title), 48, 47, { width: 165 });
    document.fillColor("#172033").font("Helvetica-Bold").fontSize(10)
      .text(text(number), 48, 69, { width: 165 });
    document.fillColor(safeAccent).font("Helvetica-Bold").fontSize(13)
      .text(text(business?.name || "Business"), 218, 45, { width: 265, align: "right" });
    document.fillColor("#64748b").font("Helvetica").fontSize(8)
      .text(contact, 218, 65, { width: 265, align: "right" });
    document.y = 112;
    return;
  }

  if (selectedLayout === "modern") {
    document.save().fillColor(safeAccent).rect(48, 38, 500, 112).fill().restore();
    drawLogo(64, 59, 58, 58);
    const textX = logo ? 135 : 65;
    const textWidth = logo ? 395 : 465;
    document.fillColor("#ffffff").font("Helvetica-Bold").fontSize(21)
      .text(text(business?.name || "Business"), textX, 55, { width: textWidth });
    document.fillColor("#eef2ff").font("Helvetica").fontSize(9)
      .text(contact, textX, document.y + 7, { width: textWidth });
    document.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13)
      .text(`${text(title)}  ${text(number)}`, 65, 119, { width: 465 });
    document.y = 170;
    return;
  }

  drawLogo(48, 43, 55, 55);
  const textX = logo ? 118 : 48;
  const textWidth = logo ? 420 : 500;
  document.fillColor(safeAccent).font("Helvetica-Bold").fontSize(23)
    .text(text(business?.name || "Business"), textX, 45, { width: textWidth });
  document.fillColor("#64748b").font("Helvetica").fontSize(9)
    .text(contact, textX, document.y + 4, { width: textWidth });
  document.y = Math.max(document.y, 108);
  document.moveDown(0.4);
  document.fillColor(safeAccent).font("Helvetica-Bold").fontSize(16).text(text(title), { continued: true });
  document.fillColor("#172033").fontSize(12).text(`  ${text(number)}`, { align: "right" });
  document.moveDown(0.8);
}

function addInvoiceItems(document, items, currency) {
  const left = 48;
  const columns = { description: 235, quantity: 55, unit: 105, total: 105 };
  const row = (item, header = false) => {
    const color = header ? "#ffffff" : "#172033";
    const background = header ? "#172033" : null;
    const description = text(header ? "Description" : item.description);
    const quantity = header ? "Qty" : text(item.quantity);
    const unit = header ? "Unit price" : money(item.unitPriceCents, currency);
    const total = header ? "Amount" : money(item.lineTotalCents, currency);
    const height = header ? 25 : Math.max(26, document.heightOfString(description, { width: columns.description - 12 }) + 12);
    if (background) document.save().fillColor(background).rect(left, document.y, 500, height).fill().restore();
    const y = document.y + 7;
    document.fillColor(color).font(header ? "Helvetica-Bold" : "Helvetica").fontSize(9)
      .text(description, left + 6, y, { width: columns.description - 12, height: height - 8 })
      .text(quantity, left + columns.description, y, { width: columns.quantity - 6, align: "right" })
      .text(unit, left + columns.description + columns.quantity, y, { width: columns.unit - 8, align: "right" })
      .text(total, left + columns.description + columns.quantity + columns.unit, y, { width: columns.total - 8, align: "right" });
    document.y += height;
    if (!header) {
      document.strokeColor("#e2e8f0").moveTo(left, document.y).lineTo(left + 500, document.y).stroke();
    }
  };
  row({}, true);
  for (const item of items) {
    const descriptionHeight = document.heightOfString(text(item.description), { width: columns.description - 12 }) + 12;
    if (document.y + Math.max(26, descriptionHeight) > 720) {
      document.addPage();
      row({}, true);
    }
    row(item);
  }
}

function addTotals(document, invoice) {
  if (document.y > 690) document.addPage();
  const labelX = 330;
  const amountX = 425;
  const line = (label, amount, bold = false) => {
    document.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor("#172033")
      .text(text(label), labelX, document.y + 5, { width: 92 })
      .text(text(amount), amountX, document.y + 5, { width: 123, align: "right" });
    document.y += 21;
  };
  line("Subtotal", money(invoice.subtotalCents, invoice.currency));
  if (Number(invoice.discountCents) > 0) line("Discount", `-${money(invoice.discountCents, invoice.currency)}`);
  line(`Tax (${Number(invoice.taxRateBps) / 100}%)`, money(invoice.taxCents, invoice.currency));
  line("Total", money(invoice.totalCents, invoice.currency), true);
  if (invoice.amountPaidCents !== undefined) {
    line("Paid", money(invoice.amountPaidCents, invoice.currency));
    if (Number(invoice.creditedCents) > 0) line("Credit notes", money(invoice.creditedCents, invoice.currency));
    line("Balance due", money(Math.max(0, invoice.totalCents - invoice.amountPaidCents - Number(invoice.creditedCents ?? 0)), invoice.currency), true);
  }
}

export async function createInvoicePdf(invoice) {
  const { document, result } = newDocument();
  const accent = invoice.template?.config?.primaryColor;
  if (Buffer.isBuffer(invoice.business?.letterhead)) document.y = 150;
  else addHeader(document, invoice.business, invoice.status === "draft" ? "DRAFT INVOICE" : invoice.status === "void" ? "VOID INVOICE" : "INVOICE", invoice.invoiceNumber, accent, invoice.business?.invoiceLayout);
  document.fillColor("#172033").font("Helvetica-Bold").fontSize(10).text("Bill to");
  document.font("Helvetica").fontSize(10).text(text(invoice.customer?.name));
  if (invoice.customer?.company) document.text(text(invoice.customer.company));
  for (const value of [invoice.customer?.email, invoice.customer?.phone, invoice.customer?.billingAddress, invoice.customer?.kraPin && `KRA PIN: ${invoice.customer.kraPin}`]) {
    if (value) document.fillColor("#64748b").fontSize(9).text(text(value));
  }
  document.moveDown(0.6).fillColor("#172033").font("Helvetica-Bold").fontSize(9)
    .text(`Issue date: ${date(invoice.issueDate)}    Due date: ${date(invoice.dueDate)}`);
  document.moveDown(1);
  addInvoiceItems(document, invoice.items, invoice.currency);
  document.moveDown(0.6);
  addTotals(document, invoice);
  if (invoice.notes) document.moveDown(0.7).font("Helvetica-Bold").fontSize(9).fillColor("#172033").text("Notes");
  if (invoice.notes) document.font("Helvetica").fontSize(9).text(text(invoice.notes), { width: 500 });
  if (invoice.terms) document.moveDown(0.5).font("Helvetica").fontSize(8).fillColor("#64748b").text(text(invoice.terms), { width: 500 });
  if (invoice.template?.config?.footerNote) {
    document.moveDown(1).font("Helvetica").fontSize(9).fillColor("#64748b")
      .text(text(invoice.template.config.footerNote), { width: 500, align: "center" });
  }
  document.end();
  return applyLetterhead(await result, invoice.business);
}

export async function createReceiptPdf(receipt) {
  const { document, result } = newDocument();
  if (Buffer.isBuffer(receipt.business?.letterhead)) document.y = 150;
  else addHeader(document, receipt.business, "PAYMENT RECEIPT", receipt.receiptNumber, undefined, receipt.business?.invoiceLayout);
  document.fillColor("#64748b").font("Helvetica").fontSize(10).text(`Received: ${date(receipt.receivedAt)}`);
  document.moveDown(1);
  document.fillColor("#172033").font("Helvetica-Bold").fontSize(10).text("Received from");
  document.font("Helvetica").text(text(receipt.customer?.name));
  if (receipt.customer?.company) document.text(text(receipt.customer.company));
  if (receipt.customer?.email) document.fillColor("#64748b").fontSize(9).text(text(receipt.customer.email));
  document.moveDown(1);
  document.font("Helvetica-Bold").fillColor("#172033").fontSize(10).text("Payment details");
  const details = [
    ["Amount received", money(receipt.amountCents, receipt.currency)],
    ["Payment method", text(receipt.method)],
    ["Reference", text(receipt.reference || "-")],
    ["Invoice", text(receipt.allocations.map((allocation) => allocation.invoiceNumber).join(", ") || "-")],
  ];
  for (const [label, value] of details) {
    document.font("Helvetica").fontSize(10).text(label, 48, document.y + 9, { continued: true });
    document.font("Helvetica-Bold").text(value, { align: "right" });
    document.moveDown(0.4);
  }
  const allocated = receipt.allocations.reduce((sum, allocation) => sum + Number(allocation.amountCents), 0);
  if (allocated !== Number(receipt.amountCents)) {
    document.moveDown(0.7).fillColor("#64748b").font("Helvetica").fontSize(9)
      .text(`Allocated to invoices: ${money(allocated, receipt.currency)}`);
  }
  document.moveDown(2).fillColor("#64748b").font("Helvetica").fontSize(9)
    .text("Thank you for your payment.", { align: "center" });
  document.end();
  return applyLetterhead(await result, receipt.business);
}

export async function createDeliveryNotePdf(deliveryNote) {
  const { document, result } = newDocument();
  if (Buffer.isBuffer(deliveryNote.business?.letterhead)) document.y = 150;
  else addHeader(document, deliveryNote.business, "DELIVERY NOTE", deliveryNote.deliveryNumber, undefined, deliveryNote.business?.invoiceLayout);
  document.fillColor("#172033").font("Helvetica-Bold").fontSize(10).text("Deliver to");
  document.font("Helvetica").fontSize(10).text(text(deliveryNote.recipientName));
  if (deliveryNote.deliveryAddress) document.fillColor("#64748b").fontSize(9).text(text(deliveryNote.deliveryAddress));
  document.moveDown(0.8).font("Helvetica-Bold").fontSize(9).fillColor("#172033")
    .text(`Delivery date: ${date(deliveryNote.deliveryDate)}    Invoice: ${text(deliveryNote.invoiceNumber)}`);
  if (deliveryNote.deliveredBy) document.font("Helvetica").fontSize(9).text(`Delivered by: ${text(deliveryNote.deliveredBy)}`);
  document.moveDown(1);
  const left = 48;
  document.save().fillColor("#172033").rect(left, document.y, 500, 25).fill().restore();
  document.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9)
    .text("Description", left + 6, document.y + 7, { width: 390 })
    .text("Qty delivered", left + 396, document.y + 7, { width: 98, align: "right" });
  document.y += 25;
  for (const item of deliveryNote.items) {
    const description = text(item.description);
    const height = Math.max(26, document.heightOfString(description, { width: 378 }) + 12);
    if (document.y + height > 720) document.addPage();
    document.font("Helvetica").fontSize(9).fillColor("#172033")
      .text(description, left + 6, document.y + 7, { width: 378, height: height - 8 })
      .text(text(item.quantity), left + 396, document.y + 7, { width: 98, align: "right" });
    document.y += height;
    document.strokeColor("#e2e8f0").moveTo(left, document.y).lineTo(left + 500, document.y).stroke();
  }
  if (deliveryNote.notes) document.moveDown(1).font("Helvetica-Bold").fontSize(9).text("Notes");
  if (deliveryNote.notes) document.font("Helvetica").fontSize(9).text(text(deliveryNote.notes), { width: 500 });
  if (document.y > 650) document.addPage();
  document.moveDown(2);
  const signatureY = document.y;
  document.strokeColor("#64748b").moveTo(48, signatureY + 28).lineTo(265, signatureY + 28).stroke();
  document.strokeColor("#64748b").moveTo(330, signatureY + 28).lineTo(548, signatureY + 28).stroke();
  document.font("Helvetica").fontSize(8).fillColor("#64748b")
    .text("Received by (name and signature)", 48, signatureY + 34, { width: 217 })
    .text("Date received", 330, signatureY + 34, { width: 218 })
    .moveDown(5)
    .text("Goods received in good condition unless noted above.", { width: 500, align: "center" });
  document.end();
  return applyLetterhead(await result, deliveryNote.business);
}
