import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/config/admin";
import { CREDITS_PER_USD } from "@/lib/config/credits";
import {
  getAdminUsers,
  getAdminProjects,
  getAdminCreditLiability,
  getAdminFailedBuilds,
  getAdminDeployments,
  getAdminSubscriptions,
  getAdminUsageSummary,
  getAdminTopConsumers,
} from "@/lib/services/admin";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 overflow-x-auto">{children}</div>
    </Card>
  );
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

// Deliberately plain tables, no charts/analytics product — spec §51: "do
// not spend excessive development time creating a huge admin product; the
// operational data and service methods matter more than elaborate admin
// UI." A 404 (not a redirect to /login) for non-admins, so this page's
// existence isn't distinguishable from a route that doesn't exist.
export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdminEmail(user?.email)) {
    notFound();
  }

  const [
    users,
    projects,
    creditLiability,
    failedBuilds,
    deployments,
    subscriptions,
    usage,
    topConsumers,
  ] = await Promise.all([
    getAdminUsers(),
    getAdminProjects(),
    getAdminCreditLiability(),
    getAdminFailedBuilds(),
    getAdminDeployments(),
    getAdminSubscriptions(),
    getAdminUsageSummary(),
    getAdminTopConsumers(),
  ]);

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <h1 className="text-2xl font-semibold">Admin</h1>

        <div className="grid gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Credit liability</p>
            <p className="mt-1 text-2xl font-semibold">{creditLiability.toLocaleString()}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Usage today</p>
            <p className="mt-1 text-2xl font-semibold">
              ${(usage.today / CREDITS_PER_USD).toFixed(2)}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Usage this month</p>
            <p className="mt-1 text-2xl font-semibold">
              ${(usage.this_month / CREDITS_PER_USD).toFixed(2)}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Usage all-time</p>
            <p className="mt-1 text-2xl font-semibold">
              ${(usage.all_time / CREDITS_PER_USD).toFixed(2)}
            </p>
          </Card>
        </div>

        <Section title={`Users (${users.length})`}>
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Plan</th>
                <th className="pb-2 pr-4">Credits</th>
                <th className="pb-2 pr-4">Projects</th>
                <th className="pb-2">Signed up</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4">{u.plan_id ?? "free"}</td>
                  <td className="py-2 pr-4">{u.credit_balance}</td>
                  <td className="py-2 pr-4">{u.project_count}</td>
                  <td className="py-2">{fmtDate(u.signed_up_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`Top credit consumers`}>
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2">Total spend ($)</th>
              </tr>
            </thead>
            <tbody>
              {topConsumers.map((c) => (
                <tr key={c.email} className="border-t border-border">
                  <td className="py-2 pr-4">{c.email}</td>
                  <td className="py-2">
                    {(Number(c.total_cost) / CREDITS_PER_USD).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`Projects (${projects.length})`}>
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Owner</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Production URL</th>
                <th className="pb-2">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-2 pr-4">{p.name}</td>
                  <td className="py-2 pr-4">{p.owner_email}</td>
                  <td className="py-2 pr-4">{p.status}</td>
                  <td className="py-2 pr-4">{p.production_url ?? "—"}</td>
                  <td className="py-2">{fmtDate(p.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`Failed builds (${failedBuilds.length})`}>
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4">Project</th>
                <th className="pb-2 pr-4">Owner</th>
                <th className="pb-2 pr-4">Error</th>
                <th className="pb-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {failedBuilds.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="py-2 pr-4">{b.project_name}</td>
                  <td className="py-2 pr-4">{b.owner_email}</td>
                  <td className="py-2 pr-4">{b.error_message ?? "—"}</td>
                  <td className="py-2">{fmtDate(b.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`Deployments (${deployments.length})`}>
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4">Project</th>
                <th className="pb-2 pr-4">URL</th>
                <th className="pb-2 pr-4">Target</th>
                <th className="pb-2 pr-4">State</th>
                <th className="pb-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="py-2 pr-4">{d.project_name}</td>
                  <td className="py-2 pr-4">{d.url ?? "—"}</td>
                  <td className="py-2 pr-4">{d.target}</td>
                  <td className="py-2 pr-4">{d.ready_state}</td>
                  <td className="py-2">{fmtDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`Subscriptions (${subscriptions.length})`}>
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Plan</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Cancels at period end</th>
                <th className="pb-2">Current period end</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="py-2 pr-4">{s.email}</td>
                  <td className="py-2 pr-4">{s.plan_id}</td>
                  <td className="py-2 pr-4">{s.status}</td>
                  <td className="py-2 pr-4">{s.cancel_at_period_end ? "yes" : "no"}</td>
                  <td className="py-2">{fmtDate(s.current_period_end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </AppShell>
  );
}
