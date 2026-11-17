import { useCallback, useEffect, useState } from "react";
import { Building2, UserMinus, Users } from "lucide-react";
import { apiRequest } from "../lib/api";

type Branch = { id: string; name: string; address: string | null; phone: string | null; isDefault: boolean };
type Member = { id: string; fullName: string; email: string; role: string; joinedAt: string };
const userRoles = [
  ["admin", "Admin"],
  ["finance_manager", "Finance manager"],
  ["accountant", "Accountant"],
  ["sales_officer", "Sales officer"],
  ["cashier", "Cashier"],
  ["auditor", "Auditor"],
] as const;

export default function BusinessAdministration({ businessRole }: { businessRole: string }) {
  const canManageTeam = businessRole === "owner" || businessRole === "admin";
  const canCreateUsers = businessRole === "admin";
  const canManageBranches = businessRole === "owner" || businessRole === "admin";
  const [branches, setBranches] = useState<Branch[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<(typeof userRoles)[number][0]>("accountant");
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
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

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setTeamError("");
    setNotice("");
    try {
      await apiRequest<Member>("/users", {
        method: "POST",
        body: JSON.stringify({ fullName, email, password, role }),
      });
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("accountant");
      setNotice("User account created. Share the sign-in details securely.");
      await loadAdministration();
    } catch (cause) {
      setTeamError(cause instanceof Error ? cause.message : "Could not create this user account.");
    } finally {
      setBusy(false);
    }
  }

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
            {!canCreateUsers && <p className="admin-message">Only a business administrator can create user accounts.</p>}
            {canCreateUsers && <form className="admin-form" onSubmit={(event) => void createUser(event)}>
              <label className="field"><span>Full name</span><input required minLength={2} maxLength={160} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
              <label className="field"><span>Email address</span><input type="email" required maxLength={254} autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label className="field"><span>Initial password</span><input type="password" required minLength={4} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <label className="field"><span>Business role</span><select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>{userRoles.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <button className="button button-secondary" disabled={busy || !fullName.trim() || !email.trim() || password.length < 4}>{busy ? "Creating…" : "Create user account"}</button>
            </form>}
          </section>
        </div>
      )}
      {notice && <p className="security-notice" role="status">{notice}</p>}
    </section>
  );
}
