export type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  address: string;
  initials: string;
  color: string;
  invoiceCount?: number;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
};

export type InvoiceItem = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
};

export type Invoice = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  issueDate: string;
  dueDate: string;
  items: InvoiceItem[];
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  creditedCents?: number;
  currency: string;
  notes: string;
  templateId?: string | null;
  templateName?: string | null;
  templateConfig?: { primaryColor?: string; footerNote?: string } | null;
  deliveryNoteId?: string | null;
  deliveryNoteNumber?: string | null;
  isDraft: boolean;
  isVoid?: boolean;
};

export type Payment = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  amountCents: number;
  currency: string;
  method: string;
  date: string;
  reference: string;
};

export type Quotation = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  currency: string;
  issueDate: string;
  expiryDate: string;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired" | "converted";
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  items: InvoiceItem[];
  convertedInvoiceId?: string | null;
};

export type AppSettings = {
  businessName: string;
  email: string;
  phone: string;
  address: string;
  currency: string;
  taxRateBps: number;
  lightMode: boolean;
  colorTheme?: "blue" | "emerald" | "violet" | "rose" | "amber";
  invoiceLayout?: "classic" | "centered" | "compact" | "modern";
  logoUrl?: string | null;
  letterheadUrl?: string | null;
  letterheadMimeType?: string | null;
};

export type DeliveryNoteInput = {
  deliveryDate: string;
  recipientName: string;
  deliveryAddress: string;
  deliveredBy: string;
  notes: string;
  items: { invoiceItemId: string; quantity: number }[];
};

export type DeliveryNote = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  deliveryNumber: string;
  deliveryDate: string;
};

export type InvoiceStatus = "Paid" | "Pending" | "Overdue" | "Draft" | "Void";

export type View =
  | "Dashboard"
  | "Invoices"
  | "Customers"
  | "Products"
  | "Payments"
  | "Adjustments"
  | "Proformas"
  | "Quotations"
  | "Recurring"
  | "Reports"
  | "Settings"
  | "Platform admin";
