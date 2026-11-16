import { useRef, useState } from "react";
import { ImagePlus, LayoutTemplate, Trash2 } from "lucide-react";
import { removeBusinessLetterhead, removeBusinessLogo, updateBusinessSettings, uploadBusinessLetterhead, uploadBusinessLogo } from "../lib/api";
import type { AppSettings } from "../types";

const layouts: { id: NonNullable<AppSettings["invoiceLayout"]>; name: string; description: string }[] = [
  { id: "classic", name: "Classic", description: "Logo beside business details" },
  { id: "centered", name: "Centered", description: "A balanced centered header" },
  { id: "compact", name: "Compact", description: "A clean, space-saving layout" },
  { id: "modern", name: "Modern", description: "A bold, color-accented header" },
];

type Props = {
  settings: AppSettings;
  serverMode: boolean;
  canManage: boolean;
  onChange: (settings: AppSettings) => void;
};

export default function BusinessBranding({ settings, serverMode, canManage, onChange }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const letterheadInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedLayout = settings.invoiceLayout ?? "classic";

  async function selectLogo(file?: File) {
    if (!file) return;
    setError("");
    setNotice("");
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setError("Choose a PNG or JPEG image.");
      return;
    }
    if (file.size === 0 || file.size > 2 * 1024 * 1024) {
      setError("The logo must be smaller than 2 MB.");
      return;
    }
    if (![settings.businessName, settings.email, settings.phone, settings.address].every((value) => value.trim())
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email)) {
      setError("Enter your business name, valid email, phone number, and address before uploading a logo.");
      return;
    }
    setBusy(true);
    try {
      if (serverMode) {
        await updateBusinessSettings(settings);
        const result = await uploadBusinessLogo(file);
        onChange({ ...settings, logoUrl: `${result.logoUrl}?v=${Date.now()}`, letterheadUrl: null, letterheadMimeType: null });
      } else {
        const logoUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => {
            if (typeof reader.result === "string") resolve(reader.result);
            else reject(new Error("Could not read the selected logo image."));
          });
          reader.addEventListener("error", () => reject(new Error("Could not read the selected logo image.")));
          reader.readAsDataURL(file);
        });
        onChange({ ...settings, logoUrl });
      }
      setNotice("Logo added. It will appear on your invoices.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your business logo.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removeLogo() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (serverMode) await removeBusinessLogo();
      onChange({ ...settings, logoUrl: null });
      setNotice("Business logo removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove your business logo.");
    } finally {
      setBusy(false);
    }
  }

  async function selectLetterhead(file?: File) {
    if (!file) return;
    setError("");
    setNotice("");
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) {
      setError("Choose a single-page PDF, PNG, or JPEG letterhead.");
      return;
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError("The letterhead must be smaller than 5 MB.");
      return;
    }
    setBusy(true);
    try {
      if (serverMode) {
        const result = await uploadBusinessLetterhead(file);
        onChange({ ...settings, letterheadUrl: `${result.letterheadUrl}?v=${Date.now()}`, letterheadMimeType: result.mimeType, logoUrl: null });
      } else {
        const letterheadUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => {
            if (typeof reader.result === "string") resolve(reader.result);
            else reject(new Error("Could not read the selected letterhead."));
          });
          reader.addEventListener("error", () => reject(new Error("Could not read the selected letterhead.")));
          reader.readAsDataURL(file);
        });
        onChange({ ...settings, letterheadUrl, letterheadMimeType: file.type, logoUrl: null });
      }
      setNotice("Letterhead uploaded. It will be used as the page design for generated PDFs.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your letterhead.");
    } finally {
      setBusy(false);
      if (letterheadInput.current) letterheadInput.current.value = "";
    }
  }

  async function removeLetterhead() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (serverMode) await removeBusinessLetterhead();
      onChange({ ...settings, letterheadUrl: null, letterheadMimeType: null });
      setNotice("Letterhead removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove your letterhead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`business-branding ${settings.letterheadUrl ? "business-branding-letterhead" : ""}`}>
      <div className="branding-controls">
        <div className="branding-logo-control">
          <div className="branding-copy">
            <strong>Business logo</strong>
            <span>Add a PNG or JPEG logo (up to 2 MB). It is stored with this business and used on invoice PDFs.</span>
          </div>
          {settings.logoUrl
            ? <img className="branding-logo-thumbnail" src={settings.logoUrl} alt="Current business logo" />
            : <span className="branding-logo-placeholder"><ImagePlus size={19} /></span>}
          <input ref={fileInput} className="visually-hidden-file" type="file" accept="image/png,image/jpeg" aria-label="Upload business logo" disabled={busy || !canManage} onChange={(event) => void selectLogo(event.target.files?.[0])} />
          <button type="button" className="button button-secondary" disabled={busy || !canManage} onClick={() => fileInput.current?.click()}><ImagePlus size={15} /> {settings.logoUrl ? "Replace logo" : "Upload logo"}</button>
          {settings.logoUrl && <button type="button" className="icon-button danger-icon" aria-label="Remove business logo" disabled={busy || !canManage} onClick={() => void removeLogo()}><Trash2 size={16} /></button>}
        </div>
        <div className="branding-letterhead-control">
          <div className="branding-copy">
            <strong>Use a complete letterhead instead</strong>
            <span>Upload a one-page PDF or PNG/JPEG (up to 5 MB). It replaces the logo and business details on generated PDFs, so you can skip filling in the business profile.</span>
          </div>
          <input ref={letterheadInput} className="visually-hidden-file" type="file" accept="application/pdf,image/png,image/jpeg" aria-label="Upload business letterhead" disabled={busy || !canManage} onChange={(event) => void selectLetterhead(event.target.files?.[0])} />
          <button type="button" className="button button-secondary" disabled={busy || !canManage} onClick={() => letterheadInput.current?.click()}>{settings.letterheadUrl ? "Replace letterhead" : "Upload letterhead"}</button>
          {settings.letterheadUrl && <button type="button" className="icon-button danger-icon" aria-label="Remove business letterhead" disabled={busy || !canManage} onClick={() => void removeLetterhead()}><Trash2 size={16} /></button>}
        </div>
        {settings.letterheadUrl
          ? <div className="branding-letterhead-preview">
            {settings.letterheadMimeType === "application/pdf"
              ? <iframe title="Uploaded letterhead preview" src={settings.letterheadUrl} />
              : <img src={settings.letterheadUrl} alt="Uploaded business letterhead preview" />}
            <span>LETTERHEAD PREVIEW · used as the background on generated invoices and delivery notes</span>
          </div>
          : <>
            <div className="branding-layout-heading"><div><strong>Invoice layout</strong><span>Try each arrangement and choose the one that suits your business.</span></div><LayoutTemplate size={17} /></div>
            <div className="branding-layout-options">
              {layouts.map((layout) => (
                <button type="button" key={layout.id} className={`branding-layout-option ${selectedLayout === layout.id ? "branding-layout-selected" : ""}`} aria-pressed={selectedLayout === layout.id} disabled={!canManage} onClick={() => onChange({ ...settings, invoiceLayout: layout.id })}>
                  <span className={`branding-layout-thumb layout-thumb-${layout.id}`}>
                    {settings.logoUrl && <img src={settings.logoUrl} alt="" />}
                    <i /><i /><i />
                  </span>
                  <strong>{layout.name}</strong><small>{layout.description}</small>
                </button>
              ))}
            </div>
          </>}
      </div>
      {!settings.letterheadUrl && <div className={`branding-invoice-preview invoice-preview-${selectedLayout}`} aria-label={`${layouts.find((layout) => layout.id === selectedLayout)?.name} invoice preview`}>
        <div className="branding-preview-top">
          {settings.logoUrl && <img src={settings.logoUrl} alt="" />}
          <div><strong>{settings.businessName || "Your business name"}</strong><span>{[settings.email, settings.phone, settings.address].filter(Boolean).join(" · ") || "Your business contact details"}</span></div>
          <b>INVOICE</b>
        </div>
        <div className="branding-preview-rule" />
        <div className="branding-preview-meta"><strong>Bill to</strong><span>Customer name</span><small>Invoice number · Issue date · Due date</small></div>
        <div className="branding-preview-item"><strong>Service or product</strong><span>Qty 1</span><b>{settings.currency} 1,000.00</b></div>
        <div className="branding-preview-total"><span>Total</span><strong>{settings.currency} 1,000.00</strong></div>
        <small className="branding-preview-caption">LIVE PREVIEW · Changes apply to new invoice PDFs</small>
      </div>}
      {error && <p className="security-error" role="alert">{error}</p>}
      {notice && <p className="security-notice" role="status">{notice}</p>}
      {!canManage && <p className="settings-note">Only a business owner or administrator can change invoice branding.</p>}
    </div>
  );
}
