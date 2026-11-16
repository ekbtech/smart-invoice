import { useEffect, useState } from "react";
import { Palette, Save, Trash2 } from "lucide-react";
import { apiRequest } from "../lib/api";

type TemplateConfig = { primaryColor: string; footerNote: string };
type InvoiceTemplate = { id: string; name: string; config: TemplateConfig; isDefault: boolean };
const defaultConfig = { primaryColor: "#6385ff", footerNote: "Thank you for your business." };

export default function InvoiceTemplates({ canManage }: { canManage: boolean }) {
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [name, setName] = useState("");
  const [primaryColor, setPrimaryColor] = useState(defaultConfig.primaryColor);
  const [footerNote, setFooterNote] = useState(defaultConfig.footerNote);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadTemplates() {
    setLoading(true);
    setError("");
    try {
      setTemplates(await apiRequest<InvoiceTemplate[]>("/invoice-templates"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load invoice templates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadTemplates(); }, []);

  async function createTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const created = await apiRequest<InvoiceTemplate>("/invoice-templates", {
        method: "POST",
        body: JSON.stringify({ name, primaryColor, footerNote }),
      });
      setTemplates((current) => [...current.map((item) => ({ ...item, isDefault: false })), created]);
      setName("");
      setNotice(`${created.name} created and applied to new invoices.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create this template.");
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(template: InvoiceTemplate) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await apiRequest<InvoiceTemplate>(`/invoice-templates/${template.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: template.name,
          primaryColor: template.config.primaryColor,
          footerNote: template.config.footerNote,
          isDefault: true,
        }),
      });
      setTemplates((current) => current.map((item) => ({ ...item, isDefault: item.id === updated.id })));
      setNotice(`${updated.name} is now the default template for new invoices.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the default template.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(template: InvoiceTemplate) {
    if (!window.confirm(`Delete the unused template “${template.name}”?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/invoice-templates/${template.id}`, { method: "DELETE" });
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      setNotice(`${template.name} deleted.`);
      await loadTemplates();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this template.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-section" id="invoice-templates">
      <div className="panel-heading"><div><h2>Invoice templates</h2><p>Choose an accent and footer note for invoices. Issued invoices retain their original design.</p></div><span className="settings-section-icon"><Palette size={17} /></span></div>
      {error && <p className="security-error" role="alert">{error}</p>}
      {notice && <p className="security-notice" role="status">{notice}</p>}
      {loading ? <p className="admin-message">Loading invoice templates…</p> : <ul className="template-list">
        {templates.map((template) => <li key={template.id}>
          <span className="template-swatch" style={{ backgroundColor: template.config.primaryColor }} />
          <span className="template-copy"><strong>{template.name}</strong><small>{template.config.footerNote}</small></span>
          {template.isDefault ? <span className="admin-tag">Default</span> : canManage && <button className="button button-quiet" disabled={busy} onClick={() => void setDefault(template)}>Set default</button>}
          {canManage && <button className="icon-button admin-remove" disabled={busy} aria-label={`Delete ${template.name}`} onClick={() => void deleteTemplate(template)}><Trash2 size={15} /></button>}
        </li>)}
        {templates.length === 0 && <li><span className="admin-message">No templates yet. The built-in blue design will be used until you create one.</span></li>}
      </ul>}
      {canManage && <form className="template-form" onSubmit={(event) => void createTemplate(event)}>
        <label className="field"><span>Template name</span><input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Modern blue" /></label>
        <label className="field template-color-field"><span>Accent color</span><input type="color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} /></label>
        <label className="field"><span>Footer note</span><input maxLength={500} value={footerNote} onChange={(event) => setFooterNote(event.target.value)} /></label>
        <button className="button button-secondary" disabled={busy || !name.trim()}><Save size={14} /> Create template</button>
      </form>}
    </section>
  );
}
