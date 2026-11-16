import { useCallback, useEffect, useState } from "react";
import { Building2, Copy, UserMinus, Users } from "lucide-react";
import { apiRequest } from "../lib/api";

type Branch = { id: string; name: string; address: string | null; phone: string | null; isDefault: boolean };
type Member = { id: string; fullName: string; email: string; role: string; joinedAt: string };
type Invitation = { id: string; email: string; role: string; expiresInDays: number; acceptPath: string };

const inviteRoles = [
  ["admin", "Administrator"],
  ["finance_manager", "Finance manager"],
  ["accountant", "Accountant"],
  ["sales_officer", "Sales officer"],
  ["cashier", "Cashier"],
  ["auditor", "Auditor"],
] as const;

export default function BusinessAdministration({ businessRole }: { businessRole: string }) {
  const canManageTeam = businessRole === "owner" || businessRole === "admin";
  const canManageBranches = businessRole === "owner" || businessRole === "admin";
  const [branches, setBranches] = useState<Branch[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof inviteRoles)[number][0]>("accountant");
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [teamError, setTeamError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAdministration = useCallback(async () => {
    setLoading(true);
    setError("");
    setTeamError("");
    const [branchResult, memberResult] = await Promise.all([
      apiRequest<Branch[]>("/branches").then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      ),
      canManageTeam
        ? apiRequest<Member[]>("/users?limit=100&offset=0").then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        )
        : Promise.resolve({ status: "skipped" as const }),
    ]);
    if (branchResult.status === "fulfilled") setBranches(branchResult.value);
    else setError(branchResult.reason instanceof Error ? branchResult.reason.message : "Could not load branches.");
    if (memberResult.status === "fulfilled") setMembers(memberResult.value);
    else if (memberResult.status === "rejected") setTeamError(memberResult.reason instanceof Error ? memberResult.reason.message : "Could not load team members.");
    setLoading(false);
  }, [canManageTeam]);

  useEffect(() => { void loadAdministration(); }, [loadAdministration]);

  async function createBranch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest<Branch>("/branches", {
        method: "POST",
        body: JSON.stringify({ name: branchName, address: branchAddress }),
      });
      setBranchName("");
      setBranchAddress("");
      setNotice("Branch added.");
      await loadAdministration();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this branch.");
    } finally {
      setBusy(false);
    }
  }

  async function createInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setTeamError("");
    setNotice("");
    try {
      const created = await apiRequest<Invitation>("/users/invitations", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setInvitation(created);
      setEmail("");
      setNotice("Invitation created. Copy the link and send it to the invited person.");
    } catch (cause) {
      setTeamError(cause instanceof Error ? cause.message : "Could not create this invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvitation() {
    if (!invitation) return;
    try {
      const token = new URL(invitation.acceptPath, window.location.origin).searchParams.get("token");
      if (!token) throw new Error("The invitation link could not be created.");
      const link = new URL(window.location.href);
      link.search = "";
      link.hash = "";
      link.searchParams.set("invite", token);
      await navigator.clipboard.writeText(link.toString());
      setNotice("Invitation link copied. The invited person must sign in with the invited email address.");
    } catch (cause) {
      setTeamError(cause instanceof Error ? cause.message : "Could not copy the invitation link.");
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove ${member.fullName} (${member.email}) from this business?`)) return;
    setBusy(true);
    setTeamError("");
    setNotice("");
    try {
      await apiRequest(`/users/${member.id}`, { method: "DELETE" });
      setMembers((current) => current.filter((entry) => entry.id !== member.id));
      setNotice(`${member.fullName} was removed from this business.`);
    } catch (cause) {
      setTeamError(cause instanceof Error ? cause.message : "Could not remove this member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-section" id="business-administration">
      <div className="panel-heading"><div><h2>Branches and team</h2><p>Manage your business locations and people with access.</p></div></div>
      {loading && <p className="admin-message">Loading business administration…</p>}
      {!loading && (
        <div className="admin-grid">
          <section className="admin-subsection">
            <h3><Building2 size={15} /> Branches</h3>
            {error && <p className="security-error" role="alert">{error}</p>}
            <ul className="admin-list">
              {branches.map((branch) => <li key={branch.id}><span><strong>{branch.name}</strong><small>{branch.address || (branch.isDefault ? "Default branch" : "No address")}</small></span>{branch.isDefault && <small className="admin-tag">Default</small>}</li>)}
              {!branches.length && !error && <li><span><small>No branches found.</small></span></li>}
            </ul>
            {canManageBranches && <form className="admin-form" onSubmit={(event) => void createBranch(event)}>
              <label className="field"><span>Branch name</span><input required maxLength={160} value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="e.g. Westlands" /></label>
              <label className="field"><span>Address (optional)</span><input maxLength={500} value={branchAddress} onChange={(event) => setBranchAddress(event.target.value)} /></label>
              <button className="button button-secondary" disabled={busy || !branchName.trim()}>{busy ? "Saving…" : "Add branch"}</button>
            </form>}
          </section>
          <section className="admin-subsection">
            <h3><Users size={15} /> Team members</h3>
            {teamError && <p className="security-error" role="alert">{teamError}</p>}
            {!canManageTeam && <p className="admin-message">Team membership is managed by a business owner or administrator.</p>}
            <ul className="admin-list">
              {members.map((member) => <li key={member.id}>
                <span><strong>{member.fullName}</strong><small>{member.email} · {member.role.replaceAll("_", " ")}</small></span>
                {member.role !== "owner" && <button className="icon-button admin-remove" aria-label={`Remove ${member.fullName}`} title="Remove from business" disabled={busy} onClick={() => void removeMember(member)}><UserMinus size={15} /></button>}
              </li>)}
              {!members.length && !teamError && <li><span><small>No team members found.</small></span></li>}
            </ul>
            {canManageTeam && <form className="admin-form" onSubmit={(event) => void createInvitation(event)}>
              <label className="field"><span>Invite by email</span><input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" /></label>
              <label className="field"><span>Business role</span><select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>{inviteRoles.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <button className="button button-secondary" disabled={busy || !email.trim()}>{busy ? "Creating…" : "Create invitation"}</button>
              {invitation && <button type="button" className="button button-quiet" onClick={() => void copyInvitation()}><Copy size={14} /> Copy invite link</button>}
            </form>}
          </section>
        </div>
      )}
      {notice && <p className="security-notice" role="status">{notice}</p>}
    </section>
  );
}
