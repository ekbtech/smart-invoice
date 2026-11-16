import { useEffect, useState } from "react";
import { CalendarClock, Pause, Play, Plus, RefreshCw } from "lucide-react";
import { apiRequest } from "../lib/api";
import type { Customer, Product } from "../types";
import { formatDate, formatMoney } from "../utils";

type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";
type Line = { description: string; quantity: string; unitPrice: string };
type RecurringInvoice = {
  id: string;
  customerId: string;
  customerName: string;
  frequency: Frequency;
  nextRunAt: string;
  endDate: string | null;
  active: boolean;
  template: { totalCents: number; currency: string };
};

const frequencyNames: Record<Frequency, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function localDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export default function RecurringInvoicesPage({
  customers,
  products,
  currency,
  taxRateBps,
}: {
  customers: Customer[];
  products: Product[];
  currency: string;
  taxRateBps: number;
}) {
  const [recurring, setRecurring] = useState<RecurringInvoice[]>([]);
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [nextRunAt, setNextRunAt] = useState(localDate());
  const [endDate, setEndDate] = useState("");
  const [dueInDays, setDueInDays] = useState("14");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", unitPrice: "" }]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadRecurring() {
    setLoading(true);
    setError("");
    try {
      setRecurring(await apiRequest<RecurringInvoice[]>("/recurring-invoices"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load recurring invoices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadRecurring(); }, []);

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  async function createRecurring(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = lines.map((line) => ({
      description: line.description.trim(),
      quantity: Number(line.quantity),
      unitPriceCents: Math.round(Number(line.unitPrice) * 100),
    }));
    if (!customerId || items.some((item) => !item.description || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isSafeInteger(item.unitPriceCents))) {
      setError("Choose a customer and enter valid invoice items.");
      return;
    }
    const runDate = new Date(`${nextRunAt}T00:00:00`);
    runDate.setDate(runDate.getDate() + Number(dueInDays));
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/recurring-invoices", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          frequency,
          nextRunAt,
          endDate: endDate || null,
          invoice: {
            dueDate: localDate(runDate),
            dueInDays: Number(dueInDays),
            currency,
            taxRateBps,
            items,
          },
        }),
      });
      setShowForm(false);
      setLines([{ description: "", quantity: "1", unitPrice: "" }]);
      setNotice("Recurring invoice schedule saved.");
      await loadRecurring();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this schedule.");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(entry: RecurringInvoice, active: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/recurring-invoices/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      setRecurring((current) => current.map((item) => item.id === entry.id ? { ...item, active } : item));
      setNotice(active ? "Recurring invoice schedule resumed." : "Recurring invoice schedule paused.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this schedule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-heading">
        <div><span className="eyebrow">AUTOMATED BILLING</span><h1>Recurring invoices</h1><p>Set up repeat invoice schedules for regular customers.</p></div>
        <div className="heading-actions"><button className="button button-quiet" onClick={() => void loadRecurring()} disabled={loading}><RefreshCw size={15} /> Refresh</button><button className="button button-primary" onClick={() => { setShowForm((open) => !open); setError(""); }}><Plus size={16} /> New schedule</button></div>
      </header>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="security-notice" role="status">{notice}</p>}
      {showForm && <form className="panel recurring-form" onSubmit={(event) => void createRecurring(event)}>
        <div className="panel-heading"><div><h2>New recurring schedule</h2><p>Choose what to invoice and how often. Due invoices are generated automatically while the API is running.</p></div></div>
        {customers.length === 0 ? <p className="inline-error">Add a customer before creating a recurring schedule.</p> : <>
          <div className="form-grid">
            <label className="field"><span>Customer</span><select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label>
            <label className="field"><span>Frequency</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}>{Object.entries(frequencyNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
            <label className="field"><span>First scheduled date</span><input type="date" required value={nextRunAt} onChange={(event) => setNextRunAt(event.target.value)} /></label>
            <label className="field"><span>End date (optional)</span><input type="date" min={nextRunAt} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            <label className="field"><span>Payment terms (days)</span><input type="number" min="0" max="365" value={dueInDays} onChange={(event) => setDueInDays(event.target.value)} /></label>
          </div>
          <div className="recurring-lines">
            <div className="recurring-lines-heading"><strong>Invoice items</strong><span>Currency {currency} · VAT {taxRateBps / 100}%</span></div>
            {lines.map((line, index) => <div className="recurring-line" key={index}>
              <label className="field"><span>Description</span><input required maxLength={500} value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} list={`recurring-products-${index}`} /><datalist id={`recurring-products-${index}`}>{products.map((product) => <option key={product.id} value={product.name} />)}</datalist></label>
              <label className="field"><span>Qty</span><input type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
              <label className="field"><span>Unit price ({currency})</span><input type="number" min="0" step="0.01" required value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value })} /></label>
              <button type="button" className="icon-button danger-icon" aria-label="Remove item" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>×</button>
            </div>)}
            <button type="button" className="text-button" onClick={() => setLines((current) => [...current, { description: "", quantity: "1", unitPrice: "" }])}><Plus size={14} /> Add another item</button>
          </div>
        </>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setShowForm(false)}>Cancel</button><button className="button button-primary" disabled={busy || customers.length === 0}>{busy ? "Saving…" : "Save schedule"}</button></div>
      </form>}
      <section className="panel recurring-list">
        <div className="panel-heading"><div><h2>Your schedules</h2><p>Due invoices are generated automatically by the API worker. Invoice email delivery is not configured.</p></div></div>
        {loading ? <p className="muted-empty">Loading schedules…</p> : recurring.length === 0 ? <p className="muted-empty">No recurring schedules yet.</p> : <div className="recurring-table">
          {recurring.map((entry) => <article className="recurring-row" key={entry.id}>
            <div className="recurring-icon"><CalendarClock size={17} /></div>
            <div className="recurring-primary"><strong>{entry.customerName}</strong><span>{frequencyNames[entry.frequency]} · {formatMoney(Number(entry.template.totalCents), entry.template.currency ?? currency)}</span></div>
            <div className="recurring-date"><small>Next scheduled</small><strong>{formatDate(String(entry.nextRunAt).slice(0, 10))}</strong></div>
            <span className={`recurring-status ${entry.active ? "recurring-active" : "recurring-paused"}`}>{entry.active ? "Active" : "Paused"}</span>
            <button className="button button-quiet recurring-toggle" disabled={busy} onClick={() => void setActive(entry, !entry.active)}>{entry.active ? <Pause size={14} /> : <Play size={14} />}{entry.active ? "Pause" : "Resume"}</button>
          </article>)}
        </div>}
      </section>
    </>
  );
}
