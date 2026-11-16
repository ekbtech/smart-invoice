import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Customer, InvoiceItem, Product, Quotation } from "../types";
import { formatMoney, makeId } from "../utils";
import Modal from "./Modal";

type Props = {
  customers: Customer[];
  products: Product[];
  currency: string;
  taxRateBps: number;
  onClose: () => void;
  onSave: (quotation: Quotation) => Promise<void>;
};

function blankItem(): InvoiceItem {
  return { id: makeId("quote-item"), description: "", quantity: 1, unitPriceCents: 0 };
}

export default function QuotationDialog({ customers, products, currency, taxRateBps, onClose, onSave }: Props) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [expiryDate, setExpiryDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 10);
  });
  const [items, setItems] = useState<InvoiceItem[]>([blankItem()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const customer = customers.find((entry) => entry.id === customerId);
  const subtotalCents = useMemo(() => items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPriceCents), 0), [items]);
  const taxCents = Math.round(subtotalCents * taxRateBps / 10000);

  function updateItem(id: string, updates: Partial<InvoiceItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...updates } : item));
  }

  async function save() {
    if (!customer || items.some((item) => !item.description.trim() || item.quantity <= 0) || subtotalCents + taxCents <= 0) return;
    setBusy(true);
    setError("");
    try {
      await onSave({
        id: makeId("quotation"),
        number: "",
        customerId: customer.id,
        customerName: customer.name,
        currency,
        issueDate: new Date().toISOString().slice(0, 10),
        expiryDate,
        status: "draft",
        subtotalCents,
        discountCents: 0,
        taxCents,
        totalCents: subtotalCents + taxCents,
        items,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this quotation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Create quotation" subtitle="Prepare an estimate before issuing an invoice." onClose={onClose} wide>
      <div className="form-grid invoice-meta">
        <label className="field"><span>Customer</span><select autoFocus value={customerId} onChange={(event) => setCustomerId(event.target.value)}>{customers.length === 0 && <option value="">Add a customer first</option>}{customers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.company}</option>)}</select></label>
        <label className="field"><span>Expiry date</span><input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label>
      </div>
      <div className="line-items-heading"><div><h3>Estimate items</h3><span>{taxRateBps / 100}% VAT</span></div></div>
      <div className="invoice-item-list">
        {items.map((item) => <div className="invoice-item-row quote-item-row" key={item.id}>
          <label className="field item-description"><span>Description</span><input value={item.description} onChange={(event) => updateItem(item.id, { description: event.target.value })} placeholder="What are you quoting for?" /></label>
          <label className="field item-quantity"><span>Qty</span><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })} /></label>
          <label className="field item-price"><span>Unit price ({currency})</span><input type="number" min="0" step="0.01" value={(item.unitPriceCents / 100).toFixed(2)} onChange={(event) => updateItem(item.id, { unitPriceCents: Math.round(Number(event.target.value) * 100) })} /></label>
          <label className="field item-total"><span>Amount</span><output>{formatMoney(Math.round(item.quantity * item.unitPriceCents), currency)}</output></label>
          <div className="item-actions"><select className="product-picker" aria-label="Choose from products" value="" onChange={(event) => {
            const product = products.find((entry) => entry.id === event.target.value);
            if (product) updateItem(item.id, { description: product.name, unitPriceCents: product.priceCents });
          }}><option value="">Catalog</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><button className="icon-button danger-icon" aria-label="Remove item" onClick={() => setItems((current) => current.length > 1 ? current.filter((entry) => entry.id !== item.id) : current)}><Trash2 size={16} /></button></div>
        </div>)}
      </div>
      <button className="text-button add-line" onClick={() => setItems((current) => [...current, blankItem()])}><Plus size={16} /> Add line item</button>
      <div className="invoice-bottom"><p className="quote-validity">This quotation is valid until {new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${expiryDate}T00:00:00`))}.</p><div className="totals-box"><div><span>Subtotal</span><strong>{formatMoney(subtotalCents, currency)}</strong></div><div><span>VAT ({taxRateBps / 100}%)</span><strong>{formatMoney(taxCents, currency)}</strong></div><div className="grand-total"><span>Estimated total</span><strong>{formatMoney(subtotalCents + taxCents, currency)}</strong></div></div></div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {customers.length === 0 && <p className="inline-error">Add a customer before creating a quotation.</p>}
      <div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy || !customer || subtotalCents + taxCents <= 0 || items.some((item) => !item.description.trim() || item.quantity <= 0)} onClick={() => void save()}>{busy ? "Saving…" : "Save quotation"}</button></div>
    </Modal>
  );
}
