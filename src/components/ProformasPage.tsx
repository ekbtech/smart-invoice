import { useEffect, useState } from "react";
import { FilePlus2, Plus, RefreshCw } from "lucide-react";
import { apiRequest } from "../lib/api";
import type { Customer, InvoiceItem, Product } from "../types";
import { formatDate, formatMoney, makeId } from "../utils";

type Proforma = {
  id: string;
  proformaNumber: string;
  status: "issued" | "converted" | "void";
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  issueDate: string;
  expiryDate: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
  notes: string;
  convertedInvoiceId: string | null;
  items: InvoiceItem[];
};

function localDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export default function ProformasPage({
  customers,
  products,
  currency,
  taxRateBps,
  canWrite,
  onChanged,
}: {
  customers: Customer[];
  products: Product[];
  currency: string;
  taxRateBps: number;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const [proformas, setProformas] = useState<Proforma[]>([]);
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [expiryDate, setExpiryDate] = useState(() => localDate(new Date(Date.now() + 30 * 86_400_000)));
  const [items, setItems] = useState([{ id: makeId("proforma-item"), description: "", quantity: "1", unitPrice: "" }]);
  const [notes, setNotes] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadProformas() {
    setLoading(true);
    setError("");
    try {
      setProformas(await apiRequest<Proforma[]>("/proformas?limit=100&offset=0"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load proforma invoices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadProformas(); }, []);

  const currentCustomer = customers.find((customer) => customer.id === customerId);
  const itemTotals = items.map((item) => Math.round(Number(item.quantity) * Math.round(Number(item.unitPrice) * 100)));
  const subtotalCents = itemTotals.reduce((sum, total) => sum + total, 0);
  const taxCents = Math.round(subtotalCents * taxRateBps / 10_000);
  const invalidItems = items.some((item) =>
    !item.description.trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 ||
    !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0);

  async function createProforma(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentCustomer || invalidItems || subtotalCents + taxCents <= 0) {
      setError("Choose a customer and enter valid items with a total greater than zero.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const created = await apiRequest<{ proformaNumber: string }>("/proformas", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          issueDate: localDate(),
          expiryDate,
          currency,
          taxRateBps,
          notes,
          items: items.map((item) => ({
            description: item.description.trim(),
            quantity: Number(item.quantity),
            unitPriceCents: Math.round(Number(item.unitPrice) * 100),
          })),
        }),
      });
      setShowForm(false);
      setNotes("");
      setItems([{ id: makeId("proforma-item"), description: "", quantity: "1", unitPrice: "" }]);
      setNotice(`${created.proformaNumber} issued.`);
      await loadProformas();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not issue this proforma.");
    } finally {
      setBusy(false);
    }
  }

  async function convert(proforma: Proforma) {
    if (!window.confirm(`Convert ${proforma.proformaNumber} into an invoice draft?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const invoice = await apiRequest<{ invoiceNumber: string }>(`/proformas/${proforma.id}/convert`, { method: "POST", body: "{}" });
      setNotice(`${proforma.proformaNumber} converted to invoice draft ${invoice.invoiceNumber}.`);
      await Promise.all([loadProformas(), onChanged()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not convert this proforma.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-heading">
        <div><span className="eyebrow">PRELIMINARY INVOICES</span><h1>Proforma invoices</h1><p>Issue a preliminary invoice and convert it to an invoice draft when approved.</p></div>
        <div className="heading-actions"><button className="button button-quiet" onClick={() => void loadProformas()} disabled={loading}><RefreshCw size={15} /> Refresh</button>{canWrite && <button className="button button-primary" onClick={() => { setShowForm((open) => !open); setError(""); }} disabled={customers.length === 0}><Plus size={16} /> New proforma</button>}</div>
      </header>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="security-notice" role="status">{notice}</p>}
      {showForm && canWrite && <form className="panel proforma-form" onSubmit={(event) => void createProforma(event)}>
        <div className="panel-heading"><div><h2>Issue a proforma invoice</h2><p>A proforma is not a tax invoice and does not record payment.</p></div></div>
        <div className="form-grid">
          <label className="field"><span>Customer</span><select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label>
          <label className="field"><span>Valid until</span><input type="date" min={localDate()} required value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label>
          <label className="field"><span>Notes</span><input maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional terms or instructions" /></label>
        </div>
        <div className="proforma-lines">
          <div className="recurring-lines-heading"><strong>Items</strong><span>Currency {currency} · VAT {taxRateBps / 100}%</span></div>
          {items.map((item, index) => <div className="recurring-line proforma-line" key={item.id}>
            <label className="field"><span>Description</span><input required maxLength={500} list="proforma-products" value={item.description} onChange={(event) => setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, description: event.target.value } : entry))} /></label>
            <label className="field"><span>Qty</span><input type="number" min="0.001" step="0.001" required value={item.quantity} onChange={(event) => setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: event.target.value } : entry))} /></label>
            <label className="field"><span>Unit price</span><input type="number" min="0" step="0.01" required value={item.unitPrice} onChange={(event) => setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, unitPrice: event.target.value } : entry))} /></label>
            <button type="button" className="icon-button danger-icon" aria-label="Remove item" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>×</button>
          </div>)}
          <datalist id="proforma-products">{products.map((product) => <option key={product.id} value={product.name} />)}</datalist>
          <button type="button" className="text-button" onClick={() => setItems((current) => [...current, { id: makeId("proforma-item"), description: "", quantity: "1", unitPrice: "" }])}><Plus size={14} /> Add item</button>
        </div>
        <div className="proforma-total"><span>Estimated total including VAT</span><strong>{formatMoney(subtotalCents + taxCents, currency)}</strong></div>
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setShowForm(false)}>Cancel</button><button className="button button-primary" disabled={busy || !currentCustomer || invalidItems || subtotalCents + taxCents <= 0}>{busy ? "Issuing…" : "Issue proforma"}</button></div>
      </form>}
      <section className="panel proforma-list">
        <div className="panel-heading"><div><h2>Proforma history</h2><p>Each converted proforma creates a separate invoice draft with fresh numbering.</p></div></div>
        {loading ? <p className="muted-empty">Loading proformas…</p> : proformas.length === 0 ? <p className="muted-empty">No proforma invoices yet.</p> : <div className="adjustment-table">
          {proformas.map((proforma) => <article className="proforma-row" key={proforma.id}>
            <span className="recurring-icon"><FilePlus2 size={16} /></span>
            <div className="adjustment-primary"><strong>{proforma.proformaNumber}</strong><small>{proforma.customerName} · expires {formatDate(String(proforma.expiryDate).slice(0, 10))}</small><small>{proforma.status === "converted" ? "Converted to invoice" : proforma.status}</small></div>
            <strong className="adjustment-amount">{formatMoney(Number(proforma.totalCents), proforma.currency || currency)}</strong>
            {proforma.status === "issued" && canWrite && <button className="button button-secondary proforma-convert" disabled={busy || String(proforma.expiryDate).slice(0, 10) < localDate()} onClick={() => void convert(proforma)}>{busy ? "Working…" : "Convert to draft"}</button>}
          </article>)}
        </div>}
      </section>
    </>
  );
}
