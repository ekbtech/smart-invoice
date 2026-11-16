import type { AppSettings, Customer, Invoice, Payment, Product } from "./types";

const invoiceYear = new Date().getFullYear();
const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

const daysFromNow = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

export const initialSettings: AppSettings = {
  businessName: "Lumina Studio",
  email: "hello@luminastudio.co.ke",
  phone: "+254 712 345 678",
  address: "Westlands, Nairobi, Kenya",
  currency: "KES",
  taxRateBps: 1600,
  lightMode: false,
  colorTheme: "blue",
  invoiceLayout: "classic",
  logoUrl: null,
};

export const initialCustomers: Customer[] = [
  { id: "cus-1", name: "Mary Wanjiku", email: "mary@acme.co.ke", phone: "+254 722 123 456", company: "Acme Creative", address: "Nairobi, Kenya", initials: "MW", color: "violet" },
  { id: "cus-2", name: "David Ochieng", email: "david@greenleaf.co.ke", phone: "+254 733 234 567", company: "Greenleaf Organics", address: "Kisumu, Kenya", initials: "DO", color: "green" },
  { id: "cus-3", name: "Amina Hassan", email: "amina@northstar.co.ke", phone: "+254 711 456 789", company: "Northstar Media", address: "Mombasa, Kenya", initials: "AH", color: "pink" },
  { id: "cus-4", name: "Peter Kamau", email: "peter@urbanliving.co.ke", phone: "+254 720 567 890", company: "Urban Living", address: "Nairobi, Kenya", initials: "PK", color: "blue" },
];

export const initialProducts: Product[] = [
  { id: "prd-1", name: "Brand identity design", description: "Logo, brand guide and stationery", category: "Design", priceCents: 8500000 },
  { id: "prd-2", name: "Website development", description: "Responsive business website", category: "Development", priceCents: 14500000 },
  { id: "prd-3", name: "Monthly retainer", description: "Ongoing creative support", category: "Services", priceCents: 5000000 },
  { id: "prd-4", name: "Product photography", description: "Half-day studio session", category: "Photography", priceCents: 3200000 },
];

export const initialInvoices: Invoice[] = [
  {
    id: "inv-1", number: `INV-${invoiceYear}-024`, customerId: "cus-1", customerName: "Mary Wanjiku", customerEmail: "mary@acme.co.ke",
    issueDate: daysAgo(2), dueDate: daysFromNow(12), items: [{ id: "itm-1", description: "Brand identity design", quantity: 1, unitPriceCents: 8500000 }],
    subtotalCents: 8500000, taxRateBps: 1600, taxCents: 1360000, totalCents: 9860000, amountPaidCents: 0, currency: "KES", notes: "", isDraft: false,
  },
  {
    id: "inv-2", number: `INV-${invoiceYear}-023`, customerId: "cus-2", customerName: "David Ochieng", customerEmail: "david@greenleaf.co.ke",
    issueDate: daysAgo(8), dueDate: daysAgo(3), items: [{ id: "itm-2", description: "Website development", quantity: 1, unitPriceCents: 14500000 }],
    subtotalCents: 14500000, taxRateBps: 1600, taxCents: 2320000, totalCents: 16820000, amountPaidCents: 0, currency: "KES", notes: "", isDraft: false,
  },
  {
    id: "inv-3", number: `INV-${invoiceYear}-022`, customerId: "cus-3", customerName: "Amina Hassan", customerEmail: "amina@northstar.co.ke",
    issueDate: daysAgo(18), dueDate: daysAgo(4), items: [{ id: "itm-3", description: "Monthly retainer", quantity: 1, unitPriceCents: 5000000 }],
    subtotalCents: 5000000, taxRateBps: 1600, taxCents: 800000, totalCents: 5800000, amountPaidCents: 5800000, currency: "KES", notes: "", isDraft: false,
  },
  {
    id: "inv-4", number: `INV-${invoiceYear}-021`, customerId: "cus-4", customerName: "Peter Kamau", customerEmail: "peter@urbanliving.co.ke",
    issueDate: daysAgo(29), dueDate: daysAgo(15), items: [{ id: "itm-4", description: "Product photography", quantity: 1, unitPriceCents: 3200000 }],
    subtotalCents: 3200000, taxRateBps: 1600, taxCents: 512000, totalCents: 3712000, amountPaidCents: 3712000, currency: "KES", notes: "", isDraft: false,
  },
  {
    id: "inv-5", number: `INV-${invoiceYear}-025`, customerId: "cus-1", customerName: "Mary Wanjiku", customerEmail: "mary@acme.co.ke",
    issueDate: daysAgo(1), dueDate: daysFromNow(14), items: [{ id: "itm-5", description: "Monthly retainer", quantity: 2, unitPriceCents: 5000000 }],
    subtotalCents: 10000000, taxRateBps: 1600, taxCents: 1600000, totalCents: 11600000, amountPaidCents: 0, currency: "KES", notes: "Thank you for your business.", isDraft: true,
  },
];

export const initialPayments: Payment[] = [
  { id: "pay-1", invoiceId: "inv-3", invoiceNumber: `INV-${invoiceYear}-022`, customerName: "Amina Hassan", amountCents: 5800000, currency: "KES", method: "M-Pesa", date: daysAgo(3), reference: "QK82M4P1" },
  { id: "pay-2", invoiceId: "inv-4", invoiceNumber: `INV-${invoiceYear}-021`, customerName: "Peter Kamau", amountCents: 3712000, currency: "KES", method: "Bank transfer", date: daysAgo(12), reference: "TRF-98124" },
];
