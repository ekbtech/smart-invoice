import { useEffect, useState } from "react";
import { FileMinus2, Plus } from "lucide-react";
import { apiRequest } from "../lib/api";
import type { Invoice } from "../types";
import { formatDate, formatMoney } from "../utils";

type NoteKind = "credit" | "debit";
type AdjustmentNote = {
  id: string;
  kind: NoteKind;
  noteNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  currency: string;
  customerName: string;
  reason: string;
  amountCents: number;
  status: string;
  createdAt: string;
};

export default function AdjustmentNotesPage({
  invoices,
  currency,
  canWrite,
  onChanged,
}: {
  invoices: Invoice[];
  currency: string;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const [notes, setNotes] = useState<AdjustmentNote[]>([]);
  const [kind, setKind] = useState<NoteKind>("credit");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const eligibleInvoices = invoices.filter((invoice) => !invoice.isDraft && !invoice.isVoid);

  async function loadNotes() {
    setLoading(true);
    setError("");
    try {
      setNotes(await apiRequest<AdjustmentNote[]>("/adjustment-notes?limit=100&offset=0"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load adjustment notes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!invoiceId && eligibleInvoices[0]) setInvoiceId(eligibleInvoices[0].id);
  }, [eligibleInvoices, invoiceId]);

  useEffect(() => { void loadNotes(); }, []);

  async function createNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || reason.trim().length < 3) {
      setError("Enter a positive amount and a reason of at least three characters.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const created = await apiRequest<{ noteNumber: string }>(`/${kind}-notes`, {
        method: "POST",
        body: JSON.stringify({ invoiceId, amountCents, reason: reason.trim() }),
      });
      setAmount("");
      setReason("");
      setShowForm(false);
      setNotice(`${created.noteNumber} issued.`);
      await loadNotes();
      try {
        await onChanged();
      } catch (cause) {
        setError(cause instanceof Error ? `The note was issued, but invoice data could not be refreshed: ${cause.message}` : "The note was issued, but invoice data could not be refreshed.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not issue this ${kind} note.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-heading">
        <div><span className="eyebrow">INVOICE ADJUSTMENTS</span><h1>Credit & debit notes</h1><p>Record formal corrections against issued invoices.</p></div>
        <div className="heading-actions"><button className="button button-quiet" onClick={() => void loadNotes()} disabled={loading}>Refresh</button>{canWrite && <button className="button button-primary" onClick={() => { setShowForm((open) => !open); setError(""); }} disabled={eligibleInvoices.length === 0}><Plus size={16} /> New adjustment</button>}</div>
      </header>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="security-notice" role="status">{notice}</p>}
      {showForm && canWrite && <form className="panel adjustment-form" onSubmit={(event) => void createNote(event)}>
        <div className="panel-heading"><div><h2>Issue an adjustment note</h2><p>Issued notes are recorded in the business audit trail.</p></div></div>
        {eligibleInvoices.length === 0 ? <p className="muted-empty">There are no issued invoices to adjust.</p> : <>
          <div className="form-grid">
            <label className="field"><span>Note type</span><select value={kind} onChange={(event) => setKind(event.target.value as NoteKind)}><option value="credit">Credit note</option><option value="debit">Debit note</option></select></label>
            <label className="field"><span>Issued invoice</span><select value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}>{eligibleInvoices.map((invoice) => <option value={invoice.id} key={invoice.id}>{invoice.number} · {invoice.customerName}</option>)}</select></label>
            <label className="field"><span>Amount ({currency})</span><input type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
            <label className="field"><span>Reason</span><input required minLength={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe the adjustment" /></label>
          </div>
          <p className="settings-note"><FileMinus2 size={14} /> Credit notes reduce the balance due; debit notes add a charge to the invoice.</p>
        </>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setShowForm(false)}>Cancel</button><button className="button button-primary" disabled={busy || !invoiceId || !amount || reason.trim().length < 3}>{busy ? "Issuing…" : "Issue note"}</button></div>
      </form>}
      <section className="panel adjustment-list">
        <div className="panel-heading"><div><h2>Issued notes</h2><p>All credit and debit notes for this business.</p></div></div>
        {loading ? <p className="muted-empty">Loading adjustment notes…</p> : notes.length === 0 ? <p className="muted-empty">No adjustment notes have been issued.</p> : <div className="adjustment-table">
          {notes.map((note) => <article className="adjustment-row" key={`${note.kind}-${note.id}`}>
            <span className={`adjustment-icon adjustment-${note.kind}`}><FileMinus2 size={16} /></span>
            <div className="adjustment-primary"><strong>{note.noteNumber}</strong><small>{note.invoiceNumber} · {note.customerName}</small><small>{note.reason}</small></div>
            <div className="adjustment-date"><small>{formatDate(String(note.createdAt).slice(0, 10))}</small><span className={`adjustment-kind adjustment-kind-${note.kind}`}>{note.kind}</span></div>
            <strong className="adjustment-amount">{note.kind === "credit" ? "−" : "+"}{formatMoney(Number(note.amountCents), note.currency || currency)}</strong>
          </article>)}
        </div>}
      </section>
    </>
  );
}
