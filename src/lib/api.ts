import type { AppSettings, Customer, Invoice, Payment, Product, Quotation } from "../types";

export type BusinessMembership = {
  id: string;
  name: string;
  currency: string;
  role: string;
};

export type Session = {
  user: { id: string; email: string; fullName: string };
  tenants: BusinessMembership[];
  activeTenantId: string;
};

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiError("The API server is unavailable. Start MySQL and the API, or use the local demo.", 0, "API_UNAVAILABLE");
  }
  if (response.status === 204) return undefined as T;
  let body: { data?: T; error?: { code?: string; message?: string } };
  try {
    body = await response.json() as typeof body;
  } catch {
    throw new ApiError("The API returned an invalid response. Check that the backend is running.", response.status, "INVALID_API_RESPONSE");
  }
  if (!response.ok) {
    throw new ApiError(body.error?.message ?? "The request could not be completed.", response.status, body.error?.code ?? "REQUEST_FAILED");
  }
  return body.data as T;
}

async function loadAll<T>(path: string) {
  const records: T[] = [];
  let offset = 0;
  while (true) {
    const page = await apiRequest<T[]>(`${path}?limit=100&offset=${offset}`);
    records.push(...page);
    if (page.length < 100) return records;
    offset += page.length;
    if (records.length > 10000) throw new ApiError("This workspace contains too many records to load in one session.", 413, "WORKSPACE_TOO_LARGE");
  }
}

type ApiCustomer = {
  id: string; name: string; email: string | null; phone: string | null; company: string | null;
  billingAddress: string | null; invoiceCount: number;
};

type ApiProduct = {
  id: string; name: string; description: string | null; category: string | null; unitPriceCents: number | string;
};

type ApiInvoiceItem = {
  id: string; description: string; quantity: number; unitPriceCents: number; lineTotalCents?: number;
};

type ApiInvoice = {
  id: string; invoiceNumber: string; customerId: string; customerName: string; customerEmail: string | null;
  issueDate: string; dueDate: string; items: ApiInvoiceItem[]; subtotalCents: number; taxRateBps: number;
  taxCents: number; totalCents: number; amountPaidCents: number; discountCents: number; currency: string;
  creditedCents: number; notes: string; status: string;
  templateId?: string | null; templateName?: string | null;
  templateConfig?: { primaryColor?: string; footerNote?: string } | null;
  deliveryNoteId?: string | null; deliveryNoteNumber?: string | null;
};

type ApiPayment = {
  id: string; invoiceId: string; invoiceNumber: string; customerName: string; amountCents: number;
  currency: string; method: string; date: string; reference: string | null;
};

type ApiBusinessSettings = {
  id: string; name: string; email: string; phone: string | null; address: string | null;
  currency: string; taxRateBps: number; invoicePrefix: string;
  invoiceLayout: AppSettings["invoiceLayout"]; logoUrl: string | null; letterheadUrl: string | null;
  letterheadMimeType: string | null;
};

