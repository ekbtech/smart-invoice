import { useEffect, useMemo, useState } from "react";
import { Download, Lightbulb, Plus, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import AccountSecurity from "./AccountSecurity";
import { apiRequest } from "../lib/api";
import { downloadCsv } from "../lib/download";
import type { Invoice, Payment } from "../types";
import { formatDate, formatMoney } from "../utils";

type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxPin: string | null;
  address: string | null;
  notes: string | null;
};

type Expense = {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  expenseDate: string;
  category: string;
  description: string;
  reference: string | null;
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  currency: string;
};

type TaxSummary = {
  currency: string;
  vatCollectedCents: number;
  vatPaidCents: number;
  netVatCents: number;
  invoiceCount: number;
  expenseCount: number;
};

type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
};

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-actions">{action}</div>}</div>;
}

function ErrorMessage({ message }: { message: string }) {
  return message ? <p className="security-error" role="alert">{message}</p> : null;
}

async function loadAll<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await apiRequest<T[]>(`${path}?limit=100&offset=${offset}`);
    rows.push(...page);
    if (page.length < 100) return rows;
    if (rows.length >= 10000) throw new Error("Too many records to display in one view.");
  }
}

export function SuppliersPage({ canWrite }: { canWrite: boolean }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", taxPin: "", address: "", notes: "" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      setSuppliers(await loadAll<Supplier>("/suppliers"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load suppliers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function saveSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest<Supplier>(editingId ? `/suppliers/${editingId}` : "/suppliers", {
        method: editingId ? "PATCH" : "POST", body: JSON.stringify(form),
      });
      setForm({ name: "", email: "", phone: "", taxPin: "", address: "", notes: "" });
      setShowForm(false);
      setEditingId(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this supplier.");
    } finally {
      setBusy(false);
    }
  }

  function editSupplier(supplier: Supplier) {
    setForm({
      name: supplier.name, email: supplier.email ?? "", phone: supplier.phone ?? "",
      taxPin: supplier.taxPin ?? "", address: supplier.address ?? "", notes: supplier.notes ?? "",
    });
    setEditingId(supplier.id);
    setShowForm(true);
    setError("");
  }

  async function archiveSupplier(supplier: Supplier) {
    if (!window.confirm(`Archive ${supplier.name}? Existing expenses will retain this supplier reference.`)) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/suppliers/${supplier.id}/archive`, { method: "POST", body: "{}" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not archive this supplier.");
    } finally {
      setBusy(false);
    }
  }

  const visible = suppliers.filter((supplier) => `${supplier.name} ${supplier.email ?? ""} ${supplier.phone ?? ""} ${supplier.taxPin ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHeading eyebrow="BUSINESS PARTNERS" title="Suppliers" description="Keep supplier contact details together and link them to business expenses." action={canWrite && <button className="button button-primary" onClick={() => {
      if (showForm) {
        setShowForm(false);
        setEditingId(null);
      } else {
        setForm({ name: "", email: "", phone: "", taxPin: "", address: "", notes: "" });
        setEditingId(null);
        setShowForm(true);
      }
    }}><Plus size={16} /> {showForm ? "Close form" : "Add supplier"}</button>} />
    <ErrorMessage message={error} />
    {showForm && <form className="panel settings-section" onSubmit={(event) => void saveSupplier(event)}>
      <div className="panel-heading"><div><h2>{editingId ? "Edit supplier" : "New supplier"}</h2><p>Supplier records are private to this business.</p></div><Truck size={18} /></div>
      <div className="form-grid">
        <label className="field"><span>Name *</span><input required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="field"><span>Email</span><input type="email" maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label className="field"><span>Phone</span><input maxLength={40} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <label className="field"><span>Tax PIN</span><input maxLength={24} value={form.taxPin} onChange={(event) => setForm({ ...form, taxPin: event.target.value })} /></label>
        <label className="field"><span>Address</span><input maxLength={500} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
        <label className="field"><span>Notes</span><input maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
      </div>
      <div className="heading-actions"><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : editingId ? "Update supplier" : "Save supplier"}</button><button type="button" className="button button-quiet" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</button></div>
    </form>}
    <div className="panel listing-panel">
      <div className="list-toolbar simple-toolbar"><div><strong>{suppliers.length} suppliers</strong><span> · Contacts for purchasing and tax records.</span></div><input className="module-search" aria-label="Search suppliers" placeholder="Search suppliers" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="icon-button" aria-label="Refresh suppliers" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /></button></div>
      {loading ? <p className="notification-empty">Loading suppliers…</p> : visible.length === 0 ? <div className="empty-state"><div className="empty-icon"><Truck size={22} /></div><h3>{search ? "No matching suppliers" : "No suppliers yet"}</h3><p>{search ? "Try another search." : "Add a supplier to connect purchasing records with expenses."}</p></div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>SUPPLIER</th><th>CONTACT</th><th>TAX PIN</th><th>ADDRESS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {visible.map((supplier) => <tr key={supplier.id}><td><strong>{supplier.name}</strong></td><td>{supplier.email || supplier.phone || "—"}</td><td>{supplier.taxPin || "—"}</td><td>{supplier.address || "—"}</td><td>{canWrite && <div className="record-actions"><button className="button button-quiet" disabled={busy} onClick={() => editSupplier(supplier)}>Edit</button><button className="button button-quiet" disabled={busy} onClick={() => void archiveSupplier(supplier)}>Archive</button></div>}</td></tr>)}
      </tbody></table></div>}
      <div className="table-footer"><span>Showing <strong>{visible.length}</strong> of <strong>{suppliers.length}</strong> suppliers</span></div>
    </div>
  </>;
}

