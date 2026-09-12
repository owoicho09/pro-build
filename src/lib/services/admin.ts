import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { MAX_CONCURRENT_BUILDS } from "@/lib/config/concurrency";

// All of these are read-only, cross-user views — they need to bypass RLS
// on purpose (an admin looking at "all users' credit balances" is exactly
// the case RLS exists to prevent for everyone else), so they go through the
// trusted direct-Postgres connection (see src/db/index.ts), never the
// RLS-scoped Supabase client. The caller (src/app/admin/page.tsx) is
// responsible for checking isAdminEmail() before any of this runs.

export type AdminUserRow = {
  id: string;
  email: string;
  plan_id: string | null;
  credit_balance: number;
  project_count: number;
  signed_up_at: string;
}

export type AdminProjectRow = {
  id: string;
  name: string;
  status: string;
  production_url: string | null;
  last_activity_at: string;
  owner_email: string;
}

export type AdminDeploymentRow = {
  id: string;
  url: string | null;
  target: string;
  ready_state: string;
  created_at: string;
  project_name: string;
}

export type AdminSubscriptionRow = {
  id: string;
  status: string;
  plan_id: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  email: string;
}

export type AdminUsageSummary = {
  today: number;
  this_month: number;
  all_time: number;
}

export type AdminTopConsumerRow = {
  email: string;
  total_cost: number;
}

export type AdminSystemOverview = {
  queued_builds: number;
  running_builds: number;
  completed_today: number;
  failed_today: number;
  provider_429_today: number;
  active_builders: number;
  current_concurrency: number;
  max_concurrency: number;
};

export type AdminBuildRow = {
  id: string;
  owner_email: string;
  project_name: string;
  project_id: string;
  state: string;
  error_code: string | null;
  error_message: string | null;
  queued_at: string;
  dispatched_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  v0_project_id: string | null;
  v0_chat_id: string | null;
  preview_status: string;
  deployment_status: string;
  credits_cost: number | null;
};

export type AdminProjectDiagnostics = {
  id: string;
  name: string;
  owner_email: string;
  status: string;
  vercel_project_id: string | null;
  preview_url: string | null;
  production_url: string | null;
  current_build_id: string | null;
  current_build_state: string | null;
  current_build_error: string | null;
  last_successful_build_id: string | null;
  last_successful_build_at: string | null;
  latest_error: string | null;
} | null;

export async function getAdminUsers(): Promise<AdminUserRow[]> {
  const result = await db.execute<AdminUserRow>(sql`
    select u.id, u.email, p.plan_id, u.created_at as signed_up_at,
      coalesce((
        select cl.balance_after from credit_ledger cl
        where cl.user_id = u.id order by cl.created_at desc limit 1
      ), 0) as credit_balance,
      (select count(*)::int from projects pr where pr.owner_id = u.id) as project_count
    from auth.users u
    join profiles p on p.id = u.id
    order by u.created_at desc
    limit 50
  `);
  return result.rows;
}

export async function getAdminProjects(): Promise<AdminProjectRow[]> {
  const result = await db.execute<AdminProjectRow>(sql`
    select pr.id, pr.name, pr.status, pr.production_url, pr.last_activity_at,
      u.email as owner_email
    from projects pr
    join auth.users u on u.id = pr.owner_id
    order by pr.last_activity_at desc
    limit 50
  `);
  return result.rows;
}

export async function getAdminCreditLiability(): Promise<number> {
  const result = await db.execute<{ total_liability: number }>(sql`
    select coalesce(sum(latest.balance_after), 0) as total_liability
    from (
      select distinct on (user_id) user_id, balance_after
      from credit_ledger
      order by user_id, created_at desc
    ) latest
  `);
  return Number(result.rows[0]?.total_liability ?? 0);
}

// Powers the admin "System overview" strip (spec §5) — a snapshot of what
// the load-control machinery in build-orchestrator.ts / concurrency.ts is
// actually doing right now, not historical analytics.
export async function getAdminSystemOverview(): Promise<AdminSystemOverview> {
  const result = await db.execute<{
    queued_builds: number;
    running_builds: number;
    completed_today: number;
    failed_today: number;
    provider_429_today: number;
    active_builders: number;
  }>(sql`
    select
      count(*) filter (where b.state = 'queued' and b.dispatched_at is null)::int as queued_builds,
      count(*) filter (where b.state in ('queued', 'streaming') and b.dispatched_at is not null)::int as running_builds,
      count(*) filter (where b.state = 'succeeded' and b.finished_at >= date_trunc('day', now()))::int as completed_today,
      count(*) filter (where b.state = 'failed' and b.finished_at >= date_trunc('day', now()))::int as failed_today,
      count(*) filter (where b.error_code = 'provider_capacity' and coalesce(b.last_dispatch_attempt_at, b.started_at) >= date_trunc('day', now()))::int as provider_429_today,
      count(distinct b.user_id) filter (where b.state in ('queued', 'streaming'))::int as active_builders
    from builds b
  `);
  const row = result.rows[0];
  const currentConcurrency = Number(row?.running_builds ?? 0);
  return {
    queued_builds: Number(row?.queued_builds ?? 0),
    running_builds: currentConcurrency,
    completed_today: Number(row?.completed_today ?? 0),
    failed_today: Number(row?.failed_today ?? 0),
    provider_429_today: Number(row?.provider_429_today ?? 0),
    active_builders: Number(row?.active_builders ?? 0),
    current_concurrency: currentConcurrency,
    max_concurrency: MAX_CONCURRENT_BUILDS,
  };
}

