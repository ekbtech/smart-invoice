import { useEffect, useState } from "react";
import { Activity, Building2, CircleHelp, Plus, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { apiRequest } from "../lib/api";

type Plan = {
  id: string;
  code: string;
  name: string;
  monthlyPriceCents: number | null;
  invoiceLimit: number | null;
  userLimit: number | null;
  features: Record<string, boolean>;
  active: boolean;
};

type Subscription = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
  status: string;
  trialEndsAt: string | null;
  planId: string;
  planCode: string;
  planName: string;
  invoiceLimit: number | null;
  userLimit: number | null;
  activeUsers: number;
};

type Overview = {
  tenantCount: number;
  issuedInvoicesLast30Days: number;
  subscriptionsByStatus: Record<string, number>;
};

type AuditEntry = { id: string; action: string; entityType: string; adminEmail: string; createdAt: string };
const statuses = ["trialing", "active", "past_due", "suspended", "cancelled"] as const;

function showDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" }).format(new Date(value));
}

function priceLabel(value: number | null) {
  return value === null
    ? "Custom"
    : new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(value / 100);
}

export default function PlatformAdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [nextOverview, nextPlans, nextSubscriptions, nextAudit] = await Promise.all([
        apiRequest<Overview>("/platform-admin/overview"),
        apiRequest<Plan[]>("/platform-admin/plans"),
        apiRequest<Subscription[]>("/platform-admin/subscriptions?limit=100"),
        apiRequest<AuditEntry[]>("/platform-admin/audit?limit=20"),
      ]);
      setOverview(nextOverview);
      setPlans(nextPlans);
      setSubscriptions(nextSubscriptions);
      setAudit(nextAudit);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load platform administration data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function savePlan(plan: Plan, featuresJson: string) {
    try {
      const features = JSON.parse(featuresJson) as Record<string, boolean>;
      if (!features || Array.isArray(features) || typeof features !== "object"
        || Object.values(features).some((value) => typeof value !== "boolean")) {
        throw new Error("Features must be a JSON object containing boolean values.");
      }
      await apiRequest(`/platform-admin/plans/${plan.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: plan.name,
          monthlyPriceCents: plan.monthlyPriceCents,
          invoiceLimit: plan.invoiceLimit,
          userLimit: plan.userLimit,
          features,
          active: plan.active,
        }),
      });
      setNotice(`${plan.name} plan saved.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this plan.");
    }
  }

  async function createPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const features = JSON.parse(String(form.get("features") || "{}")) as Record<string, boolean>;
      await apiRequest("/platform-admin/plans", {
        method: "POST",
        body: JSON.stringify({
          code: form.get("code"),
          name: form.get("name"),
          monthlyPriceCents: form.get("price") === "" ? null : Math.round(Number(form.get("price")) * 100),
          invoiceLimit: form.get("invoiceLimit") === "" ? null : Number(form.get("invoiceLimit")),
          userLimit: form.get("userLimit") === "" ? null : Number(form.get("userLimit")),
          features,
        }),
      });
      setCreating(false);
      setNotice("Subscription plan created.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create this plan.");
    }
  }

  async function saveSubscription(subscription: Subscription, form: HTMLFormElement) {
    const values = new FormData(form);
    try {
      await apiRequest(`/platform-admin/subscriptions/${subscription.id}`, {
        method: "PATCH",
        body: JSON.stringify({ planId: values.get("planId"), status: values.get("status") }),
      });
      setNotice(`${subscription.tenantName} subscription updated.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this subscription.");
    }
  }

  return <>
    <header className="page-header">
      <div><span className="eyebrow">PLATFORM OPERATIONS</span><h1>Platform administration</h1><p>Manage subscription plans, business access, and administrator activity.</p></div>
      <button className="button button-quiet" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
    </header>
    <div className="platform-admin-notice"><ShieldCheck size={17} /> Restricted to administrator emails configured in the API environment.</div>
    {error && <p className="form-error" role="alert">{error}<button className="button button-quiet" onClick={() => setError("")}>Dismiss</button></p>}
    {notice && <p className="settings-note" role="status">{notice}<button className="button button-quiet" onClick={() => setNotice("")}>Dismiss</button></p>}
    {overview && <div className="report-stat-grid platform-admin-stats">
      <div className="panel report-stat"><span><i className="report-dot blue-dot" />Businesses</span><strong>{overview.tenantCount}</strong><small>Registered tenant workspaces</small></div>
      <div className="panel report-stat"><span><i className="report-dot green-dot" />Issued invoices</span><strong>{overview.issuedInvoicesLast30Days}</strong><small>Across the platform in the last 30 days</small></div>
      <div className="panel report-stat"><span><i className="report-dot yellow-dot" />Active subscriptions</span><strong>{overview.subscriptionsByStatus.active ?? 0}</strong><small>{overview.subscriptionsByStatus.trialing ?? 0} currently trialing</small></div>
    </div>}

    <section className="panel platform-admin-section">
      <div className="panel-heading"><div><h2>Subscription plans</h2><p>Prices use KES. A blank limit means unlimited.</p></div><button className="button button-secondary" onClick={() => setCreating((value) => !value)}><Plus size={15} /> New plan</button></div>
      {creating && <form className="platform-plan-create" onSubmit={(event) => void createPlan(event)}>
        <label className="field"><span>Plan code</span><input name="code" required pattern="[a-z0-9_-]+" maxLength={40} /></label>
        <label className="field"><span>Plan name</span><input name="name" required maxLength={100} /></label>
        <label className="field"><span>Monthly price (KES)</span><input name="price" type="number" min="0" step="1" /></label>
        <label className="field"><span>Invoices / period</span><input name="invoiceLimit" type="number" min="1" step="1" /></label>
        <label className="field"><span>Active user limit</span><input name="userLimit" type="number" min="1" step="1" /></label>
        <label className="field platform-feature-field"><span>Features (JSON booleans)</span><textarea name="features" defaultValue='{"basicInvoicing":true,"customers":true,"products":true,"pdf":true}' /></label>
        <div className="platform-form-actions"><button type="button" className="button button-quiet" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary"><Save size={14} /> Create plan</button></div>
      </form>}
      {loading ? <p className="settings-note">Loading plans…</p> : <div className="platform-plan-grid">{plans.map((plan) => <PlanEditor key={plan.id} plan={plan} onSave={savePlan} />)}</div>}
    </section>

    <section className="panel platform-admin-section">
      <div className="panel-heading"><div><h2>Business subscriptions</h2><p>Reactivate or change a business plan. Updates are recorded in the platform audit log.</p></div><Building2 size={18} /></div>
      {loading ? <p className="settings-note">Loading subscriptions…</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>BUSINESS</th><th>PLAN</th><th>STATUS</th><th>TRIAL END</th><th>ACTIVE USERS</th><th>ACTION</th></tr></thead><tbody>
        {subscriptions.map((subscription) => <tr key={subscription.id}><td><strong>{subscription.tenantName}</strong><small className="platform-subscription-email">{subscription.tenantEmail}</small></td><td colSpan={5}><form className="platform-subscription-form" onSubmit={(event) => { event.preventDefault(); void saveSubscription(subscription, event.currentTarget); }}>
          <select name="planId" defaultValue={subscription.planId} aria-label={`Plan for ${subscription.tenantName}`}>{plans.filter((plan) => plan.active).map((plan) => <option value={plan.id} key={plan.id}>{plan.name}</option>)}</select>
          <select name="status" defaultValue={subscription.status} aria-label={`Status for ${subscription.tenantName}`}>{statuses.map((status) => <option value={status} key={status}>{status.replaceAll("_", " ")}</option>)}</select>
          <span>{showDate(subscription.trialEndsAt)}</span><span>{subscription.activeUsers}{subscription.userLimit === null ? " / ∞" : ` / ${subscription.userLimit}`}</span>
          <button className="button button-secondary"><Save size={14} /> Save</button>
        </form></td></tr>)}
      </tbody></table></div>}
    </section>

    <section className="panel platform-admin-section">
      <div className="panel-heading"><div><h2>Administrator audit</h2><p>Recent plan and subscription changes.</p></div><Activity size={18} /></div>
      {audit.length === 0 ? <p className="settings-note"><CircleHelp size={15} /> No administrator changes have been recorded yet.</p> : <div className="platform-audit-list">{audit.map((entry) => <div key={entry.id}><strong>{entry.action.replaceAll(".", " ")}</strong><span>{entry.entityType} · {entry.adminEmail} · {showDate(entry.createdAt)}</span></div>)}</div>}
    </section>
  </>;
}

function PlanEditor({ plan, onSave }: { plan: Plan; onSave: (plan: Plan, features: string) => Promise<void> }) {
  const [draft, setDraft] = useState(plan);
  const [features, setFeatures] = useState(JSON.stringify(plan.features, null, 2));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(plan);
    setFeatures(JSON.stringify(plan.features, null, 2));
  }, [plan]);
  function numberValue(value: string, field: "monthlyPriceCents" | "invoiceLimit" | "userLimit") {
    const parsed = value === "" ? null : Number(value);
    setDraft((current) => ({ ...current, [field]: parsed }));
  }
  return <form className="platform-plan-card" onSubmit={async (event) => {
    event.preventDefault();
    setSaving(true);
    try { await onSave(draft, features); } finally { setSaving(false); }
  }}>
    <div className="platform-plan-title"><div><strong>{draft.name}</strong><small>{draft.code}</small></div><label className="setting-toggle-row"><span>Active</span><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} /></label></div>
    <label className="field"><span>Name</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={100} /></label>
    <label className="field"><span>Monthly price (KES)</span><input type="number" min="0" step="1" value={draft.monthlyPriceCents === null ? "" : draft.monthlyPriceCents / 100} onChange={(event) => numberValue(event.target.value === "" ? "" : String(Math.round(Number(event.target.value) * 100)), "monthlyPriceCents")} /></label>
    <label className="field"><span>Invoices per period</span><input type="number" min="1" step="1" value={draft.invoiceLimit ?? ""} onChange={(event) => numberValue(event.target.value, "invoiceLimit")} /></label>
    <label className="field"><span>Active users</span><input type="number" min="1" step="1" value={draft.userLimit ?? ""} onChange={(event) => numberValue(event.target.value, "userLimit")} /></label>
    <label className="field"><span>Features JSON</span><textarea value={features} onChange={(event) => setFeatures(event.target.value)} /></label>
    <div className="platform-plan-footer"><span>{priceLabel(draft.monthlyPriceCents)}</span><button className="button button-secondary" disabled={saving}><Save size={14} /> Save plan</button></div>
  </form>;
}
