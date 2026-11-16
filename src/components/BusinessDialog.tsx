import { useState } from "react";
import type { FormEvent } from "react";
import { Building2 } from "lucide-react";
import { apiRequest, type BusinessMembership } from "../lib/api";
import Modal from "./Modal";

type Props = {
  onClose: () => void;
  onCreated: (business: BusinessMembership) => Promise<void>;
};

export default function BusinessDialog({ onClose, onCreated }: Props) {
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [kraPin, setKraPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const business = await apiRequest<BusinessMembership>("/auth/businesses", {
        method: "POST",
        body: JSON.stringify({ businessName, email, phone, address, kraPin }),
      });
      await onCreated(business);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create this business.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Create another business" subtitle="Set up a separate workspace for another company or branch." onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label className="field"><span>Business name</span><input autoFocus required minLength={2} maxLength={160} value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="e.g. Northstar Media" /></label>
        <label className="field"><span>Business email</span><input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="business@example.com" /></label>
        <label className="field"><span>Phone number</span><input maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+254 ..." /></label>
        <label className="field"><span>Business address</span><input maxLength={500} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="City, country" /></label>
        <label className="field"><span>KRA PIN (optional)</span><input maxLength={24} value={kraPin} onChange={(event) => setKraPin(event.target.value)} placeholder="P000000000X" /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="data-notice"><span><Building2 size={15} /></span><div><strong>Isolated business workspace</strong><p>Customers, invoices, settings and users are separate for each business.</p></div></div>
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Creating…" : "Create business"}</button></div>
      </form>
    </Modal>
  );
}