export function ExpensesPage({ currency, canWrite }: { currency: string; canWrite: boolean }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    supplierId: "", expenseDate: new Date().toISOString().slice(0, 10), category: "", description: "",
    reference: "", amount: "", taxRate: "0", currency,
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [expenseRows, supplierRows] = await Promise.all([loadAll<Expense>("/expenses"), loadAll<Supplier>("/suppliers")]);
      setExpenses(expenseRows);
      setSuppliers(supplierRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load expense records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => setForm((current) => ({ ...current, currency })), [currency]);

  async function saveExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const subtotalCents = Math.round(Number(form.amount) * 100);
    const taxRateBps = Math.round(Number(form.taxRate) * 100);
    if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0 || !Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) {
      setError("Enter a valid amount and VAT rate between 0 and 100%.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiRequest<Expense>(editingId ? `/expenses/${editingId}` : "/expenses", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({
          supplierId: form.supplierId || null, expenseDate: form.expenseDate, category: form.category,
          description: form.description, reference: form.reference, subtotalCents, taxRateBps, currency: form.currency,
        }),
      });
      setShowForm(false);
      setEditingId(null);
      setForm((current) => ({ ...current, category: "", description: "", reference: "", amount: "", taxRate: "0", supplierId: "" }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this expense.");
    } finally {
      setBusy(false);
    }
  }

  function editExpense(expense: Expense) {
    setForm({
      supplierId: expense.supplierId ?? "", expenseDate: expense.expenseDate.slice(0, 10),
      category: expense.category, description: expense.description, reference: expense.reference ?? "",
      amount: (expense.subtotalCents / 100).toFixed(2), taxRate: (expense.taxRateBps / 100).toFixed(2),
      currency: expense.currency,
    });
    setEditingId(expense.id);
    setShowForm(true);
    setError("");
  }

  async function voidExpense(expense: Expense) {
    if (!window.confirm(`Void expense "${expense.description}"? It will remain in the audit history but no longer count toward VAT reports.`)) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/expenses/${expense.id}/void`, { method: "POST", body: "{}" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not void this expense.");
    } finally {
      setBusy(false);
    }
  }

  const visible = expenses.filter((expense) => `${expense.supplierName ?? ""} ${expense.category} ${expense.description} ${expense.reference ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const totalByCurrency = (amount: (expense: Expense) => number) => {
    const totals = new Map<string, number>();
    for (const expense of visible) totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + amount(expense));
    if (totals.size === 0) return formatMoney(0, currency);
    return [...totals].map(([code, value]) => formatMoney(value, code)).join(" · ");
  };
  const total = totalByCurrency((expense) => expense.subtotalCents + expense.taxCents);
  const inputVat = totalByCurrency((expense) => expense.taxCents);
  return <>
    <PageHeading eyebrow="MONEY OUT" title="Expenses" description="Record business purchases, supplier, category, date, and recoverable input VAT." action={canWrite && <button className="button button-primary" onClick={() => {
      if (showForm) {
        setShowForm(false);
        setEditingId(null);
      } else {
        setForm({
          supplierId: "", expenseDate: new Date().toISOString().slice(0, 10), category: "", description: "",
          reference: "", amount: "", taxRate: "0", currency,
        });
        setEditingId(null);
        setShowForm(true);
      }
    }}><Plus size={16} /> {showForm ? "Close form" : "Add expense"}</button>} />
    <ErrorMessage message={error} />
    {showForm && <form className="panel settings-section" onSubmit={(event) => void saveExpense(event)}>
      <div className="panel-heading"><div><h2>{editingId ? "Edit expense" : "New expense"}</h2><p>Enter the amount before VAT. VAT is calculated and stored separately.</p></div></div>
      <div className="form-grid">
        <label className="field"><span>Date *</span><input type="date" required value={form.expenseDate} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} /></label>
        <label className="field"><span>Category *</span><input required maxLength={100} placeholder="e.g. Office supplies" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
        <label className="field"><span>Description *</span><input required maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label className="field"><span>Supplier</span><select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })}><option value="">No supplier selected</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label className="field"><span>Amount before VAT *</span><input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
        <label className="field"><span>Input VAT (%)</span><input type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={(event) => setForm({ ...form, taxRate: event.target.value })} /></label>
        <label className="field"><span>Currency</span><select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>{["KES", "USD", "EUR", "GBP", "UGX", "TZS"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>Receipt / reference</span><input maxLength={120} value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></label>
      </div>
      <div className="heading-actions"><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : editingId ? "Update expense" : "Save expense"}</button><button type="button" className="button button-quiet" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</button></div>
    </form>}
    <div className="mini-stats-row"><div className="panel mini-stat"><span>Expense total {search && "in results"}</span><strong>{total}</strong></div><div className="panel mini-stat"><span>Input VAT {search && "in results"}</span><strong>{inputVat}</strong></div><div className="panel mini-stat"><span>Records</span><strong>{visible.length}</strong></div></div>
    <div className="panel listing-panel">
      <div className="list-toolbar simple-toolbar"><div><strong>Expense history</strong><span> · {expenses.length} records.</span></div><input className="module-search" aria-label="Search expenses" placeholder="Search expenses" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="icon-button" aria-label="Refresh expenses" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /></button></div>
      {loading ? <p className="notification-empty">Loading expenses…</p> : visible.length === 0 ? <div className="empty-state"><div className="empty-icon"><Plus size={22} /></div><h3>{search ? "No matching expenses" : "No expenses recorded"}</h3><p>{search ? "Try another search." : "Record purchases to include their input VAT in your tax report."}</p></div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>DATE</th><th>DESCRIPTION</th><th>SUPPLIER</th><th>CATEGORY</th><th>SUBTOTAL</th><th>INPUT VAT</th><th>TOTAL</th>{canWrite && <th>ACTIONS</th>}</tr></thead><tbody>{visible.map((expense) => <tr key={expense.id}><td>{formatDate(expense.expenseDate)}</td><td><strong>{expense.description}</strong><small className="module-subtext">{expense.reference || ""}</small></td><td>{expense.supplierName || "—"}</td><td><span className="category-pill">{expense.category}</span></td><td>{formatMoney(expense.subtotalCents, expense.currency)}</td><td>{formatMoney(expense.taxCents, expense.currency)}</td><td><strong className="amount-cell">{formatMoney(expense.subtotalCents + expense.taxCents, expense.currency)}</strong></td>{canWrite && <td><div className="record-actions"><button className="button button-quiet" disabled={busy} onClick={() => editExpense(expense)}>Edit</button><button className="button button-quiet" disabled={busy} onClick={() => void voidExpense(expense)}>Void</button></div></td>}</tr>)}</tbody></table></div>}
      <div className="table-footer"><span>Showing <strong>{visible.length}</strong> of <strong>{expenses.length}</strong> expenses</span></div>
    </div>
  </>;
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function TaxManagementPage() {
  const today = localDate(new Date());
  const firstDay = localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(today);
  const [summary, setSummary] = useState<TaxSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    setLoading(true);
    try {
      const query = new URLSearchParams({ from, to });
      setSummary(await apiRequest<TaxSummary[]>(`/reports/tax-summary?${query}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the VAT report.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function exportReport() {
    setError("");
    try {
      const query = new URLSearchParams({ from, to });
      await downloadCsv(`/reports/exports/tax-management?${query}`, `tax-management-${from}-to-${to}.csv`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export the VAT report.");
    }
  }

  return <>
    <PageHeading eyebrow="TAX REPORTING" title="Tax management" description="Review VAT collected on issued invoices after proportional credit-note adjustments, input VAT recorded on expenses, and the net position for a selected period." action={<button className="button button-quiet" disabled={loading} onClick={() => void exportReport()}><Download size={15} /> Export period CSV</button>} />
    <ErrorMessage message={error} />
    <div className="panel list-toolbar tax-range"><label className="field"><span>From</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label className="field"><span>To</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label><button className="button button-primary" disabled={loading || !from || !to} onClick={() => void load()}>{loading ? "Loading…" : "Apply period"}</button></div>
    {loading ? <p className="notification-empty">Loading VAT summary…</p> : summary.length === 0 ? <div className="panel empty-state"><h3>No tax activity in this period</h3><p>Issue invoices or record expenses with input VAT to populate this report.</p></div> : <div className="panel listing-panel"><div className="table-scroll"><table className="data-table"><thead><tr><th>CURRENCY</th><th>VAT COLLECTED</th><th>INPUT VAT PAID</th><th>NET VAT POSITION</th><th>INVOICES</th><th>EXPENSES</th></tr></thead><tbody>{summary.map((row) => <tr key={row.currency}><td><strong>{row.currency}</strong></td><td>{formatMoney(row.vatCollectedCents, row.currency)}</td><td>{formatMoney(row.vatPaidCents, row.currency)}</td><td><strong className="amount-cell">{formatMoney(row.netVatCents, row.currency)}</strong></td><td>{row.invoiceCount}</td><td>{row.expenseCount}</td></tr>)}</tbody></table></div><p className="settings-note tax-disclaimer">Input VAT reflects expenses recorded in this workspace. Confirm tax treatment and filing requirements with your tax adviser.</p></div>}
  </>;
}

export function SecurityAuditPage({ email }: { email: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setEntries(await apiRequest<AuditEntry[]>("/audit-logs?limit=100&offset=0"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the audit log.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  return <>
    <PageHeading eyebrow="ACCESS & ACTIVITY" title="Security & audit logs" description="Manage your own multi-factor authentication and review recent activity in this business." />
    <AccountSecurity email={email} />
    <section className="panel listing-panel audit-panel">
      <div className="list-toolbar simple-toolbar"><div><strong>Business audit log</strong><span> · Latest 100 entries.</span></div><button className="button button-quiet" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Refresh</button></div>
      <ErrorMessage message={error} />
      {loading ? <p className="notification-empty">Loading audit log…</p> : entries.length === 0 ? <p className="notification-empty">No activity has been recorded yet.</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>WHEN</th><th>ACTIVITY</th><th>RECORD</th><th>USER</th><th>DETAILS</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td><strong>{entry.action}</strong></td><td>{entry.entityType}</td><td>{entry.actorName || entry.actorEmail || "System"}</td><td className="audit-details">{entry.details ? JSON.stringify(entry.details) : "—"}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}

export function SmartToolsPage({ invoices, payments, currency, onInvoices }: { invoices: Invoice[]; payments: Payment[]; currency: string; onInvoices: () => void }) {
  const insights = useMemo(() => {
    const today = localDate(new Date());
    const endOfWeek = new Date();
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    const weekEnd = localDate(endOfWeek);
    const active = invoices.filter((invoice) => !invoice.isDraft && !invoice.isVoid);
    const unpaid = active.map((invoice) => ({
      invoice,
      balance: Math.max(0, invoice.totalCents - invoice.amountPaidCents - (invoice.creditedCents ?? 0)),
    })).filter((entry) => entry.balance > 0);
    const overdue = unpaid.filter(({ invoice }) => invoice.dueDate < today);
    const dueSoon = unpaid.filter(({ invoice }) => invoice.dueDate >= today && invoice.dueDate <= weekEnd);
    const byCurrency = new Map<string, number>();
    for (const { invoice, balance } of unpaid) byCurrency.set(invoice.currency, (byCurrency.get(invoice.currency) ?? 0) + balance);
    const recentPayments = [...payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
    return { overdue, dueSoon, unpaidByCurrency: [...byCurrency.entries()], recentPayments };
  }, [invoices, payments]);

  return <>
    <PageHeading eyebrow="BUILT-IN BUSINESS INSIGHTS" title="Smart tools" description="Private, rule-based reminders based on this workspace’s invoices and payments. No external AI service is used." />
    <div className="mini-stats-row"><div className="panel mini-stat"><span>Overdue invoices</span><strong>{insights.overdue.length}</strong><small>Need follow-up</small></div><div className="panel mini-stat"><span>Due in 7 days</span><strong>{insights.dueSoon.length}</strong><small>Plan collection reminders</small></div><div className="panel mini-stat"><span>Recent payments</span><strong>{insights.recentPayments.length}</strong><small>Latest recorded transactions</small></div></div>
    <section className="panel smart-insights">
      <div className="panel-heading"><div><h2><Lightbulb size={17} /> Collection follow-up</h2><p>Amounts are grouped by currency; no currency conversion is applied.</p></div></div>
      {insights.overdue.length === 0 && insights.dueSoon.length === 0 ? <p className="notification-empty">No overdue or near-due invoices based on current records.</p> : <>
        {insights.overdue.length > 0 && <div className="smart-insight-block"><strong>Overdue</strong>{insights.overdue.slice(0, 5).map(({ invoice, balance }) => <button key={invoice.id} className="smart-insight-row" onClick={onInvoices}><span>{invoice.number} · {invoice.customerName}<small>Due {formatDate(invoice.dueDate)}</small></span><strong>{formatMoney(balance, invoice.currency)}</strong></button>)}</div>}
        {insights.dueSoon.length > 0 && <div className="smart-insight-block"><strong>Due within 7 days</strong>{insights.dueSoon.slice(0, 5).map(({ invoice, balance }) => <button key={invoice.id} className="smart-insight-row" onClick={onInvoices}><span>{invoice.number} · {invoice.customerName}<small>Due {formatDate(invoice.dueDate)}</small></span><strong>{formatMoney(balance, invoice.currency)}</strong></button>)}</div>}
      </>}
    </section>
    <section className="panel smart-insights"><div className="panel-heading"><div><h2>Outstanding by currency</h2><p>Based on issued invoices after payments and recorded credits.</p></div></div>{insights.unpaidByCurrency.length === 0 ? <p className="notification-empty">No outstanding invoice balances.</p> : insights.unpaidByCurrency.map(([code, amount]) => <div className="smart-total-row" key={code}><span>{code}</span><strong>{formatMoney(amount, code || currency)}</strong></div>)}</section>
  </>;
}

export function IntegrationsPage() {
  const integrations = [
    { name: "M-Pesa", status: "Not connected", detail: "Payment gateway integration is deferred; no credentials are requested or stored." },
    { name: "eTIMS", status: "Not connected", detail: "Tax authority integration is deferred; this screen does not transmit tax data." },
    { name: "External AI", status: "Not connected", detail: "Smart Tools use local business records and do not call an external AI service." },
  ];
  return <>
    <PageHeading eyebrow="CONNECTED SERVICES" title="Integrations" description="Review the status of optional external services. Nothing is connected until a future integration is deliberately configured." />
    <div className="integration-list">{integrations.map((integration) => <section className="panel integration-card" key={integration.name}><div className="integration-icon"><ShieldCheck size={18} /></div><div><h2>{integration.name}</h2><p>{integration.detail}</p></div><span className="integration-status">{integration.status}</span></section>)}</div>
    <p className="settings-note">No external service credentials are collected by this page. You can continue to record payments manually and prepare VAT reports from your workspace records.</p>
  </>;
}
