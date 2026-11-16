import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Customer, Invoice, InvoiceItem, Product } from "../types";
import { formatMoney, makeId } from "../utils";
import { apiRequest } from "../lib/api";
import Modal from "./Modal";

type Props = {
  customers: Customer[];
  products: Product[];
  currency: string;
  taxRateBps: number;
  invoiceNumber: string;
  serverMode: boolean;
  onClose: () => void;
  onSave: (invoice: Invoice) => void;
};

function blankItem(): InvoiceItem {
  return { id: makeId("item"), description: "", quantity: 1, unitPriceCents: 0 };
}

type InvoiceTemplate = { id: string; name: string; isDefault: boolean };

export default function InvoiceDialog({ customers, products, currency, taxRateBps, invoiceNumber, serverMode, onClose, onSave }: Props) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return date.toISOString().slice(0, 10);
  });
  const [items, setItems] = useState<InvoiceItem[]>([blankItem()]);
  const [notes, setNotes] = useState("");
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [error, setError] = useState("");
  const customer = customers.find((entry) => entry.id === customerId);
  const hasInvalidItem = items.some((item) => !item.description.trim() || item.quantity <= 0 || item.unitPriceCents < 0);
  const subtotalCents = useMemo(() => items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPriceCents), 0), [items]);
  const taxCents = Math.round((subtotalCents * taxRateBps) / 10000);
  const totalCents = subtotalCents + taxCents;

  useEffect(() => {
    if (!serverMode) return;
    let active = true;
    apiRequest<InvoiceTemplate[]>("/invoice-templates").then((loaded) => {
      if (!active) return;
      setTemplates(loaded);
      setTemplateId(loaded.find((template) => template.isDefault)?.id ?? "");
    }).catch((cause: unknown) => {
      if (active) setTemplateError(cause instanceof Error ? cause.message : "Could not load invoice templates.");
    });
    return () => { active = false; };
  }, [serverMode]);

  function updateItem(id: string, updates: Partial<InvoiceItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...updates } : item));
  }

  function selectProduct(id: string, itemId: string) {
    const product = products.find((entry) => entry.id === id);
    if (product) updateItem(itemId, { description: product.name, unitPriceCents: product.priceCents });
  }

  function save(isDraft: boolean) {
    if (!customer) {
      setError("Choose a customer before saving this invoice.");
      return;
    }
    if (hasInvalidItem) {
      setError("Enter a description, a positive quantity and a non-negative unit price for every item.");
      return;
    }
    const subtotal = items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPriceCents), 0);
    const tax = Math.round((subtotal * taxRateBps) / 10000);
    if (!isDraft && subtotal + tax <= 0) {
      setError("An issued invoice must have a total greater than zero.");
      return;
    }
    onSave({
      id: makeId("invoice"),
      number: invoiceNumber,
      customerId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate,
      items,
      subtotalCents: subtotal,
      taxRateBps,
      taxCents: tax,
      totalCents: subtotal + tax,
      amountPaidCents: 0,
      currency,
      notes,
      templateId: templateId || null,
      isDraft,
    });
  }

  return (
    <Modal title="Create invoice" subtitle="Add a customer and the items you’re billing for." onClose={onClose} wide>
      <div className="form-grid invoice-meta">
        <label className="field"><span>Customer</span>
          <select autoFocus value={customerId} onChange={(event) => setCustomerId(event.target.value)} required>
            {customers.length === 0 && <option value="">Add a customer first</option>}
            {customers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.company}</option>)}
          </select>
        </label>
        <label className="field"><span>Invoice number</span><input value={invoiceNumber} readOnly /></label>
        <label className="field"><span>Issue date</span><input value={new Date().toISOString().slice(0, 10)} readOnly /></label>
        <label className="field"><span>Due date</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></label>
        {serverMode && <label className="field"><span>Invoice design</span><select value={templateId} onChange={(event) => setTemplateId(event.target.value)}><option value="">Business default</option>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}{template.isDefault ? " · Default" : ""}</option>)}</select></label>}
      </div>
      {templateError && <p className="inline-error" role="alert">{templateError}</p>}
      <div className="line-items-heading"><div><h3>Items</h3><span>{taxRateBps / 100}% VAT included in calculation</span></div></div>
      <div className="invoice-item-list">
        {items.map((item) => (
          <div className="invoice-item-row" key={item.id}>
            <label className="field item-description"><span>Description</span>
              <input list="product-options" value={item.description} onChange={(event) => updateItem(item.id, { description: event.target.value })} placeholder="What are you billing for?" required />
            </label>
            <datalist id="product-options">{products.map((product) => <option key={product.id} value={product.name} />)}</datalist>
            <label className="field item-quantity"><span>Qty</span><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })} required /></label>
            <label className="field item-price"><span>Unit price ({currency})</span><input type="number" min="0" step="0.01" value={(item.unitPriceCents / 100).toFixed(2)} onChange={(event) => updateItem(item.id, { unitPriceCents: Math.round(Number(event.target.value) * 100) })} required /></label>
            <label className="field item-total"><span>Amount</span><output>{formatMoney(Math.round(item.quantity * item.unitPriceCents), currency)}</output></label>
            <div className="item-actions">
              {products.length > 0 && <select className="product-picker" aria-label="Choose from products" value="" onChange={(event) => selectProduct(event.target.value, item.id)}><option value="">Catalog</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>}
              <button type="button" className="icon-button danger-icon" aria-label="Remove item" onClick={() => setItems((current) => current.length > 1 ? current.filter((entry) => entry.id !== item.id) : current)}><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>
      <button className="text-button add-line" type="button" onClick={() => setItems((current) => [...current, blankItem()])}><Plus size={16} /> Add line item</button>
      <div className="invoice-bottom">
        <label className="field notes-field"><span>Notes</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add a note or payment instructions…" /></label>
        <div className="totals-box">
          <div><span>Subtotal</span><strong>{formatMoney(subtotalCents, currency)}</strong></div>
          <div><span>VAT ({taxRateBps / 100}%)</span><strong>{formatMoney(taxCents, currency)}</strong></div>
          <div className="grand-total"><span>Total</span><strong>{formatMoney(totalCents, currency)}</strong></div>
        </div>
      </div>
      {customers.length === 0 && <p className="inline-error">Add a customer before creating an invoice.</p>}
      {hasInvalidItem && <p className="form-hint">Fill in each item description and enter a positive quantity and non-negative price.</p>}
      {subtotalCents + taxCents <= 0 && !hasInvalidItem && <p className="form-hint">An issued invoice needs a total greater than zero.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="button button-quiet" onClick={onClose}>Cancel</button>
        <button className="button button-secondary" disabled={!customer || hasInvalidItem} onClick={() => save(true)}>Save as draft</button>
        <button className="button button-primary" disabled={!customer || hasInvalidItem || subtotalCents + taxCents <= 0} onClick={() => save(false)}>Issue invoice</button>
      </div>
    </Modal>
  );
}
