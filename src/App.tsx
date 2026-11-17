import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, Bell, BriefcaseBusiness, CalendarDays, Check, Download,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CreditCard, FileBarChart, FilePlus2,
  FileText, LayoutDashboard, LogOut, Menu, MoreHorizontal, Package, Plus, Search, Settings,
  Palette, ShieldCheck, Sun, Users, WalletCards, X, Truck, Receipt, Lightbulb, Plug,
} from "lucide-react";
import AccountSecurity from "./components/AccountSecurity";
import AdjustmentNotesPage from "./components/AdjustmentNotesPage";
import AuthPage from "./components/AuthPage";
import BusinessAdministration from "./components/BusinessAdministration";
import BusinessDialog from "./components/BusinessDialog";
import BusinessBranding from "./components/BusinessBranding";
import { ExpensesPage, IntegrationsPage, SecurityAuditPage, SmartToolsPage, SuppliersPage, TaxManagementPage } from "./components/BusinessModules";
import DeliveryNoteDialog from "./components/DeliveryNoteDialog";
import InvoiceDetail from "./components/InvoiceDetail";
import InvoiceDialog from "./components/InvoiceDialog";
import InvoiceTemplates from "./components/InvoiceTemplates";
import Modal from "./components/Modal";
import NotificationCenter from "./components/NotificationCenter";
import PlatformAdminPage from "./components/PlatformAdminPage";
import PaymentDialog from "./components/PaymentDialog";
import ProformasPage from "./components/ProformasPage";
import QuotationDialog from "./components/QuotationDialog";
import RecordDialog from "./components/RecordDialog";
import RecurringInvoicesPage from "./components/RecurringInvoicesPage";
import SubscriptionPanel from "./components/SubscriptionPanel";
import { initialCustomers, initialInvoices, initialPayments, initialProducts, initialSettings } from "./data";
import { apiRequest, loadWorkspaceData, updateBusinessSettings, type Session } from "./lib/api";
import { downloadCsv, downloadPdf } from "./lib/download";
import type { AppSettings, Customer, DeliveryNote, DeliveryNoteInput, Invoice, InvoiceStatus, Payment, Product, Quotation, View } from "./types";
import { formatDate, formatMoney, getInvoiceNumber, getInvoiceStatus, makeId, readStorage } from "./utils";

type Dialog = "invoice" | "customer" | "product" | "payment" | "detail" | "delivery-note" | "quotation" | "workspace" | "add-business" | null;
type StatusFilter = "All" | InvoiceStatus;
type AppMode = "checking" | "auth" | "demo" | "server" | "unavailable";

const navigation: { label: View; icon: typeof LayoutDashboard; section: "main" | "manage" | "tools" }[] = [
  { label: "Dashboard", icon: LayoutDashboard, section: "main" },
  { label: "Invoices", icon: FileText, section: "main" },
  { label: "Customers", icon: Users, section: "manage" },
  { label: "Products", icon: Package, section: "manage" },
  { label: "Payments", icon: CreditCard, section: "manage" },
  { label: "Expenses", icon: Receipt, section: "manage" },
  { label: "Suppliers", icon: Truck, section: "manage" },
  { label: "Reports", icon: FileBarChart, section: "manage" },
  { label: "Tax management", icon: FileBarChart, section: "manage" },
  { label: "Notifications", icon: Bell, section: "manage" },
  { label: "Staff & User Management", icon: Users, section: "manage" },
  { label: "Smart tools", icon: Lightbulb, section: "tools" },
  { label: "Integrations", icon: Plug, section: "tools" },
  { label: "Security & Audit Logs", icon: ShieldCheck, section: "tools" },
  { label: "Subscription plan", icon: CreditCard, section: "tools" },
  { label: "Settings", icon: Settings, section: "tools" },
  { label: "Platform admin", icon: ShieldCheck, section: "tools" },
];

const quickNavigation: { label: string; view: View }[] = [
  { label: "Dashboard", view: "Dashboard" },
  { label: "Invoice Management", view: "Invoices" },
  { label: "Quotations", view: "Quotations" },
  { label: "Proformas", view: "Proformas" },
  { label: "Adjustments", view: "Adjustments" },
  { label: "Recurring", view: "Recurring" },
  { label: "Reports & Analytics", view: "Reports" },
  { label: "Subscription Plan", view: "Subscription plan" },
];

const colorNames = ["violet", "green", "pink", "blue"];
const statuses: StatusFilter[] = ["All", "Paid", "Pending", "Overdue", "Draft", "Void"];

