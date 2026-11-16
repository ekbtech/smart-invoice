import { useMemo, useState } from "react";
import type { Invoice, Payment } from "../types";
import { formatMoney, makeId } from "../utils";
import Modal from "./Modal";

type Props = {
  invoices: Invoice[];
  currency: string;
  onClose: () => void;
  onSave: (payment: Payment) => void;
};

export default function PaymentDialog({ invoices, currency, onClose, onSave }: Props) {
  const eligibleInvoices = invoices.filter((invoice) => !invoice.isDraft && !invoice.isVoid && invoice.amountPaidCents + (invoice.creditedCents ?? 0) < invoice.totalCents);
  const [invoiceId, setInvoiceId] = useState(eligibleInvoices[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("M-Pesa");
  const [reference, setReference] = useState("");
  const invoice = eligibleInvoices.find((entry) => entry.id === invoiceId);
  const remaining = invoice ? invoice.totalCents - invoice.amountPaidCents - (invoice.creditedCents ?? 0) : 0;
  const amountCents = useMemo(() => Math.round(Number(amount) * 100), [amount]);

  function save() {
    if (!invoice || !Number.isFinite(amountCents) || amountCents <= 0 || amountCents > remaining) return;
    onSave({
      id: makeId("payment"),
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      customerName: invoice.customerName,
      amountCents,
      currency: invoice.currency,
      method,
      date: new Date().toISOString().slice(0, 10),
      reference: reference.trim() || "—",
    });
  }

  return (
    <Modal title="Record a payment" subtitle="Apply a payment to an outstanding invoice." onClose={onClose}>
      {eligibleInvoices.length === 0 ? <div className="empty-state"><p>There are no outstanding invoices to pay.</p></div> : <>
        <div className="form-stack">
          <label className="field"><span>Invoice</span>
            <select autoFocus value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}>
              {eligibleInvoices.map((entry) => <option key={entry.id} value={entry.id}>{entry.number} · {entry.customerName}</option>)}
            </select>
          </label>
          {invoice && <div className="payment-balance"><span>Remaining balance</span><strong>{formatMoney(remaining, invoice.currency)}</strong></div>}
          <label className="field"><span>Amount ({invoice?.currency ?? currency})</span><input type="number" min="0.01" step="0.01" max={(remaining / 100).toFixed(2)} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label>
          <label className="field"><span>Payment method</span><select value={method} onChange={(event) => setMethod(event.target.value)}><option>M-Pesa</option><option>Bank transfer</option><option>Cash</option><option>Card</option><option>Other</option></select></label>
          <label className="field"><span>Reference (optional)</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="e.g. M-Pesa transaction code" /></label>
        </div>
        {amountCents > remaining && <p className="inline-error">The payment cannot exceed the remaining invoice balance.</p>}
        <div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!invoice || !Number.isFinite(amountCents) || amountCents <= 0 || amountCents > remaining} onClick={save}>Save payment</button></div>
      </>}
    </Modal>
  );
}