export type WorkspaceData = {
  settings: AppSettings;
  customers: Customer[];
  products: Product[];
  invoices: Invoice[];
  payments: Payment[];
  quotations: Quotation[];
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function colorFor(name: string) {
  return ["violet", "green", "pink", "blue"][name.length % 4];
}

export async function loadWorkspaceData(currentSettings: AppSettings): Promise<WorkspaceData> {
  const [business, apiCustomers, apiProducts, apiInvoices, apiPayments, apiQuotations] = await Promise.all([
    apiRequest<ApiBusinessSettings>("/tenants/current"),
    loadAll<ApiCustomer>("/customers"),
    loadAll<ApiProduct>("/products"),
    loadAll<ApiInvoice>("/invoices"),
    loadAll<ApiPayment>("/payments"),
    loadAll<ApiQuotation>("/quotations"),
  ]);
  return {
    settings: {
      businessName: business.name,
      email: business.email,
      phone: business.phone ?? "",
      address: business.address ?? "",
      currency: business.currency,
      taxRateBps: business.taxRateBps,
      lightMode: currentSettings.lightMode,
      colorTheme: currentSettings.colorTheme ?? "blue",
      invoiceLayout: business.invoiceLayout ?? "classic",
      logoUrl: business.logoUrl ?? null,
      letterheadUrl: business.letterheadUrl ?? null,
      letterheadMimeType: business.letterheadMimeType ?? null,
    },
    customers: apiCustomers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      company: customer.company ?? "",
      address: customer.billingAddress ?? "",
      initials: initials(customer.name),
      color: colorFor(customer.name),
      invoiceCount: customer.invoiceCount,
    })),
    products: apiProducts.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description ?? "",
      category: product.category ?? "",
      priceCents: Number(product.unitPriceCents),
    })),
    invoices: apiInvoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      customerEmail: invoice.customerEmail ?? "",
      issueDate: String(invoice.issueDate).slice(0, 10),
      dueDate: String(invoice.dueDate).slice(0, 10),
      items: (invoice.items ?? []).map((item) => ({
        id: item.id,
        description: item.description,
        quantity: Number(item.quantity),
        unitPriceCents: Number(item.unitPriceCents),
      })),
      subtotalCents: Number(invoice.subtotalCents),
      taxRateBps: invoice.taxRateBps,
      taxCents: Number(invoice.taxCents),
      totalCents: Number(invoice.totalCents),
      amountPaidCents: Number(invoice.amountPaidCents),
      creditedCents: Number(invoice.creditedCents ?? 0),
      currency: invoice.currency,
      notes: invoice.notes ?? "",
      templateId: invoice.templateId ?? null,
      templateName: invoice.templateName ?? null,
      templateConfig: invoice.templateConfig ?? null,
      deliveryNoteId: invoice.deliveryNoteId ?? null,
      deliveryNoteNumber: invoice.deliveryNoteNumber ?? null,
      isDraft: invoice.status === "draft",
      isVoid: invoice.status === "void",
    })),
    payments: apiPayments.map((payment) => ({
      id: payment.id,
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoiceNumber,
      customerName: payment.customerName,
      amountCents: Number(payment.amountCents),
      currency: payment.currency,
      method: payment.method,
      date: String(payment.date).slice(0, 10),
      reference: payment.reference ?? "",
    })),
    quotations: apiQuotations.map((quotation) => ({
      id: quotation.id,
      number: quotation.quotationNumber,
      customerId: quotation.customerId,
      customerName: quotation.customerName,
      currency: quotation.currency,
      issueDate: String(quotation.issueDate).slice(0, 10),
      expiryDate: String(quotation.expiryDate).slice(0, 10),
      status: quotation.status,
      subtotalCents: Number(quotation.subtotalCents),
      discountCents: Number(quotation.discountCents),
      taxCents: Number(quotation.taxCents),
      totalCents: Number(quotation.totalCents),
      items: quotation.items.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: Number(item.quantity),
        unitPriceCents: Number(item.unitPriceCents),
      })),
      convertedInvoiceId: quotation.convertedInvoiceId,
    })),
  };
}

type ApiQuotation = {
  id: string; quotationNumber: string; customerId: string; customerName: string; currency: string;
  issueDate: string; expiryDate: string; status: Quotation["status"]; subtotalCents: number; discountCents: number;
  taxCents: number; totalCents: number; convertedInvoiceId?: string | null; items: ApiInvoiceItem[];
};

export async function updateBusinessSettings(settings: AppSettings) {
  return apiRequest<ApiBusinessSettings>("/tenants/current", {
    method: "PATCH",
    body: JSON.stringify({
      name: settings.businessName,
      email: settings.email,
      phone: settings.phone,
      address: settings.address,
      currency: settings.currency,
      taxRateBps: settings.taxRateBps,
      invoiceLayout: settings.invoiceLayout,
    }),
  });
}

export async function uploadBusinessLogo(file: File) {
  return apiRequest<{ logoUrl: string; mimeType: string }>("/tenants/current/logo", {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
}

export async function removeBusinessLogo() {
  return apiRequest<void>("/tenants/current/logo", { method: "DELETE" });
}

export async function uploadBusinessLetterhead(file: File) {
  return apiRequest<{ letterheadUrl: string; mimeType: string }>("/tenants/current/letterhead", {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
}

export async function removeBusinessLetterhead() {
  return apiRequest<void>("/tenants/current/letterhead", { method: "DELETE" });
}