// Full build table (spec §5's "BUILD TABLE") — every build regardless of
// outcome (failed ones included), replacing an earlier failed-only view.
export async function getAdminBuildTable(): Promise<AdminBuildRow[]> {
  const result = await db.execute<AdminBuildRow>(sql`
    select
      b.id,
      u.email as owner_email,
      pr.name as project_name,
      pr.id as project_id,
      b.state,
      b.error_code,
      b.error_message,
      b.started_at as queued_at,
      b.dispatched_at,
      b.finished_at,
      extract(epoch from (coalesce(b.finished_at, now()) - b.dispatched_at))::int as duration_seconds,
      pr.v0_project_id,
      pr.v0_chat_id,
      case when pr.preview_url is not null then 'ready' else 'none' end as preview_status,
      case when pr.status = 'live' then 'live' when pr.production_url is not null then 'published' else 'not published' end as deployment_status,
      b.credits_cost
    from builds b
    join projects pr on pr.id = b.project_id
    join auth.users u on u.id = b.user_id
    order by b.started_at desc
    limit 50
  `);
  return result.rows;
}

// Single-project inspection (spec §5's "PROJECT DIAGNOSTICS") — looked up
// by id from the admin page's project table, not its own route, per spec
// §51's "do not spend excessive development time creating a huge admin
// product."
export async function getAdminProjectDiagnostics(projectId: string): Promise<AdminProjectDiagnostics> {
  const result = await db.execute<NonNullable<AdminProjectDiagnostics>>(sql`
    select
      pr.id,
      pr.name,
      u.email as owner_email,
      pr.status,
      pr.vercel_project_id,
      pr.preview_url,
      pr.production_url,
      current_build.id as current_build_id,
      current_build.state as current_build_state,
      current_build.error_message as current_build_error,
      last_success.id as last_successful_build_id,
      last_success.finished_at as last_successful_build_at,
      last_failure.error_message as latest_error
    from projects pr
    join auth.users u on u.id = pr.owner_id
    left join lateral (
      select id, state, error_message from builds
      where project_id = pr.id and state in ('queued', 'streaming')
      order by started_at desc limit 1
    ) current_build on true
    left join lateral (
      select id, finished_at from builds
      where project_id = pr.id and state = 'succeeded'
      order by finished_at desc limit 1
    ) last_success on true
    left join lateral (
      select error_message from builds
      where project_id = pr.id and state = 'failed'
      order by finished_at desc limit 1
    ) last_failure on true
    where pr.id = ${projectId}
    limit 1
  `);
  return result.rows[0] ?? null;
}

export async function getAdminDeployments(): Promise<AdminDeploymentRow[]> {
  const result = await db.execute<AdminDeploymentRow>(sql`
    select d.id, d.url, d.target, d.ready_state, d.created_at,
      pr.name as project_name
    from deployments d
    join projects pr on pr.id = d.project_id
    order by d.created_at desc
    limit 20
  `);
  return result.rows;
}

export async function getAdminSubscriptions(): Promise<AdminSubscriptionRow[]> {
  const result = await db.execute<AdminSubscriptionRow>(sql`
    select s.id, s.status, s.plan_id, s.cancel_at_period_end, s.current_period_end,
      u.email
    from subscriptions s
    join auth.users u on u.id = s.user_id
    order by s.created_at desc
    limit 50
  `);
  return result.rows;
}

export async function getAdminUsageSummary(): Promise<AdminUsageSummary> {
  const result = await db.execute<AdminUsageSummary>(sql`
    select
      coalesce(sum(credits_cost) filter (where created_at >= date_trunc('day', now())), 0) as today,
      coalesce(sum(credits_cost) filter (where created_at >= date_trunc('month', now())), 0) as this_month,
      coalesce(sum(credits_cost), 0) as all_time
    from usage_events
  `);
  const row = result.rows[0];
  return {
    today: Number(row?.today ?? 0),
    this_month: Number(row?.this_month ?? 0),
    all_time: Number(row?.all_time ?? 0),
  };
}

export async function getAdminTopConsumers(): Promise<AdminTopConsumerRow[]> {
  const result = await db.execute<AdminTopConsumerRow>(sql`
    select u.email, sum(ue.credits_cost)::int as total_cost
    from usage_events ue
    join auth.users u on u.id = ue.user_id
    group by u.email
    order by total_cost desc
    limit 10
  `);
  return result.rows;
}