function Avatar({ name, color }: { name: string; color: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return <span className={`avatar avatar-${color}`}>{initials}</span>;
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}><span className="status-dot" />{status}</span>;
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><FileText size={22} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function RevenueChart({ payments, currency }: { payments: Payment[]; currency: string }) {
  const data = useMemo(() => Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - (5 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return {
      label: new Intl.DateTimeFormat("en", { month: "short" }).format(date),
      value: payments.filter((payment) => payment.currency === currency && payment.date.startsWith(key)).reduce((sum, payment) => sum + payment.amountCents, 0),
    };
  }), [payments, currency]);
  const max = Math.max(...data.map((point) => point.value), 1);
  const points = data.map((point, index) => ({
    ...point,
    x: 42 + (index * 618) / Math.max(data.length - 1, 1),
    y: 170 - (point.value / max) * 130,
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${points[0].x},184 ${line} ${points.at(-1)?.x},184`;

  return (
    <div className="chart-wrap">
      <div className="chart-legend"><span><i /> Payments received</span><span className="chart-period"><CalendarDays size={14} /> Last 6 months <ChevronDown size={14} /></span></div>
      <svg className="revenue-chart" viewBox="0 0 700 220" role="img" aria-label="Revenue received over the last six months">
        <defs><linearGradient id="revenue-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6385ff" stopOpacity=".23" /><stop offset="100%" stopColor="#6385ff" stopOpacity="0" /></linearGradient></defs>
        {[40, 84, 128, 172].map((y, index) => <g key={y}><line x1="42" x2="660" y1={y} y2={y} className="chart-grid" /><text x="0" y={y + 4} className="chart-axis">{formatCompact(max * (3 - index) / 3, currency)}</text></g>)}
        <polygon points={area} fill="url(#revenue-fill)" />
        <polyline points={line} fill="none" className="chart-line" />
        {points.map((point) => <g key={point.label}><circle cx={point.x} cy={point.y} r="4" className="chart-point" /><text x={point.x} y="207" textAnchor="middle" className="chart-axis">{point.label}</text></g>)}
      </svg>
    </div>
  );
}

function formatCompact(cents: number, currency: string) {
  const amount = cents / 100;
  const suffix = amount >= 1_000_000 ? `${(amount / 1_000_000).toFixed(1)}m` : amount >= 10_000 ? `${Math.round(amount / 1000)}k` : Math.round(amount).toLocaleString();
  return `${currency} ${suffix}`;
}

function formatCurrencyTotals(entries: { amountCents: number; currency: string }[], fallbackCurrency: string) {
  const totals = new Map<string, number>();
  for (const entry of entries) totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + entry.amountCents);
  if (totals.size === 0) return formatMoney(0, fallbackCurrency);
  return [...totals].map(([currency, amountCents]) => formatMoney(amountCents, currency)).join(" · ");
}

function formatCompactCurrencyTotals(entries: { amountCents: number; currency: string }[], fallbackCurrency: string) {
  const totals = new Map<string, number>();
  for (const entry of entries) totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + entry.amountCents);
  if (totals.size === 0) totals.set(fallbackCurrency, 0);
  return [...totals].map(([currency, amountCents]) => new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amountCents / 100)).join(" · ");
}

function App() {
  const [mode, setMode] = useState<AppMode>("checking");
  const [session, setSession] = useState<Session | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const savedSettings = readStorage("sip-settings", initialSettings);
    return {
      ...savedSettings,
      lightMode: readStorage("sip-light-mode", savedSettings.lightMode),
      colorTheme: readStorage("sip-color-theme", savedSettings.colorTheme ?? "blue"),
      invoiceLayout: savedSettings.invoiceLayout ?? "classic",
      logoUrl: savedSettings.logoUrl ?? null,
      letterheadUrl: savedSettings.letterheadUrl ?? null,
      letterheadMimeType: savedSettings.letterheadMimeType ?? null,
    };
  });
  const [customers, setCustomers] = useState<Customer[]>(() => readStorage("sip-customers", initialCustomers));
  const [products, setProducts] = useState<Product[]>(() => readStorage("sip-products", initialProducts));
  const [invoices, setInvoices] = useState<Invoice[]>(() => readStorage("sip-invoices", initialInvoices));
  const [payments, setPayments] = useState<Payment[]>(() => readStorage("sip-payments", initialPayments));
  const [quotations, setQuotations] = useState<Quotation[]>(() => readStorage("sip-quotations", []));
  const [view, setView] = useState<View>("Dashboard");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toast, setToast] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<Session | null>("/auth/me").then(async (currentSession) => {
      if (!active) return;
      if (!currentSession) {
        setIsPlatformAdmin(false);
        setMode("auth");
        return;
      }
      setWorkspaceLoading(true);
      try {
        const [workspace, platformAdmin] = await Promise.all([
          loadWorkspaceData(settings),
          apiRequest<{ isPlatformAdmin: boolean }>("/platform-admin/me"),
        ]);
        if (!active) return;
        setSession(currentSession);
        setIsPlatformAdmin(platformAdmin.isPlatformAdmin);
        setSettings(workspace.settings);
        setCustomers(workspace.customers);
        setProducts(workspace.products);
        setInvoices(workspace.invoices);
        setPayments(workspace.payments);
        setQuotations(workspace.quotations);
        setMode("server");
      } catch (error) {
        if (!active) return;
        setAuthNotice(error instanceof Error ? error.message : "Could not load your workspace.");
        setMode("unavailable");
      } finally {
        if (active) setWorkspaceLoading(false);
      }
    }).catch((error: unknown) => {
      if (!active) return;
      setAuthNotice(error instanceof Error ? error.message : "The API server is not available.");
      setMode("unavailable");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (mode === "demo") localStorage.setItem("sip-settings", JSON.stringify(settings));
    if (mode === "server") {
      localStorage.setItem("sip-light-mode", JSON.stringify(settings.lightMode));
      localStorage.setItem("sip-color-theme", JSON.stringify(settings.colorTheme ?? "blue"));
    }
  }, [mode, settings]);
  useEffect(() => { if (mode === "demo") localStorage.setItem("sip-customers", JSON.stringify(customers)); }, [mode, customers]);
  useEffect(() => { if (mode === "demo") localStorage.setItem("sip-products", JSON.stringify(products)); }, [mode, products]);
  useEffect(() => { if (mode === "demo") localStorage.setItem("sip-invoices", JSON.stringify(invoices)); }, [mode, invoices]);
  useEffect(() => { if (mode === "demo") localStorage.setItem("sip-payments", JSON.stringify(payments)); }, [mode, payments]);
  useEffect(() => { if (mode === "demo") localStorage.setItem("sip-quotations", JSON.stringify(quotations)); }, [mode, quotations]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null;
  const userRole = session?.tenants.find((tenant) => tenant.id === session.activeTenantId)?.role ?? "";
  const invoiceStats = useMemo(() => invoices.reduce((stats, invoice) => {
    const status = getInvoiceStatus(invoice);
    if (!invoice.isDraft && !invoice.isVoid) {
      stats.total += 1;
      stats.billed += invoice.totalCents;
      stats.received += invoice.amountPaidCents;
      stats.outstanding += Math.max(0, invoice.totalCents - invoice.amountPaidCents);
    }
    if (status === "Overdue") stats.overdue += 1;
    return stats;
  }, { total: 0, billed: 0, received: 0, outstanding: 0, overdue: 0 }), [invoices]);

  const filteredInvoices = invoices.filter((invoice) => {
    const matchesSearch = `${invoice.number} ${invoice.customerName} ${invoice.customerEmail}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (statusFilter === "All" || getInvoiceStatus(invoice) === statusFilter);
  });
  const filteredCustomers = customers.filter((customer) => `${customer.name} ${customer.email} ${customer.company}`.toLowerCase().includes(search.toLowerCase()));
  const filteredProducts = products.filter((product) => `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(search.toLowerCase()));
  const filteredPayments = payments.filter((payment) => `${payment.invoiceNumber} ${payment.customerName} ${payment.method} ${payment.reference}`.toLowerCase().includes(search.toLowerCase()));

  function showToast(message: string) {
    setToast(message);
  }

  async function activateSession(nextSession: Session) {
    setWorkspaceLoading(true);
    try {
      await apiRequest("/auth/tenant", {
        method: "POST",
        body: JSON.stringify({ tenantId: nextSession.activeTenantId }),
      });
      const [workspace, platformAdmin] = await Promise.all([
        loadWorkspaceData(settings),
        apiRequest<{ isPlatformAdmin: boolean }>("/platform-admin/me"),
      ]);
      setSession(nextSession);
      setIsPlatformAdmin(platformAdmin.isPlatformAdmin);
      setSettings(workspace.settings);
      setCustomers(workspace.customers);
      setProducts(workspace.products);
      setInvoices(workspace.invoices);
      setPayments(workspace.payments);
      setQuotations(workspace.quotations);
      setMode("server");
      setView("Dashboard");
      setDialog(null);
      setAuthNotice("");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function refreshServerWorkspace() {
    if (mode !== "server") return;
    const workspace = await loadWorkspaceData(settings);
    setSettings(workspace.settings);
    setCustomers(workspace.customers);
    setProducts(workspace.products);
    setInvoices(workspace.invoices);
    setPayments(workspace.payments);
    setQuotations(workspace.quotations);
  }

  async function logout() {
    try {
      await apiRequest("/auth/logout", { method: "POST", body: "{}" });
      setSession(null);
      setIsPlatformAdmin(false);
      setDialog(null);
      setMode("auth");
      setAuthNotice("");
      setCustomers([]);
      setProducts([]);
      setInvoices([]);
      setPayments([]);
      setQuotations([]);
      setView("Dashboard");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not sign out.");
    }
  }

  async function switchTenant(tenantId: string) {
    try {
      await apiRequest("/auth/tenant", { method: "POST", body: JSON.stringify({ tenantId }) });
      const selected = session?.tenants.find((tenant) => tenant.id === tenantId);
      if (session && selected) setSession({ ...session, activeTenantId: tenantId });
      await refreshServerWorkspace();
      setDialog(null);
      setView("Dashboard");
      showToast(`Switched to ${selected?.name ?? "business"}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not switch businesses.");
    }
  }

  async function addBusiness(business: Session["tenants"][number]) {
    if (!session) return;
    const updatedSession = {
      ...session,
      activeTenantId: business.id,
      tenants: [...session.tenants, business],
    };
    setSession(updatedSession);
    const workspace = await loadWorkspaceData(settings);
    setSettings(workspace.settings);
    setCustomers(workspace.customers);
    setProducts(workspace.products);
    setInvoices(workspace.invoices);
    setPayments(workspace.payments);
    setQuotations(workspace.quotations);
    setDialog(null);
    setView("Dashboard");
    showToast(`${business.name} is ready.`);
  }

  function navigate(next: View) {
    setView(next);
    setSearch("");
    setSidebarOpen(false);
  }

  function restoreSampleWorkspace() {
    if (!window.confirm("Restore the sample workspace? Your current locally saved data will be replaced.")) return;
    setSettings(initialSettings);
    setCustomers(initialCustomers);
    setProducts(initialProducts);
    setInvoices(initialInvoices);
    setPayments(initialPayments);
    setQuotations([]);
    showToast("Sample workspace restored.");
  }

  function switchToAccount() {
    setAuthNotice("");
    setMode("auth");
  }

  async function saveInvoice(invoice: Invoice) {
    if (mode === "server") {
      try {
        const created = await apiRequest<{ id: string; invoiceNumber: string }>("/invoices", {
          method: "POST",
          body: JSON.stringify({
            customerId: invoice.customerId,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            currency: invoice.currency,
            taxRateBps: invoice.taxRateBps,
            templateId: invoice.templateId ?? null,
            notes: invoice.notes,
            issueNow: !invoice.isDraft,
            items: invoice.items.map((item) => ({
              productId: products.find((product) => product.name === item.description)?.id ?? null,
              description: item.description,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
            })),
          }),
        });
        await refreshServerWorkspace();
        if (invoice.isDraft) {
          setDialog(null);
          showToast("Invoice saved as a draft.");
        } else {
          setSelectedInvoiceId(created.id);
          setDialog("detail");
          showToast(`${created.invoiceNumber} issued. You can now create its delivery note.`);
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not save this invoice.");
      }
      return;
    }
    setInvoices((current) => [invoice, ...current]);
    setDialog(null);
    showToast(invoice.isDraft ? "Invoice saved as a draft." : `${invoice.number} has been issued.`);
  }

  async function savePayment(payment: Payment) {
    if (mode === "server") {
      try {
        await apiRequest("/payments", {
          method: "POST",
          body: JSON.stringify({
            invoiceId: payment.invoiceId,
            amountCents: payment.amountCents,
            method: payment.method.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_"),
            reference: payment.reference === "—" ? "" : payment.reference,
          }),
        });
        await refreshServerWorkspace();
        setDialog(null);
        showToast("Payment recorded and invoice balance updated.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not record this payment.");
      }
      return;
    }
    setPayments((current) => [payment, ...current]);
    setInvoices((current) => current.map((invoice) => invoice.id === payment.invoiceId
      ? { ...invoice, amountPaidCents: Math.min(invoice.totalCents, invoice.amountPaidCents + payment.amountCents) }
      : invoice));
    setDialog(null);
    showToast("Payment recorded and invoice balance updated.");
  }

  async function downloadInvoicePdf(invoice: Invoice) {
    try {
      await downloadPdf(`/invoices/${invoice.id}/pdf`, `${invoice.number}.pdf`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not download this invoice.");
    }
  }

  async function downloadDeliveryNotePdf(id: string, deliveryNumber: string) {
    try {
      await downloadPdf(`/delivery-notes/${id}/pdf`, `${deliveryNumber}.pdf`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not download this delivery note.");
    }
  }

  async function saveDeliveryNote(invoice: Invoice, input: DeliveryNoteInput) {
    const deliveryNote = await apiRequest<DeliveryNote>(`/invoices/${invoice.id}/delivery-note`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    await refreshServerWorkspace();
    setDialog("detail");
    showToast(`${deliveryNote.deliveryNumber} created.`);
    await downloadDeliveryNotePdf(deliveryNote.id, deliveryNote.deliveryNumber);
  }

  async function downloadPaymentReceipt(payment: Payment) {
    try {
      await downloadPdf(`/payments/${payment.id}/receipt.pdf`, `receipt-${payment.id.slice(0, 8)}.pdf`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not download this receipt.");
    }
  }

  async function downloadReport(report: "invoices" | "payments" | "outstanding" | "tax") {
    try {
      await downloadCsv(`/reports/exports/${report}`, `${report}-report.csv`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not export this report.");
    }
  }

  async function saveCustomer(customer: Customer) {
    if (mode === "server") {
      try {
        await apiRequest("/customers", {
          method: "POST",
          body: JSON.stringify({
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            company: customer.company,
            billingAddress: customer.address,
          }),
        });
        await refreshServerWorkspace();
        setDialog(null);
        showToast("Customer added successfully.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not add this customer.");
      }
      return;
    }
    setCustomers((current) => [customer, ...current]);
    setDialog(null);
    showToast("Customer added successfully.");
  }

  async function saveProduct(product: Product) {
    if (mode === "server") {
      try {
        await apiRequest("/products", {
          method: "POST",
          body: JSON.stringify({
            name: product.name,
            description: product.description,
            category: product.category,
            unitPriceCents: product.priceCents,
          }),
        });
        await refreshServerWorkspace();
        setDialog(null);
        showToast("Product added to your catalog.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not add this product.");
      }
      return;
    }
    setProducts((current) => [product, ...current]);
    setDialog(null);
    showToast("Product added to your catalog.");
  }

  function openInvoice(invoice: Invoice) {
    setSelectedInvoiceId(invoice.id);
    setDialog("detail");
  }

  function createQuotation() {
    setDialog("quotation");
  }

  async function saveQuotation(quotation: Quotation) {
    if (mode === "server") {
      const saved = await apiRequest<{ quotationNumber: string }>("/quotations", {
        method: "POST",
        body: JSON.stringify({
          customerId: quotation.customerId,
          issueDate: quotation.issueDate,
          expiryDate: quotation.expiryDate,
          currency: quotation.currency,
          taxRateBps: settings.taxRateBps,
          items: quotation.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
          })),
        }),
      });
      await refreshServerWorkspace();
      setDialog(null);
      showToast(`${saved.quotationNumber} saved.`);
      return;
    }
    setQuotations((current) => [{
      ...quotation,
      number: `QUO-${new Date().getFullYear()}-${String(current.length + 1).padStart(3, "0")}`,
    }, ...current]);
    setDialog(null);
    showToast("Quotation saved.");
  }

  async function convertQuotation(quotation: Quotation) {
    if (mode === "server") {
      try {
        await apiRequest(`/quotations/${quotation.id}/convert`, { method: "POST", body: "{}" });
        await refreshServerWorkspace();
        showToast("Quotation converted to an invoice.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not convert this quotation.");
      }
      return;
    }
    const customer = customers.find((entry) => entry.id === quotation.customerId);
    if (!customer) {
      showToast("The quotation customer is no longer available.");
      return;
    }
    const invoice: Invoice = {
      id: makeId("invoice"),
      number: getInvoiceNumber(invoices),
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: quotation.expiryDate,
      items: quotation.items,
      subtotalCents: quotation.subtotalCents,
      taxRateBps: settings.taxRateBps,
      taxCents: quotation.taxCents,
      totalCents: quotation.totalCents,
      amountPaidCents: 0,
      currency: quotation.currency,
      notes: `Converted from ${quotation.number}`,
      isDraft: false,
    };
    setInvoices((current) => [invoice, ...current]);
    setQuotations((current) => current.map((entry) => entry.id === quotation.id ? { ...entry, status: "converted" } : entry));
    showToast(`${quotation.number} converted to ${invoice.number}.`);
  }

  async function issueInvoice(invoice: Invoice) {
    if (mode === "server") {
      try {
        await apiRequest(`/invoices/${invoice.id}/issue`, { method: "POST", body: "{}" });
        await refreshServerWorkspace();
        setDialog("detail");
        showToast(`${invoice.number} has been issued.`);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not issue this invoice.");
      }
      return;
    }
    setInvoices((current) => current.map((entry) => entry.id === invoice.id ? { ...entry, isDraft: false } : entry));
    setDialog("detail");
    showToast(`${invoice.number} has been issued.`);
  }

  async function voidInvoice(invoice: Invoice) {
    const reason = window.prompt(`Why are you voiding ${invoice.number}?`);
    if (reason === null) return;
    if (reason.trim().length < 3) {
      showToast("Enter a reason of at least three characters.");
      return;
    }
    if (mode === "server") {
      try {
        await apiRequest(`/invoices/${invoice.id}/void`, { method: "POST", body: JSON.stringify({ reason }) });
        await refreshServerWorkspace();
        setDialog(null);
        showToast(`${invoice.number} has been voided.`);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not void this invoice.");
      }
      return;
    }
    setInvoices((current) => current.map((entry) => entry.id === invoice.id ? { ...entry, isVoid: true } : entry));
    setDialog(null);
    showToast(`${invoice.number} has been voided.`);
  }

  function openCreateInvoice() {
    if (customers.length === 0) {
      showToast("Add a customer before creating an invoice.");
      setView("Customers");
      setDialog("customer");
      return;
    }
    setDialog("invoice");
  }

  function searchWorkspace(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !search.trim()) return;
    const query = search.trim().toLowerCase();
    const matches = (value: string) => value.toLowerCase().includes(query);
    if (invoices.some((invoice) => matches(`${invoice.number} ${invoice.customerName} ${invoice.customerEmail}`))) setView("Invoices");
    else if (customers.some((customer) => matches(`${customer.name} ${customer.company} ${customer.email}`))) setView("Customers");
    else if (products.some((product) => matches(`${product.name} ${product.category} ${product.description}`))) setView("Products");
    else if (payments.some((payment) => matches(`${payment.invoiceNumber} ${payment.customerName} ${payment.method} ${payment.reference}`))) setView("Payments");
    else {
      showToast("No matching invoices, customers, products or payments.");
      return;
    }
    setSidebarOpen(false);
  }

  return (
    mode === "checking" || workspaceLoading
      ? <div className="app-loading"><span className="loading-mark"><BriefcaseBusiness size={19} /></span><strong>{workspaceLoading ? "Loading your business…" : "Connecting to your workspace…"}</strong><span>Your records stay private to your business.</span></div>
      : mode === "auth" || mode === "unavailable"
        ? <AuthPage onAuthenticated={activateSession} notice={mode === "unavailable" ? authNotice : undefined} />
        : <div className={`app-shell color-theme-${settings.colorTheme ?? "blue"} ${settings.lightMode ? "light-mode" : ""}`}>
      {sidebarOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><span /></div>
          <div className="brand-copy"><strong>SMART INVOICE</strong><span>{mode === "server" ? "ADMIN PANEL" : "LOCAL DEMO"}</span></div>
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <button className="workspace-switcher" onClick={() => session && session.tenants.length > 1 ? setDialog("workspace") : showToast("This workspace is your active business.")}>
          <div className="workspace-avatar">{settings.businessName.trim()[0]?.toUpperCase() ?? "B"}</div>
          <span className="workspace-copy">          <strong>{settings.businessName}</strong><small>{mode === "server" ? "Business workspace" : "Local demo"}</small></span>
          <ChevronDown size={15} className="workspace-chevron" />
        </button>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.filter((item) => item.label !== "Platform admin" || isPlatformAdmin)
            .filter((item) => mode === "server" || ["Dashboard", "Invoices", "Customers", "Products", "Payments", "Reports", "Settings", "Smart tools", "Subscription plan"].includes(item.label))
            .filter((item) => !["Expenses", "Suppliers"].includes(item.label) || ["owner", "admin", "finance_manager", "accountant", "auditor"].includes(userRole))
            .filter((item) => item.label !== "Tax management" || mode !== "server" || ["owner", "admin", "finance_manager", "accountant", "sales_officer", "auditor"].includes(userRole))
            .filter((item) => item.label !== "Security & Audit Logs" || ["owner", "admin", "finance_manager", "accountant", "auditor"].includes(userRole))
            .map((item) => <NavButton key={item.label} item={{ ...item, displayLabel: ({
              Invoices: "Invoice Management",
              Products: "Products & Services",
              Reports: "Reports & Analytics",
              "Tax management": "Tax Management",
              "Smart tools": "AI Smart Tools",
              "Subscription plan": "Subscription Plan",
              Settings: "System Settings",
            } as Partial<Record<View, string>>)[item.label] }} active={view === item.label || (item.label === "Invoices" && ["Proformas", "Quotations", "Recurring", "Adjustments"].includes(view))} onClick={() => navigate(item.label)} badge={item.label === "Invoices" && invoiceStats.overdue > 0 ? String(invoiceStats.overdue) : undefined} />)}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item nav-item-logout" onClick={mode === "server" ? () => void logout() : switchToAccount} title="Logout"><LogOut size={18} strokeWidth={1.8} /><span>Logout</span></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            <button className="collapse-toggle icon-button" aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setSidebarCollapsed((current) => !current)}><ChevronLeft size={17} /></button>
            <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{view}</strong></div>
          </div>
          <div className="topbar-right">
            <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={searchWorkspace} placeholder={`Search ${searchScope(view)}…`} aria-label={`Search ${searchScope(view)}`} />{search && <button className="clear-search" onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}<kbd>Enter</kbd></label>
            <button className="icon-button theme-toggle" aria-label={settings.lightMode ? "Switch to dark mode" : "Switch to light mode"} onClick={() => setSettings((current) => ({ ...current, lightMode: !current.lightMode }))}>{settings.lightMode ? <Sun size={18} /> : <Sun size={18} />}</button>
            <span className={`connection-badge ${mode === "server" ? "connection-live" : ""}`}><i />{mode === "server" ? "Connected" : "Local demo"}</span>
            <div className="notification-anchor">
              <button className="icon-button notification-button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><Bell size={18} /><i /></button>
              {notificationsOpen && (mode === "server"
                ? <NotificationCenter onClose={() => setNotificationsOpen(false)} />
                : <div className="notification-center"><header><span><Bell size={15} /> Notifications</span><button className="icon-button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}><X size={15} /></button></header><p className="notification-empty">Notifications are available when connected to your business account.</p></div>)}
            </div>
            <Avatar name={session?.user.fullName ?? "Demo account"} color="blue" />
          </div>
        </header>

        <nav className="top-navigation" aria-label="Quick navigation">
          <div className="top-navigation-links">
            {quickNavigation.filter((item) => mode === "server" || ["Dashboard", "Invoice Management", "Quotations", "Reports & Analytics", "Subscription Plan"].includes(item.label))
              .map((item) => <button key={item.view} className={`top-navigation-link ${view === item.view || (item.view === "Invoices" && ["Proformas", "Quotations", "Recurring", "Adjustments"].includes(view)) ? "top-navigation-link-active" : ""}`} onClick={() => navigate(item.view)}>{item.label}</button>)}
            {isPlatformAdmin && <button className={`top-navigation-link ${view === "Platform admin" ? "top-navigation-link-active" : ""}`} onClick={() => navigate("Platform admin")}>Platform admin</button>}
          </div>
        </nav>

        <div className="content-area">
          {view === "Dashboard" && <Dashboard
            settings={settings} invoices={invoices} payments={payments} invoiceStats={invoiceStats} userName={session?.user.fullName ?? "Evans"}
            onNewInvoice={openCreateInvoice} onNewCustomer={() => setDialog("customer")}
            onNewProduct={() => setDialog("product")} onNewPayment={() => setDialog("payment")}
            onViewInvoices={() => navigate("Invoices")} onOpenInvoice={openInvoice} onViewPayments={() => navigate("Payments")}
          />}
          {view === "Invoices" && <InvoicesPage invoices={filteredInvoices} totalCount={invoices.length} search={search} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onNew={openCreateInvoice} onOpen={openInvoice} />}
          {view === "Customers" && <CustomersPage customers={filteredCustomers.map((customer) => ({ ...customer, invoiceCount: invoices.filter((invoice) => invoice.customerId === customer.id).length }))} totalCount={customers.length} search={search} onNew={() => setDialog("customer")} />}
          {view === "Products" && <ProductsPage products={filteredProducts} totalCount={products.length} currency={settings.currency} search={search} onNew={() => setDialog("product")} />}
          {view === "Payments" && <PaymentsPage payments={filteredPayments} totalCount={payments.length} currency={settings.currency} search={search} onNew={() => setDialog("payment")} onOpenInvoice={(payment) => {
            const invoice = invoices.find((entry) => entry.id === payment.invoiceId);
            if (invoice) openInvoice(invoice);
          }} />}
          {view === "Expenses" && mode === "server" && <ExpensesPage currency={settings.currency} canWrite={["owner", "admin", "finance_manager", "accountant"].includes(userRole)} />}
          {view === "Suppliers" && mode === "server" && <SuppliersPage canWrite={["owner", "admin", "finance_manager", "accountant"].includes(userRole)} />}
          {view === "Adjustments" && mode === "server" && <AdjustmentNotesPage invoices={invoices} currency={settings.currency} canWrite={["owner", "admin", "finance_manager", "accountant", "sales_officer"].includes(session?.tenants.find((tenant) => tenant.id === session.activeTenantId)?.role ?? "")} onChanged={refreshServerWorkspace} />}
          {view === "Proformas" && mode === "server" && <ProformasPage customers={customers} products={products} currency={settings.currency} taxRateBps={settings.taxRateBps} canWrite={["owner", "admin", "finance_manager", "accountant", "sales_officer"].includes(session?.tenants.find((tenant) => tenant.id === session.activeTenantId)?.role ?? "")} onChanged={refreshServerWorkspace} />}
          {view === "Quotations" && <QuotationsPage quotations={quotations} onCreate={createQuotation} onConvert={convertQuotation} />}
          {view === "Recurring" && mode === "server" && <RecurringInvoicesPage customers={customers} products={products} currency={settings.currency} taxRateBps={settings.taxRateBps} />}
          {view === "Reports" && <ReportsPage invoices={invoices} payments={payments} currency={settings.currency} onExport={mode === "server" ? (report) => void downloadReport(report) : undefined} />}
          {view === "Subscription plan" && mode === "server" && <SubscriptionPanel />}
          {view === "Subscription plan" && mode !== "server" && <DemoSubscriptionPanel onSignIn={switchToAccount} />}
          {view === "Notifications" && mode === "server" && <NotificationCenter fullPage />}
          {view === "Tax management" && mode === "server" && <TaxManagementPage />}
          {view === "Smart tools" && <SmartToolsPage invoices={invoices} payments={payments} currency={settings.currency} onInvoices={() => navigate("Invoices")} />}
          {view === "Security & Audit Logs" && mode === "server" && ["owner", "admin", "finance_manager", "accountant", "auditor"].includes(userRole) && <SecurityAuditPage email={session?.user.email ?? ""} />}
          {view === "Integrations" && mode === "server" && <IntegrationsPage />}
          {view === "Staff & User Management" && mode === "server" && <><PageHeader eyebrow="PEOPLE & LOCATIONS" title="Staff & User Management" description="Manage business branches and workspace users. Only a business Admin can create accounts." /><BusinessAdministration businessRole={userRole} /></>}
          {view === "Platform admin" && isPlatformAdmin && <PlatformAdminPage />}
          {view === "Settings" && <SettingsPage settings={settings} serverMode={mode === "server"} userEmail={session?.user.email ?? ""} userRole={userRole} onChange={setSettings} onSave={async () => {
            if (settings.logoUrl && (![settings.businessName, settings.email, settings.phone, settings.address].every((value) => value.trim())
              || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email))) {
              showToast("Complete the business name, valid email, phone number, and address before using a logo.");
              return;
            }
            try {
              await updateBusinessSettings(settings);
              await refreshServerWorkspace();
              showToast("Business settings saved.");
            } catch (error) {
              showToast(error instanceof Error ? error.message : "Could not save your settings.");
            }
          }} onReset={restoreSampleWorkspace} />}
        </div>
      </main>

      {dialog === "invoice" && <InvoiceDialog customers={customers} products={products} currency={settings.currency} taxRateBps={settings.taxRateBps} invoiceNumber={mode === "server" ? "Assigned when saved" : getInvoiceNumber(invoices)} serverMode={mode === "server"} onClose={() => setDialog(null)} onSave={saveInvoice} />}
      {dialog === "customer" && <RecordDialog kind="customer" onClose={() => setDialog(null)} onSave={saveCustomer} />}
      {dialog === "product" && <RecordDialog kind="product" onClose={() => setDialog(null)} onSave={saveProduct} />}
      {dialog === "payment" && <PaymentDialog invoices={invoices} currency={settings.currency} onClose={() => setDialog(null)} onSave={savePayment} />}
      {dialog === "detail" && selectedInvoice && <InvoiceDetail invoice={selectedInvoice} settings={settings} payments={payments} serverMode={mode === "server"} canWriteInvoices={["owner", "admin", "finance_manager", "accountant", "sales_officer"].includes(session?.tenants.find((tenant) => tenant.id === session.activeTenantId)?.role ?? "")} onClose={() => setDialog(null)} onRecordPayment={() => setDialog("payment")} onIssue={() => void issueInvoice(selectedInvoice)} onVoid={() => void voidInvoice(selectedInvoice)} onCreateDeliveryNote={() => setDialog("delivery-note")} onDownloadDeliveryNote={() => selectedInvoice.deliveryNoteId && selectedInvoice.deliveryNoteNumber && void downloadDeliveryNotePdf(selectedInvoice.deliveryNoteId, selectedInvoice.deliveryNoteNumber)} onDownloadInvoice={() => void downloadInvoicePdf(selectedInvoice)} onDownloadReceipt={(payment) => void downloadPaymentReceipt(payment)} />}
      {dialog === "delivery-note" && selectedInvoice && <DeliveryNoteDialog invoice={selectedInvoice} onClose={() => setDialog("detail")} onSave={(input) => saveDeliveryNote(selectedInvoice, input)} />}
      {dialog === "quotation" && <QuotationDialog customers={customers} products={products} currency={settings.currency} taxRateBps={settings.taxRateBps} onClose={() => setDialog(null)} onSave={saveQuotation} />}
      {dialog === "workspace" && session && <Modal title="Your businesses" subtitle="Each business has its own private records." onClose={() => setDialog(null)}><div className="workspace-options">{session.tenants.map((tenant) => <button key={tenant.id} className={`workspace-option ${tenant.id === session.activeTenantId ? "workspace-option-active" : ""}`} onClick={() => void switchTenant(tenant.id)}><span className="workspace-avatar">{tenant.name[0]?.toUpperCase()}</span><span><strong>{tenant.name}</strong><small>{tenant.role} · {tenant.currency}</small></span>{tenant.id === session.activeTenantId && <Check size={17} />}</button>)}<button className="button button-secondary add-business-button" onClick={() => setDialog("add-business")}><Plus size={16} /> Add another business</button></div></Modal>}
      {dialog === "add-business" && <BusinessDialog onClose={() => setDialog(null)} onCreated={addBusiness} />}
      {toast && <div className="toast" role="status"><span className="toast-check"><Check size={15} /></span>{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast("")}><X size={15} /></button></div>}
    </div>
  );
}

function NavButton({ item, active, onClick, badge }: { item: { label: View; icon: typeof LayoutDashboard; displayLabel?: string }; active: boolean; onClick: () => void; badge?: string }) {
  const Icon = item.icon;
  const label = item.displayLabel ?? item.label;
  return <button className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={onClick} title={label}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{badge && <small>{badge}</small>}</button>;
}

function DemoSubscriptionPanel({ onSignIn }: { onSignIn: () => void }) {
  return <>
    <PageHeader eyebrow="PLANS & BILLING" title="Subscription Plan" description="Review the plan options and billing status for your business workspace." />
    <section className="panel settings-section demo-subscription-panel">
      <div className="panel-heading">
        <div><h2>Sign in to view your subscription</h2><p>The local demo uses sample records and is not connected to a business account or billing plan.</p></div>
        <span className="settings-section-icon"><CreditCard size={17} /></span>
      </div>
      <p className="settings-note">Your current plan, invoice and user limits, billing status, and administrator exemption are shown after you sign in to a real workspace.</p>
      <button className="button button-primary" onClick={onSignIn}>Sign in to your business</button>
    </section>
  </>;
}

function searchScope(view: View) {
  if (view === "Dashboard") return "anything";
  if (view === "Invoices") return "invoices";
  if (view === "Customers") return "customers";
  if (view === "Products") return "products";
  if (view === "Payments") return "payments";
  if (view === "Recurring") return "recurring invoices";
  return "workspace";
}

type DashboardProps = {
  settings: AppSettings;
  invoices: Invoice[];
  payments: Payment[];
  invoiceStats: { total: number; billed: number; received: number; outstanding: number; overdue: number };
  userName: string;
  onNewInvoice: () => void;
  onNewCustomer: () => void;
  onNewProduct: () => void;
  onNewPayment: () => void;
  onViewInvoices: () => void;
  onOpenInvoice: (invoice: Invoice) => void;
  onViewPayments: () => void;
};

function Dashboard({ settings, invoices, payments, invoiceStats, userName, onNewInvoice, onNewCustomer, onNewProduct, onNewPayment, onViewInvoices, onOpenInvoice, onViewPayments }: DashboardProps) {
  const issuedInvoices = invoices.filter((invoice) => !invoice.isDraft && !invoice.isVoid);
  const invoiceTotals = issuedInvoices.map((invoice) => ({ amountCents: invoice.totalCents, currency: invoice.currency }));
  const receivedTotals = payments.map((payment) => ({ amountCents: payment.amountCents, currency: payment.currency }));
  const outstandingTotals = issuedInvoices.map((invoice) => ({
    amountCents: Math.max(0, invoice.totalCents - invoice.amountPaidCents),
    currency: invoice.currency,
  }));
  const recentInvoices = [...invoices].filter((invoice) => !invoice.isDraft && !invoice.isVoid).sort((a, b) => b.issueDate.localeCompare(a.issueDate)).slice(0, 5);
  const paidCount = invoices.filter((invoice) => getInvoiceStatus(invoice) === "Paid").length;
  const pendingCount = invoices.filter((invoice) => getInvoiceStatus(invoice) === "Pending").length;
  const paidPercent = invoiceStats.total ? Math.round((paidCount / invoiceStats.total) * 100) : 0;
  const month = new Intl.DateTimeFormat("en", { month: "long" }).format(new Date());
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return <>
    <div className="page-heading dashboard-heading">
      <div><div className="eyebrow"><span className="live-dot" /> YOUR BUSINESS AT A GLANCE</div><h1>{greeting}, {userName.split(/\s+/)[0]} <span className="wave">✦</span></h1><p>Here’s what’s happening with your business today.</p></div>
      <div className="heading-actions"><button className="button button-quiet date-button"><CalendarDays size={16} /> {month} {new Date().getFullYear()} <ChevronDown size={15} /></button><button className="button button-primary" onClick={onNewInvoice}><Plus size={17} /> Create invoice</button></div>
    </div>
    <section className="stats-grid" aria-label="Business overview">
      <StatCard label="Total invoiced" value={formatCompactCurrencyTotals(invoiceTotals, settings.currency)} accessibleValue={formatCurrencyTotals(invoiceTotals, settings.currency)} change="Across all issued invoices" icon={FileText} tone="blue" />
      <StatCard label="Amount received" value={formatCompactCurrencyTotals(receivedTotals, settings.currency)} accessibleValue={formatCurrencyTotals(receivedTotals, settings.currency)} change="Payments recorded" icon={ArrowDownLeft} tone="green" />
      <StatCard label="Outstanding" value={formatCompactCurrencyTotals(outstandingTotals, settings.currency)} accessibleValue={formatCurrencyTotals(outstandingTotals, settings.currency)} change={`${invoiceStats.overdue} overdue invoice${invoiceStats.overdue === 1 ? "" : "s"}`} icon={WalletCards} tone="orange" />
      <StatCard label="Invoices issued" value={invoiceStats.total.toString().padStart(2, "0")} change={`${paidCount} paid · ${pendingCount} pending`} icon={FileBarChart} tone="purple" />
    </section>
    <section className="dashboard-grid">
      <div className="panel revenue-panel">
        <div className="panel-heading"><div><h2>Revenue overview</h2><p>Payments received over time</p></div><button className="icon-button panel-more" aria-label="Revenue chart options"><MoreHorizontal size={20} /></button></div>
        <RevenueChart payments={payments} currency={settings.currency} />
      </div>
      <div className="panel invoice-health-panel">
        <div className="panel-heading"><div><h2>Invoice health</h2><p>Here’s how you’re tracking</p></div><button className="icon-button panel-more" aria-label="Invoice health options"><MoreHorizontal size={20} /></button></div>
        <div className="health-total"><strong>{invoiceStats.total}</strong><span>total invoices</span></div>
        <div className="health-bar"><span style={{ width: `${paidPercent}%` }} /><i style={{ width: `${Math.min(35, Math.max(0, (pendingCount / Math.max(invoiceStats.total, 1)) * 100))}%` }} /></div>
        <div className="health-legend">
          <div><span className="legend-dot green-dot" /><span>Paid</span><strong>{paidCount}</strong></div>
          <div><span className="legend-dot yellow-dot" /><span>Pending</span><strong>{pendingCount}</strong></div>
          <div><span className="legend-dot red-dot" /><span>Overdue</span><strong>{invoiceStats.overdue}</strong></div>
          <div><span className="legend-dot blue-dot" /><span>Drafts</span><strong>{invoices.filter((invoice) => invoice.isDraft).length}</strong></div>
        </div>
      </div>
    </section>
    <section className="dashboard-grid lower-grid">
      <div className="panel recent-panel">
        <div className="panel-heading"><div><h2>Recent invoices <span className="count-chip">{recentInvoices.length}</span></h2><p>Keep an eye on your latest activity</p></div><button className="text-button" onClick={onViewInvoices}>View all <ArrowRight size={15} /></button></div>
        <InvoiceTable invoices={recentInvoices} onOpen={onOpenInvoice} compact />
      </div>
      <div className="panel activity-panel">
        <div className="panel-heading"><div><h2>Recent activity</h2><p>Your latest payment updates</p></div><button className="icon-button panel-more" aria-label="Activity options"><MoreHorizontal size={20} /></button></div>
        {payments.length === 0 ? <div className="activity-empty">Payment activity will appear here.</div> : <div className="activity-list">
          {[...payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4).map((payment) => <button key={payment.id} className="activity-item" onClick={onViewPayments}><span className="activity-icon"><ArrowDownLeft size={16} /></span><span className="activity-copy"><strong>Payment received</strong><small>{payment.customerName} · {formatDate(payment.date)}</small></span><strong className="activity-amount">+{formatMoney(payment.amountCents, payment.currency)}</strong></button>)}
        </div>}
      </div>
    </section>
    <section className="quick-actions">
      <div><span className="quick-label">QUICK ACTIONS</span><h2>A little shortcut goes a long way.</h2></div>
      <button onClick={onNewInvoice}><span className="quick-icon quick-blue"><FilePlus2 size={18} /></span><span><strong>Create invoice</strong><small>Bill a customer</small></span><ArrowRight size={15} /></button>
      <button onClick={onNewCustomer}><span className="quick-icon quick-violet"><Users size={18} /></span><span><strong>Add customer</strong><small>Grow your contacts</small></span><ArrowRight size={15} /></button>
      <button onClick={onNewProduct}><span className="quick-icon quick-green"><Package size={18} /></span><span><strong>Add a product</strong><small>Update your catalog</small></span><ArrowRight size={15} /></button>
      <button onClick={onNewPayment}><span className="quick-icon quick-orange"><CreditCard size={18} /></span><span><strong>Record payment</strong><small>Log a transaction</small></span><ArrowRight size={15} /></button>
    </section>
  </>;
}

function StatCard({ label, value, accessibleValue, change, icon: Icon, tone }: { label: string; value: string; accessibleValue?: string; change: string; icon: typeof FileText; tone: string }) {
  return <article className="stat-card" aria-label={`${label}: ${accessibleValue ?? value}`}><div className="stat-top"><span>{label}</span><span className={`stat-icon stat-${tone}`}><Icon size={17} /></span></div><strong className="stat-value" title={accessibleValue}>{value}</strong><div className="stat-change"><span className={`change-arrow ${tone === "orange" ? "change-warning" : ""}`}><ArrowUpRight size={13} /></span>{change}</div></article>;
}

function InvoicesPage({ invoices, totalCount, search, statusFilter, setStatusFilter, onNew, onOpen }: {
  invoices: Invoice[]; totalCount: number; search: string; statusFilter: StatusFilter; setStatusFilter: (filter: StatusFilter) => void; onNew: () => void; onOpen: (invoice: Invoice) => void;
}) {
  return <>
    <PageHeader eyebrow="BILLING" title="Invoice Management" description="Create, track and manage invoices, proformas, quotations, adjustments and recurring billing." action={<button className="button button-primary" onClick={onNew}><Plus size={17} /> New invoice</button>} />
    <div className="panel listing-panel">
      <div className="list-toolbar"><div className="filter-tabs" role="group" aria-label="Filter invoices by status">{statuses.map((status) => <button key={status} className={statusFilter === status ? "filter-tab active" : "filter-tab"} onClick={() => setStatusFilter(status)}>{status}{status === "All" && <span>{totalCount}</span>}</button>)}</div><button className="button button-quiet export-button" onClick={() => window.print()}><ArrowDownLeft size={15} /> Export / print</button></div>
      {invoices.length === 0 ? <EmptyState title={search ? "No invoices found" : "No invoices in this view"} description={search ? "Try a different search or status filter." : "Create your first invoice and it’ll show up here."} action={!search && <button className="button button-primary" onClick={onNew}><Plus size={16} /> Create invoice</button>} /> : <InvoiceTable invoices={invoices} onOpen={onOpen} />}
      <div className="table-footer"><span>Showing <strong>{invoices.length ? 1 : 0}–{invoices.length}</strong> of <strong>{invoices.length}</strong> invoices</span><div><button className="icon-button" aria-label="Previous page" disabled><ChevronLeft size={16} /></button><button className="icon-button" aria-label="Next page" disabled><ChevronRight size={16} /></button></div></div>
    </div>
  </>;
}

function InvoiceTable({ invoices, onOpen, compact = false }: { invoices: Invoice[]; onOpen: (invoice: Invoice) => void; compact?: boolean }) {
  return <div className={`table-scroll ${compact ? "compact-table" : ""}`}><table className="data-table">
    <thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>ISSUED</th><th>DUE DATE</th><th>AMOUNT</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{invoices.map((invoice) => <tr key={invoice.id} onClick={() => onOpen(invoice)}>
      <td><button className="table-primary-link" onClick={(event) => { event.stopPropagation(); onOpen(invoice); }}>{invoice.number}</button></td>
      <td><div className="customer-cell"><Avatar name={invoice.customerName} color={colorNames[invoice.customerName.length % colorNames.length]} /><span><strong>{invoice.customerName}</strong><small>{invoice.customerEmail}</small></span></div></td>
      <td>{formatDate(invoice.issueDate)}</td><td>{formatDate(invoice.dueDate)}</td><td><strong className="amount-cell">{formatMoney(invoice.totalCents, invoice.currency)}</strong></td>
      <td><StatusBadge status={getInvoiceStatus(invoice)} /></td><td><button className="icon-button row-more" aria-label={`Open ${invoice.number}`} onClick={(event) => { event.stopPropagation(); onOpen(invoice); }}><MoreHorizontal size={18} /></button></td>
    </tr>)}</tbody>
  </table></div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-actions">{action}</div>}</div>;
}

function CustomersPage({ customers, totalCount, search, onNew }: { customers: Customer[]; totalCount: number; search: string; onNew: () => void }) {
  return <>
    <PageHeader eyebrow="YOUR CONTACTS" title="Customers" description="A home for the people and businesses you work with." action={<button className="button button-primary" onClick={onNew}><Plus size={17} /> Add customer</button>} />
    <div className="panel listing-panel">
      <div className="list-toolbar simple-toolbar"><div><strong>{totalCount} customers</strong><span> · Keep your client details close at hand.</span></div><span className="toolbar-note"><Users size={15} /> Customer directory</span></div>
      {customers.length === 0 ? <EmptyState title="No customers found" description={search ? "Try a different search." : "Add a customer to get started."} action={!search && <button className="button button-primary" onClick={onNew}><Plus size={16} /> Add customer</button>} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>CUSTOMER</th><th>COMPANY</th><th>PHONE</th><th>LOCATION</th><th>INVOICES</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>
        {customers.map((customer) => <tr key={customer.id}><td><div className="customer-cell"><Avatar name={customer.name} color={customer.color} /><span><strong>{customer.name}</strong><small>{customer.email}</small></span></div></td><td>{customer.company || "—"}</td><td>{customer.phone || "—"}</td><td>{customer.address || "—"}</td><td><span className="count-chip">{customer.invoiceCount ?? "—"}</span></td><td><button className="icon-button" aria-label={`Customer options for ${customer.name}`}><MoreHorizontal size={18} /></button></td></tr>)}
      </tbody></table></div>}
      <div className="table-footer"><span>Showing <strong>{customers.length}</strong> of <strong>{totalCount}</strong> customers</span></div>
    </div>
  </>;
}

function ProductsPage({ products, totalCount, currency, search, onNew }: { products: Product[]; totalCount: number; currency: string; search: string; onNew: () => void }) {
  return <>
    <PageHeader eyebrow="WHAT YOU OFFER" title="Products & services" description="Keep your billable items organised and ready to add to an invoice." action={<button className="button button-primary" onClick={onNew}><Plus size={17} /> Add product</button>} />
    <div className="panel listing-panel">
      <div className="list-toolbar simple-toolbar"><div><strong>{totalCount} items</strong><span> · Your billable products and services.</span></div><span className="toolbar-note"><Package size={15} /> Product catalog</span></div>
      {products.length === 0 ? <EmptyState title="Your catalog is empty" description={search ? "Try a different search." : "Add a product or service to speed up invoice creation."} action={!search && <button className="button button-primary" onClick={onNew}><Plus size={16} /> Add product</button>} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>ITEM</th><th>CATEGORY</th><th>DESCRIPTION</th><th>UNIT PRICE</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>
        {products.map((product) => <tr key={product.id}><td><div className="product-cell"><span className="product-icon"><Package size={17} /></span><strong>{product.name}</strong></div></td><td><span className="category-pill">{product.category}</span></td><td>{product.description || "—"}</td><td><strong className="amount-cell">{formatMoney(product.priceCents, currency)}</strong></td><td><button className="icon-button" aria-label={`Options for ${product.name}`}><MoreHorizontal size={18} /></button></td></tr>)}
      </tbody></table></div>}
      <div className="table-footer"><span>Showing <strong>{products.length}</strong> of <strong>{totalCount}</strong> items</span></div>
    </div>
  </>;
}

function PaymentsPage({ payments, totalCount, currency, search, onNew, onOpenInvoice }: { payments: Payment[]; totalCount: number; currency: string; search: string; onNew: () => void; onOpenInvoice: (payment: Payment) => void }) {
  const total = formatCurrencyTotals(payments.map((payment) => ({ amountCents: payment.amountCents, currency: payment.currency })), currency);
  return <>
    <PageHeader eyebrow="MONEY IN" title="Payments" description="A clear record of every payment received from your customers." action={<button className="button button-primary" onClick={onNew}><Plus size={17} /> Record payment</button>} />
    <div className="mini-stats-row"><div className="panel mini-stat"><span>Total received {search && "in results"}</span><strong>{total}</strong></div><div className="panel mini-stat"><span>Transactions</span><strong>{payments.length}</strong></div><div className="panel mini-stat"><span>Payment methods</span><strong>{new Set(payments.map((payment) => payment.method)).size}</strong></div></div>
    <div className="panel listing-panel">
      <div className="list-toolbar simple-toolbar"><div><strong>Payment history</strong><span> · {totalCount} recorded transactions.</span></div><span className="toolbar-note"><CreditCard size={15} /> All transactions</span></div>
      {payments.length === 0 ? <EmptyState title="No payments found" description={search ? "Try a different search." : "Record a payment to keep your invoice balances up to date."} action={!search && <button className="button button-primary" onClick={onNew}><Plus size={16} /> Record payment</button>} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>TRANSACTION</th><th>CUSTOMER</th><th>DATE</th><th>METHOD</th><th>REFERENCE</th><th>AMOUNT</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>
        {payments.map((payment) => <tr key={payment.id} onClick={() => onOpenInvoice(payment)}><td><button className="table-primary-link" onClick={(event) => { event.stopPropagation(); onOpenInvoice(payment); }}>{payment.invoiceNumber}</button></td><td><strong>{payment.customerName}</strong></td><td>{formatDate(payment.date)}</td><td><span className="category-pill">{payment.method}</span></td><td className="reference-cell">{payment.reference}</td><td><strong className="payment-positive">+{formatMoney(payment.amountCents, payment.currency)}</strong></td><td><button className="icon-button" aria-label={`Open invoice ${payment.invoiceNumber}`} onClick={(event) => { event.stopPropagation(); onOpenInvoice(payment); }}><ArrowRight size={16} /></button></td></tr>)}
      </tbody></table></div>}
      <div className="table-footer"><span>Showing <strong>{payments.length}</strong> of <strong>{totalCount}</strong> payments</span></div>
    </div>
  </>;
}

function QuotationsPage({ quotations, onCreate, onConvert }: { quotations: Quotation[]; onCreate: () => void; onConvert: (quotation: Quotation) => void }) {
  return <>
    <PageHeader eyebrow="BEFORE THE INVOICE" title="Quotations" description="Share a clear estimate before work begins." action={<button className="button button-primary" onClick={onCreate}><Plus size={17} /> New quotation</button>} />
    {quotations.length === 0
      ? <div className="panel quotation-intro"><div className="quotation-art"><div className="quote-sheet"><span /><span /><span /><span /><strong /></div><span className="quotation-spark">✦</span></div><div><span className="eyebrow">START WITH A CLEAR QUOTE</span><h2>Agree on the details first.</h2><p>Create a professional estimate with itemised services, tax and an expiry date. Convert an accepted quotation into an invoice when you’re ready.</p><button className="button button-secondary" onClick={onCreate}><FilePlus2 size={16} /> Create your first quotation</button></div></div>
      : <div className="panel listing-panel"><div className="list-toolbar simple-toolbar"><div><strong>{quotations.length} quotations</strong><span> · Your estimates and approvals.</span></div><span className="toolbar-note"><FilePlus2 size={15} /> Quotations</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>QUOTATION</th><th>CUSTOMER</th><th>ISSUED</th><th>EXPIRES</th><th>AMOUNT</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{quotations.map((quotation) => <tr key={quotation.id}><td><strong className="table-primary-link">{quotation.number}</strong></td><td>{quotation.customerName}</td><td>{formatDate(quotation.issueDate)}</td><td>{formatDate(quotation.expiryDate)}</td><td><strong className="amount-cell">{formatMoney(quotation.totalCents, quotation.currency)}</strong></td><td><span className={`status-pill status-${quotation.status === "converted" ? "paid" : quotation.status === "expired" || quotation.status === "rejected" ? "overdue" : "pending"}`}><span className="status-dot" />{quotation.status}</span></td><td>{["draft", "accepted"].includes(quotation.status) && <button className="button button-secondary quote-convert" onClick={() => onConvert(quotation)}>Convert to invoice</button>}</td></tr>)}</tbody></table></div></div>}
  </>;
}

function ReportsPage({
  invoices, payments, currency, onExport,
}: {
  invoices: Invoice[];
  payments: Payment[];
  currency: string;
  onExport?: (report: "invoices" | "payments" | "outstanding" | "tax") => void;
}) {
  const statusCounts = (["Paid", "Pending", "Overdue", "Draft", "Void"] as InvoiceStatus[]).map((status) => ({ status, count: invoices.filter((invoice) => getInvoiceStatus(invoice) === status).length }));
  const totalPaid = formatCurrencyTotals(payments.map((payment) => ({ amountCents: payment.amountCents, currency: payment.currency })), currency);
  const totalOutstanding = formatCurrencyTotals(invoices.filter((invoice) => !invoice.isDraft && !invoice.isVoid).map((invoice) => ({ amountCents: Math.max(0, invoice.totalCents - invoice.amountPaidCents), currency: invoice.currency })), currency);
  return <>
    <PageHeader eyebrow="THE BIG PICTURE" title="Reports" description="A simple snapshot of your invoicing and cash flow." action={<div className="report-export-actions"><button className="button button-quiet" onClick={() => window.print()}><ArrowDownLeft size={15} /> Print report</button>{onExport && (["invoices", "payments", "outstanding", "tax"] as const).map((report) => <button className="button button-quiet" key={report} onClick={() => onExport(report)}><Download size={14} /> {report === "tax" ? "Tax CSV" : `${report[0].toUpperCase()}${report.slice(1)} CSV`}</button>)}</div>} />
    <div className="report-stat-grid"><div className="panel report-stat"><span><i className="report-dot blue-dot" />Total invoiced</span><strong>{formatCurrencyTotals(invoices.filter((invoice) => !invoice.isDraft && !invoice.isVoid).map((invoice) => ({ amountCents: invoice.totalCents, currency: invoice.currency })), currency)}</strong><small>Issued invoices, before payments</small></div><div className="panel report-stat"><span><i className="report-dot green-dot" />Collected</span><strong>{totalPaid}</strong><small>Recorded customer payments</small></div><div className="panel report-stat"><span><i className="report-dot yellow-dot" />Outstanding</span><strong>{totalOutstanding}</strong><small>Remaining balance on issued invoices</small></div></div>
    <div className="report-content-grid"><div className="panel report-breakdown"><div className="panel-heading"><div><h2>Invoice status</h2><p>Current status across all invoices</p></div></div>{statusCounts.map(({ status, count }) => <div className="report-status-row" key={status}><StatusBadge status={status} /><div className="report-track"><span className={`report-fill fill-${status.toLowerCase()}`} style={{ width: `${invoices.length ? Math.max(count ? 5 : 0, count / invoices.length * 100) : 0}%` }} /></div><strong>{count}</strong></div>)}</div><div className="panel report-breakdown"><div className="panel-heading"><div><h2>Recent payments</h2><p>Your latest incoming transactions</p></div></div>{payments.length === 0 ? <p className="muted-empty">No payment data yet.</p> : [...payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((payment) => <div className="report-payment-row" key={payment.id}><div className="activity-icon"><ArrowDownLeft size={15} /></div><div><strong>{payment.customerName}</strong><small>{payment.invoiceNumber} · {formatDate(payment.date)}</small></div><strong className="payment-positive">{formatMoney(payment.amountCents, currency)}</strong></div>)}</div></div>
  </>;
}

function SettingsPage({ settings, serverMode, userEmail, userRole, onChange, onSave, onReset }: { settings: AppSettings; serverMode: boolean; userEmail: string; userRole: string; onChange: (settings: AppSettings) => void; onSave: () => void; onReset: () => void }) {
  return <>
    <PageHeader eyebrow="MAKE IT YOURS" title="System Settings" description="Manage your business details, invoice defaults, subscription, and workspace preferences." action={serverMode ? <button className="button button-primary" onClick={onSave}>Save business settings</button> : undefined} />
    <div className="settings-layout">
      <nav className="settings-nav"><a className="settings-nav-active" href="#business">Business profile</a><a href="#invoicing">Invoicing</a><a href="#appearance">Appearance</a>{serverMode && <><a href="#account-security">Account security</a><a href="#invoice-templates">Invoice templates</a><a href="#business-administration">Branches and team</a><a href="#subscription">Subscription</a></>}<a href="#data">Workspace data</a></nav>
      <div className="settings-sections">
        <section className="panel settings-section" id="business"><div className="panel-heading"><div><h2>Business profile</h2><p>{settings.letterheadUrl ? "Business details are optional while you use a complete letterhead." : settings.logoUrl ? "All four details are required when you use a logo." : "This information appears on your invoices when you use a logo."}</p></div><span className="settings-section-icon"><BriefcaseBusiness size={17} /></span></div><div className="form-grid"><label className="field"><span>Business name{settings.logoUrl ? " *" : ""}</span><input value={settings.businessName} required={Boolean(settings.logoUrl)} onChange={(event) => onChange({ ...settings, businessName: event.target.value })} /></label><label className="field"><span>Business email{settings.logoUrl ? " *" : ""}</span><input type="email" value={settings.email} required={Boolean(settings.logoUrl)} onChange={(event) => onChange({ ...settings, email: event.target.value })} /></label><label className="field"><span>Phone number{settings.logoUrl ? " *" : ""}</span><input value={settings.phone} required={Boolean(settings.logoUrl)} onChange={(event) => onChange({ ...settings, phone: event.target.value })} /></label><label className="field"><span>Business address{settings.logoUrl ? " *" : ""}</span><input value={settings.address} required={Boolean(settings.logoUrl)} onChange={(event) => onChange({ ...settings, address: event.target.value })} /></label></div><BusinessBranding settings={settings} serverMode={serverMode} canManage={!serverMode || userRole === "owner" || userRole === "admin"} onChange={onChange} /></section>
        <section className="panel settings-section" id="invoicing"><div className="panel-heading"><div><h2>Invoice defaults</h2><p>Choose your default currency and tax rate.</p></div><span className="settings-section-icon"><FileText size={17} /></span></div><div className="form-grid"><label className="field"><span>Default currency</span><select value={settings.currency} onChange={(event) => onChange({ ...settings, currency: event.target.value })}><option value="KES">KES · Kenyan Shilling</option><option value="USD">USD · US Dollar</option><option value="EUR">EUR · Euro</option><option value="GBP">GBP · British Pound</option><option value="UGX">UGX · Ugandan Shilling</option><option value="TZS">TZS · Tanzanian Shilling</option></select></label><label className="field"><span>Default VAT / tax (%)</span><input type="number" min="0" max="100" step="0.01" value={(settings.taxRateBps / 100).toFixed(2)} onChange={(event) => onChange({ ...settings, taxRateBps: Math.round(Number(event.target.value) * 100) })} /></label></div><p className="settings-note"><CircleHelp size={15} /> Changes apply to new invoices. Existing invoices keep their original currency and tax calculation.</p></section>
        <section className="panel settings-section" id="appearance">
          <div className="panel-heading"><div><h2>Appearance</h2><p>Choose a coordinated accent and readable font color for your workspace.</p></div><span className="settings-section-icon"><Palette size={17} /></span></div>
          <div className="appearance-theme-grid" role="group" aria-label="Workspace color theme">
            {([
              { id: "blue", label: "Ocean blue", color: "#6385ff", font: "#dce6ff", lightFont: "#203560" },
              { id: "emerald", label: "Emerald", color: "#10b981", font: "#d7f8e9", lightFont: "#174b37" },
              { id: "violet", label: "Violet", color: "#9b7bf5", font: "#eee5ff", lightFont: "#402b70" },
              { id: "rose", label: "Rose", color: "#ec6b91", font: "#ffe3eb", lightFont: "#702b45" },
              { id: "amber", label: "Amber", color: "#e5a83b", font: "#fff1d2", lightFont: "#63451a" },
            ] as const).map((theme) => <button type="button" key={theme.id} className={`appearance-theme-option ${settings.colorTheme === theme.id ? "appearance-theme-selected" : ""}`} aria-pressed={(settings.colorTheme ?? "blue") === theme.id} onClick={() => onChange({ ...settings, colorTheme: theme.id })}>
              <span className="appearance-theme-swatch" style={{ backgroundColor: theme.color }} />
              <span className="appearance-theme-label"><strong>{theme.label}</strong><small style={{ color: settings.lightMode ? theme.lightFont : theme.font }}>Aa · sample text</small></span>
              <span className="appearance-theme-check">{settings.colorTheme === theme.id ? <Check size={15} /> : null}</span>
            </button>)}
          </div>
          <label className="setting-toggle-row appearance-light-toggle"><div><strong>Light theme</strong><small>Switch between light and dark surfaces; the selected accent and font colors adapt automatically.</small></div><button role="switch" aria-checked={settings.lightMode} className={`toggle-switch ${settings.lightMode ? "toggle-on" : ""}`} onClick={() => onChange({ ...settings, lightMode: !settings.lightMode })}><span /></button></label>
        </section>
        {serverMode && <AccountSecurity email={userEmail} />}
        {serverMode && <InvoiceTemplates canManage={userRole === "owner" || userRole === "admin"} />}
        {serverMode && <BusinessAdministration businessRole={userRole} />}
        {serverMode && <SubscriptionPanel />}
        <section className="panel settings-section" id="data"><div className="panel-heading"><div><h2>Workspace data</h2><p>{serverMode ? "Records are stored in your business database and isolated from other businesses." : "Your records are saved in this browser on this device."}</p></div><span className="settings-section-icon"><BriefcaseBusiness size={17} /></span></div><div className="data-notice"><span><Check size={16} /></span><div><strong>{serverMode ? "Secure business workspace" : "Local demo workspace"}</strong><p>{serverMode ? "Sign out when using a shared device. Your business data is stored on the configured MySQL server." : "Data is stored in this browser only. Cloud sync, team accounts and backups aren’t connected yet."}</p></div></div>{!serverMode && <button className="button button-danger-outline" onClick={onReset}>Restore sample workspace</button>}</section>
      </div>
    </div>
  </>;
}

export default App;
