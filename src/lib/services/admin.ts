import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

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

export type AdminFailedBuildRow = {
  id: string;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  project_name: string;
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

export async function getAdminFailedBuilds(): Promise<AdminFailedBuildRow[]> {
  const result = await db.execute<AdminFailedBuildRow>(sql`
    select b.id, b.error_message, b.started_at, b.finished_at,
      pr.name as project_name, u.email as owner_email
    from builds b
    join projects pr on pr.id = b.project_id
    join auth.users u on u.id = pr.owner_id
    where b.state = 'failed'
    order by b.started_at desc
    limit 20
  `);
  return result.rows;
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
