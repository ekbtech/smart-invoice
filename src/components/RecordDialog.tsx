import { useState } from "react";
import type { Customer, Product } from "../types";
import { makeId } from "../utils";
import Modal from "./Modal";

type CustomerProps = { kind: "customer"; onClose: () => void; onSave: (customer: Customer) => void };
type ProductProps = { kind: "product"; onClose: () => void; onSave: (product: Product) => void };

export default function RecordDialog(props: CustomerProps | ProductProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Services");
  const [price, setPrice] = useState("");

  const isCustomer = props.kind === "customer";
  const title = isCustomer ? "Add a customer" : "Add a product or service";

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCustomer) {
      props.onSave({
        id: makeId("customer"), name: name.trim(), email: email.trim(), phone: phone.trim(), company: company.trim(),
        address: address.trim(), initials: name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join(""),
        color: ["violet", "green", "pink", "blue"][Math.floor(Math.random() * 4)],
      });
    } else {
      props.onSave({ id: makeId("product"), name: name.trim(), description: description.trim(), category, priceCents: Math.round(Number(price) * 100) });
    }
  }

  return (
    <Modal title={title} subtitle={isCustomer ? "Keep billing details in one place." : "Save a frequently used item for faster invoicing."} onClose={props.onClose}>
      <form className="form-stack" onSubmit={save}>
        <label className="field"><span>{isCustomer ? "Full name" : "Product or service name"}</span><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder={isCustomer ? "e.g. Mary Wanjiku" : "e.g. Design consultation"} /></label>
        {isCustomer ? <>
          <label className="field"><span>Company</span><input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Company name" /></label>
          <label className="field"><span>Email address</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></label>
          <label className="field"><span>Phone number</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+254 ..." /></label>
          <label className="field"><span>Billing address</span><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="City, country" /></label>
        </> : <>
          <label className="field"><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A short description" /></label>
          <div className="form-grid">
            <label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>Services</option><option>Design</option><option>Development</option><option>Consulting</option><option>Other</option></select></label>
            <label className="field"><span>Unit price</span><input type="number" min="0" step="0.01" required value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0.00" /></label>
          </div>
        </>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={props.onClose}>Cancel</button><button type="submit" className="button button-primary">{isCustomer ? "Add customer" : "Add to catalog"}</button></div>
      </form>
    </Modal>
  );
}
