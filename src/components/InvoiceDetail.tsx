import { Download, Printer, ReceiptText, Truck } from "lucide-react";
import type { AppSettings, Invoice, Payment } from "../types";
import { formatDate, formatMoney, getInvoiceStatus } from "../utils";
import Modal from "./Modal";

type Props = {
  invoice: Invoice;
  settings: AppSettings;
  payments: Payment[];
  serverMode: boolean;
  canWriteInvoices: boolean;
  onClose: () => void;
  onRecordPayment: () => void;
  onIssue: () => void;
  onVoid: () => void;
  onCreateDeliveryNote: () => void;
  onDownloadDeliveryNote: () => void;
  onDownloadInvoice: () => void;
  onDownloadReceipt: (payment: Payment) => void;
};

export default function InvoiceDetail({
  invoice, settings, payments, serverMode, canWriteInvoices, onClose, onRecordPayment, onIssue, onVoid, onDownloadInvoice, onDownloadReceipt,
  onCreateDeliveryNote, onDownloadDeliveryNote,
}: Props) {
  const status = getInvoiceStatus(invoice);
  const invoicePayments = payments.filter((payment) => payment.invoiceId === invoice.id);
  const creditedCents = invoice.creditedCents ?? 0;
  const balanceDueCents = Math.max(0, invoice.totalCents - invoice.amountPaidCents - creditedCents);
  const accent = invoice.templateConfig?.primaryColor ?? "#6385ff";
  const footerNote = invoice.templateConfig?.footerNote || "Thank you for your business.";
  return (
    <Modal title={invoice.number} subtitle="Invoice details and payment history" onClose={onClose} wide>
      <article className="printable-invoice">
        {!settings.letterheadUrl && <header className="print-invoice-header">
          <div><span className="print-brand-mark" style={{ backgroundColor: accent }}>S</span><div><h3>{settings.businessName}</h3><p>{settings.address}<br />{settings.email} · {settings.phone}</p></div></div>
          <div className="print-invoice-title"><span style={{ color: accent }}>INVOICE{invoice.templateName ? ` · ${invoice.templateName}` : ""}</span><strong>{invoice.number}</strong></div>
        </header>}
        {serverMode && settings.letterheadUrl && <p className="settings-note">Your uploaded letterhead is applied to the downloaded invoice PDF.</p>}
        <div className="print-invoice-meta">
          <div><span>Bill to</span><strong>{invoice.customerName}</strong><p>{invoice.customerEmail}</p></div>
          <div><span>Issue date</span><strong>{formatDate(invoice.issueDate)}</strong><span>Due date</span><strong>{formatDate(invoice.dueDate)}</strong></div>
        </div>
        <div className="print-table">
          <div className="print-table-head"><span>Description</span><span>Qty</span><span>Unit price</span><span>Amount</span></div>
          {invoice.items.map((item) => <div className="print-table-row" key={item.id}><span>{item.description}</span><span>{item.quantity}</span><span>{formatMoney(item.unitPriceCents, invoice.currency)}</span><strong>{formatMoney(Math.round(item.quantity * item.unitPriceCents), invoice.currency)}</strong></div>)}
        </div>
        <div className="print-summary">
          <div><span>Subtotal</span><strong>{formatMoney(invoice.subtotalCents, invoice.currency)}</strong></div>
          <div><span>VAT ({invoice.taxRateBps / 100}%)</span><strong>{formatMoney(invoice.taxCents, invoice.currency)}</strong></div>
          <div className="print-grand-total" style={{ borderColor: accent }}><span style={{ color: accent }}>Total</span><strong>{formatMoney(invoice.totalCents, invoice.currency)}</strong></div>
          <div><span>Paid</span><strong>{formatMoney(invoice.amountPaidCents, invoice.currency)}</strong></div>
          {creditedCents > 0 && <div><span>Credit notes</span><strong>{formatMoney(creditedCents, invoice.currency)}</strong></div>}
          <div><span>Balance due</span><strong>{formatMoney(balanceDueCents, invoice.currency)}</strong></div>
        </div>
        {invoice.notes && <p className="print-notes"><strong>Note:</strong> {invoice.notes}</p>}
        <div className="invoice-status-line"><span className={`status-pill status-${status.toLowerCase()}`}>{status}</span>{invoicePayments.length > 0 && <span>{invoicePayments.length} payment{invoicePayments.length === 1 ? "" : "s"} recorded</span>}</div>
        {invoicePayments.length > 0 && <section className="invoice-payment-history" aria-label="Invoice payment receipts">
          <strong>Payment receipts</strong>
          {invoicePayments.map((payment) => <div className="invoice-payment-receipt" key={payment.id}>
            <span>{formatDate(payment.date)} · {formatMoney(payment.amountCents, payment.currency)}</span>
            {serverMode && <button className="button button-quiet" onClick={() => onDownloadReceipt(payment)}>Download receipt</button>}
          </div>)}
        </section>}
        <p className="print-thanks">{footerNote}</p>
      </article>
      <div className="modal-actions">
        {invoice.isDraft && <button className="button button-secondary" onClick={onIssue}>Issue invoice</button>}
        {!invoice.isDraft && !invoice.isVoid && invoice.amountPaidCents === 0 && <button className="button button-danger-outline" onClick={onVoid}>Void invoice</button>}
        {!invoice.isDraft && !invoice.isVoid && balanceDueCents > 0 && <button className="button button-secondary" onClick={onRecordPayment}><ReceiptText size={16} /> Record payment</button>}
        {serverMode && canWriteInvoices && !invoice.isDraft && !invoice.isVoid && !invoice.deliveryNoteId && <button className="button button-secondary" onClick={onCreateDeliveryNote}><Truck size={16} /> Create delivery note</button>}
        {serverMode && invoice.deliveryNoteId && <button className="button button-secondary" onClick={onDownloadDeliveryNote}><Download size={16} /> Download {invoice.deliveryNoteNumber ?? "delivery note"}</button>}
        <button className="button button-quiet" onClick={onClose}>Close</button>
        {serverMode && !invoice.isDraft && <button className="button button-secondary" onClick={onDownloadInvoice}><Printer size={16} /> Download PDF</button>}
        {!(serverMode && settings.letterheadUrl) && <button className="button button-primary" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button>}
      </div>
    </Modal>
  );
}
