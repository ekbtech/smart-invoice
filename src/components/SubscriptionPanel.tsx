import { useEffect, useState } from "react";
import { CircleHelp, CreditCard } from "lucide-react";
import { apiRequest } from "../lib/api";

type Plan = {
  id: string;
  code: string;
  name: string;
  monthlyPriceCents: number | null;
  invoiceLimit: number | null;
  userLimit: number | null;
  features: Record<string, boolean>;
};

type SubscriptionData = {
  exemptFromPlan: boolean;
  subscription: {
    id: string;
    planId: string;
    planCode: string;
    planName: string;
    monthlyPriceCents: number | null;
    invoiceLimit: number | null;
    userLimit: number | null;
    features: Record<string, boolean>;
    status: "trialing" | "active" | "past_due" | "suspended" | "cancelled";
    trialEndsAt: string | null;
  } | null;
  usage: { issuedInvoices: number; activeUsers: number };
  availablePlans: Plan[];
};

function priceLabel(priceCents: number | null) {
  if (priceCents === null) return "Custom pricing";
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(priceCents / 100) + " / month";
}

export default function SubscriptionPanel() {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest<SubscriptionData>("/subscription").then((result) => {
      if (active) setData(result);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not load subscription details.");
    });
    return () => { active = false; };
  }, []);

  if (error) return <section className="panel settings-section"><p className="form-error" role="alert">{error}</p></section>;
  if (!data) return <section className="panel settings-section"><p className="settings-note">Loading subscription details…</p></section>;

  const { subscription, usage } = data;
  return (
    <section className="panel settings-section" id="subscription">
      <div className="panel-heading"><div><h2>Subscription</h2><p>Plan, billing state, and usage for this business.</p></div><span className="settings-section-icon"><CreditCard size={17} /></span></div>
      {subscription && <div className="subscription-summary">
        <div><span className="eyebrow">CURRENT PLAN</span><strong>{subscription.planName}</strong><small>{priceLabel(subscription.monthlyPriceCents)}</small></div>
        <span className={`status-pill status-${subscription.status === "active" ? "paid" : subscription.status === "trialing" ? "pending" : "overdue"}`}><span className="status-dot" />{subscription.status.replaceAll("_", " ")}</span>
      </div>}
      {data.exemptFromPlan && <p className="settings-note admin-plan-exemption"><CircleHelp size={15} /> Platform administrator exemption is active in this workspace. Subscription status, feature availability, and plan usage limits do not restrict your account; other workspace members remain subject to the business plan.</p>}
      {!subscription && data.exemptFromPlan && <p className="settings-note">This business has no subscription plan assigned. Your platform administrator account can continue working here.</p>}
      {subscription?.status === "trialing" && subscription.trialEndsAt && <p className="settings-note">Trial ends {new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" }).format(new Date(subscription.trialEndsAt))}.</p>}
      <div className="subscription-usage">
        <div><span>Issued invoices this period</span><strong>{usage.issuedInvoices}{!subscription || subscription.invoiceLimit === null ? " / Unlimited" : ` / ${subscription.invoiceLimit}`}</strong></div>
        <div><span>Active business users</span><strong>{usage.activeUsers}{!subscription || subscription.userLimit === null ? " / Unlimited" : ` / ${subscription.userLimit}`}</strong></div>
      </div>
      {!data.exemptFromPlan && <p className="settings-note"><CircleHelp size={15} /> Existing records remain readable if a plan expires. To change or reactivate a plan, contact your platform administrator; in-app subscription payments are not configured.</p>}
      <div className="available-plan-list">
        {data.availablePlans.map((plan) => <div key={plan.id}><span>{plan.name}</span><strong>{priceLabel(plan.monthlyPriceCents)}</strong></div>)}
      </div>
    </section>
  );
}
