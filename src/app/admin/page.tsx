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
  getAdminDeployments,
  getAdminSubscriptions,
  getAdminUsageSummary,
  getAdminTopConsumers,
  getAdminSystemOverview,
  getAdminBuildTable,
  getAdminProjectDiagnostics,
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
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAdminEmail(user?.email)) {
    notFound();
  }

  const { project: inspectedProjectId } = await searchParams;

  const [
    users,
    projects,
    creditLiability,
    deployments,
    subscriptions,
    usage,
    topConsumers,
    overview,
    buildTable,
    projectDiagnostics,
  ] = await Promise.all([
    getAdminUsers(),
    getAdminProjects(),
    getAdminCreditLiability(),
    getAdminDeployments(),
    getAdminSubscriptions(),
    getAdminUsageSummary(),
    getAdminTopConsumers(),
    getAdminSystemOverview(),
    getAdminBuildTable(),
    inspectedProjectId ? getAdminProjectDiagnostics(inspectedProjectId) : Promise.resolve(null),
  ]);

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <h1 className="text-2xl font-semibold">Admin</h1>

        <Section title="System overview">
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Queued builds</p>
              <p className="mt-1 text-2xl font-semibold">{overview.queued_builds}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Running builds</p>
              <p className="mt-1 text-2xl font-semibold">{overview.running_builds}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Completed today</p>
              <p className="mt-1 text-2xl font-semibold">{overview.completed_today}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Failed today</p>
              <p className="mt-1 text-2xl font-semibold">{overview.failed_today}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active builders</p>
              <p className="mt-1 text-2xl font-semibold">{overview.active_builders}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Provider 429s today</p>
              <p className="mt-1 text-2xl font-semibold">{overview.provider_429_today}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Concurrency</p>
              <p className="mt-1 text-2xl font-semibold">
                {overview.current_concurrency} / {overview.max_concurrency}
              </p>
            </div>
          </div>
        </Section>

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

        <Section title="Project diagnostics">
          <form method="get" className="mb-3 flex gap-2">
            <input
              type="text"
              name="project"
              defaultValue={inspectedProjectId ?? ""}
              placeholder="Project ID"
              className="w-full max-w-sm rounded-md border border-border bg-transparent px-2 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-border/40"
            >
              Inspect
            </button>
          </form>
          {inspectedProjectId && !projectDiagnostics && (
            <p className="text-xs text-muted-foreground">No project found with that ID.</p>
          )}
          {projectDiagnostics && (
            <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Name</dt>
                <dd>{projectDiagnostics.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Owner</dt>
                <dd>{projectDiagnostics.owner_email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{projectDiagnostics.status}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Vercel project ID</dt>
                <dd>{projectDiagnostics.vercel_project_id ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Current build</dt>
                <dd>
                  {projectDiagnostics.current_build_id
                    ? `${projectDiagnostics.current_build_state} (${projectDiagnostics.current_build_id})`
                    : "none"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last successful build</dt>
                <dd>
                  {projectDiagnostics.last_successful_build_id
                    ? fmtDate(projectDiagnostics.last_successful_build_at)
                    : "none yet"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Latest preview URL</dt>
                <dd className="truncate">
                  {projectDiagnostics.preview_url ? (
                    <>
                      {projectDiagnostics.preview_url}{" "}
                      <a
                        href={projectDiagnostics.preview_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="whitespace-nowrap text-brand hover:underline"
                      >
                        Open Preview ↗
                      </a>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Production URL</dt>
                <dd className="truncate">
                  {projectDiagnostics.production_url ? (
                    <>
                      {projectDiagnostics.production_url}{" "}
                      <a
                        href={projectDiagnostics.production_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="whitespace-nowrap text-brand hover:underline"
                      >
                        Open Live Site ↗
                      </a>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Latest error</dt>
                <dd>{projectDiagnostics.latest_error ?? "—"}</dd>
              </div>
            </dl>
          )}
        </Section>

        <Section title={`Builds (${buildTable.length})`}>
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4">User</th>
                <th className="pb-2 pr-4">Project</th>
                <th className="pb-2 pr-4">State</th>
                <th className="pb-2 pr-4">Queued</th>
                <th className="pb-2 pr-4">Duration</th>
                <th className="pb-2 pr-4">Preview</th>
                <th className="pb-2 pr-4">Deployment</th>
                <th className="pb-2 pr-4">Repairs</th>
                <th className="pb-2 pr-4">Error</th>
                <th className="pb-2">Credits</th>
              </tr>
            </thead>
            <tbody>
              {buildTable.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="py-2 pr-4">{b.owner_email}</td>
                  <td className="py-2 pr-4">
                    <a href={`/admin?project=${b.project_id}`} className="hover:underline">
                      {b.project_name}
                    </a>
                  </td>
                  <td className="py-2 pr-4">
                    {b.state}
                    {b.error_code === "provider_capacity" && b.state === "queued" ? " (busy)" : ""}
                  </td>
                  <td className="py-2 pr-4">{fmtDate(b.queued_at)}</td>
                  <td className="py-2 pr-4">
                    {b.duration_seconds != null && b.dispatched_at ? `${b.duration_seconds}s` : "—"}
                  </td>
                  <td className="py-2 pr-4">{b.preview_status}</td>
                  <td className="py-2 pr-4">{b.deployment_status}</td>
                  <td className="py-2 pr-4" title={b.validation_error ?? undefined}>
                    {b.repair_attempts > 0 ? `${b.repair_attempts}` : "—"}
                  </td>
                  <td className="py-2 pr-4">{b.error_message ?? "—"}</td>
                  <td className="py-2">{b.credits_cost ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

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
                <th className="pb-2 pr-4">Actions</th>
                <th className="pb-2">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-2 pr-4">
                    <a href={`/admin?project=${p.id}`} className="hover:underline">
                      {p.name}
                    </a>
                  </td>
                  <td className="py-2 pr-4">{p.owner_email}</td>
                  <td className="py-2 pr-4">{p.status}</td>
                  <td className="py-2 pr-4 space-x-3">
                    {p.preview_url ? (
                      <a
                        href={p.preview_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:underline"
                      >
                        Open Preview
                      </a>
                    ) : (
                      <span className="text-muted-foreground">No preview</span>
                    )}
                    {p.production_url && (
                      <a
                        href={p.production_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:underline"
                      >
                        Open Live Site
                      </a>
                    )}
                  </td>
                  <td className="py-2">{fmtDate(p.last_activity_at)}</td>
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
                <th className="pb-2 pr-4">Monthly grant</th>
                <th className="pb-2 pr-4">Last payment</th>
                <th className="pb-2 pr-4">Paystack subscription</th>
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
                  <td className="py-2 pr-4">{s.monthly_credits?.toLocaleString() ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {s.last_payment_amount_cents != null
                      ? `₦${(s.last_payment_amount_cents / 100).toLocaleString()} (${fmtDate(s.last_payment_at)})`
                      : "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-[11px]">
                    {s.paystack_subscription_code ?? "—"}
                  </td>
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
