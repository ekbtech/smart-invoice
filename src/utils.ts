import type { Invoice, InvoiceStatus } from "./types";

export function formatMoney(cents: number, currency = "KES") {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatDate(date: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00`));
}

export function getInvoiceStatus(invoice: Invoice): InvoiceStatus {
  if (invoice.isVoid) return "Void";
  if (invoice.isDraft) return "Draft";
  if (invoice.amountPaidCents + (invoice.creditedCents ?? 0) >= invoice.totalCents) return "Paid";
  if (invoice.dueDate < new Date().toISOString().slice(0, 10)) return "Overdue";
  return "Pending";
}

export function readStorage<T>(key: string, fallback: T): T {
  const stored = localStorage.getItem(key);
  return stored === null ? fallback : (JSON.parse(stored) as T);
}

export function makeId(prefix: string) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

export function getInvoiceNumber(invoices: Invoice[]) {
  const year = new Date().getFullYear();
  const sequence = invoices.reduce((max, invoice) => {
    const match = invoice.number.match(new RegExp(`^INV-${year}-(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `INV-${year}-${String(sequence).padStart(3, "0")}`;
}
