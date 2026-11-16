import { useState } from "react";
import type { DeliveryNoteInput, Invoice } from "../types";
import Modal from "./Modal";

type Props = {
  invoice: Invoice;
  onClose: () => void;
  onSave: (input: DeliveryNoteInput) => Promise<void>;
};

export default function DeliveryNoteDialog({ invoice, onClose, onSave }: Props) {
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [recipientName, setRecipientName] = useState(invoice.customerName);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveredBy, setDeliveredBy] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState(() => invoice.items.map((item) => item.quantity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!recipientName.trim()) {
      setError("Enter who will receive this delivery.");
      return;
    }
    if (!quantities.some((quantity) => quantity > 0)) {
      setError("Enter at least one delivered quantity greater than zero.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await onSave({
        deliveryDate,
        recipientName: recipientName.trim(),
        deliveryAddress: deliveryAddress.trim(),
        deliveredBy: deliveredBy.trim(),
        notes: notes.trim(),
        items: invoice.items.map((item, index) => ({ invoiceItemId: item.id, quantity: quantities[index] })),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the delivery note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Create delivery note" subtitle={`For invoice ${invoice.number}. Record the quantities being delivered.`} onClose={onClose} wide>
      <div className="form-grid invoice-meta">
        <label className="field"><span>Delivery date</span><input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} required /></label>
        <label className="field"><span>Recipient</span><input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} maxLength={160} required /></label>
        <label className="field"><span>Delivered by</span><input value={deliveredBy} onChange={(event) => setDeliveredBy(event.target.value)} maxLength={160} /></label>
        <label className="field"><span>Delivery address</span><input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} maxLength={500} /></label>
      </div>
      <div className="line-items-heading"><div><h3>Items being delivered</h3><span>Delivered quantities cannot exceed the invoice.</span></div></div>
      <div className="delivery-note-items">
        {invoice.items.map((item, index) => (
          <label className="delivery-note-item" key={item.id}>
            <span><strong>{item.description}</strong><small>Invoiced quantity: {item.quantity}</small></span>
            <span className="field"><span>Qty delivered</span><input type="number" min="0" max={item.quantity} step="0.001" value={quantities[index]} onChange={(event) => setQuantities((current) => current.map((quantity, itemIndex) => itemIndex === index ? Number(event.target.value) : quantity))} /></span>
          </label>
        ))}
      </div>
      <label className="field delivery-note-notes"><span>Delivery notes</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="Optional notes about this delivery…" /></label>
      <p className="settings-note">The generated PDF includes recipient signature and date fields for proof of delivery.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="button button-quiet" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button button-primary" onClick={() => void save()} disabled={busy || !deliveryDate}>{busy ? "Creating…" : "Create and download delivery note"}</button>
      </div>
    </Modal>
  );
}
