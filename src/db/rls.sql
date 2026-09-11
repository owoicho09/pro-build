-- Row Level Security policies + the profile-creation trigger.
--
-- Run once against the Supabase Postgres instance, AFTER `pnpm db:migrate`
-- has created the tables (see README "Database setup"). Drizzle owns table
-- shape; this file owns everything Supabase/Postgres-specific that Drizzle
-- doesn't model (RLS, triggers) so the two don't fight over one migration
-- format.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Auto-create a profile row whenever a new Supabase auth user signs up.
-- ---------------------------------------------------------------------------

-- Also grants the new profile's plan's monthly_credits as the first
-- credit_ledger entry, atomically with profile creation (Slice 8) — a
-- profile with no ledger row defaults to a balance of 0, which meant a
-- brand new user's very first build already went negative (found during
-- live testing). One insert, in the same trigger, closes that gap for
-- every signup from here on; existing profiles from before this migration
-- need the one-off backfill below.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  granted_credits integer;
begin
  insert into public.profiles (id, full_name, plan_id)
  values (new.id, new.raw_user_meta_data->>'full_name', 'free')
  on conflict (id) do nothing;

  select monthly_credits into granted_credits from public.plans where id = 'free';

  if granted_credits is not null then
    insert into public.credit_ledger (user_id, delta, balance_after, reason)
    values (new.id, granted_credits, granted_credits, 'monthly_grant');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- One-off backfill for profiles created before the grant above existed —
-- safe to re-run: only touches profiles with zero existing ledger rows.
insert into public.credit_ledger (user_id, delta, balance_after, reason)
select p.id, pl.monthly_credits, pl.monthly_credits, 'monthly_grant'
from public.profiles p
join public.plans pl on pl.id = p.plan_id
where not exists (
  select 1 from public.credit_ledger cl where cl.user_id = p.id
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.builds enable row level security;
alter table public.deployments enable row level security;
alter table public.domains enable row level security;
alter table public.project_integrations enable row level security;
alter table public.project_secrets enable row level security;
alter table public.usage_events enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.subscriptions enable row level security;
alter table public.transactions enable row level security;
alter table public.notifications enable row level security;
-- plans is public reference data (pricing/features shown pre-signup) — readable by anyone, writable by no one via the client.
alter table public.plans enable row level security;
-- templates is public reference data too (browsable pre-signup); only
-- published rows are visible, and there is no client insert/update/delete
-- policy — templates are admin/service-role managed only.
alter table public.templates enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

drop policy if exists "projects_all_own" on public.projects;
create policy "projects_all_own" on public.projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "messages_all_own_project" on public.messages;
create policy "messages_all_own_project" on public.messages
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );

drop policy if exists "attachments_all_own" on public.attachments;
create policy "attachments_all_own" on public.attachments
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "builds_all_own_project" on public.builds;
create policy "builds_all_own_project" on public.builds
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );

drop policy if exists "deployments_all_own_project" on public.deployments;
create policy "deployments_all_own_project" on public.deployments
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );

drop policy if exists "domains_all_own" on public.domains;
create policy "domains_all_own" on public.domains
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "project_integrations_all_own_project" on public.project_integrations;
create policy "project_integrations_all_own_project" on public.project_integrations
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );

-- project_secrets holds encrypted values only, but still: no client-side
-- access at all. Every read/write goes through server code using the
-- service-role connection after an explicit ownership check.
drop policy if exists "project_secrets_no_client_access" on public.project_secrets;
create policy "project_secrets_no_client_access" on public.project_secrets
  for all using (false) with check (false);

drop policy if exists "usage_events_select_own" on public.usage_events;
create policy "usage_events_select_own" on public.usage_events
  for select using (user_id = auth.uid());

drop policy if exists "credit_ledger_select_own" on public.credit_ledger;
create policy "credit_ledger_select_own" on public.credit_ledger
  for select using (user_id = auth.uid());

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select using (user_id = auth.uid());

-- Slice 9: cancelActiveSubscription() sets cancel_at_period_end via the
-- RLS-scoped client after the real Paystack cancellation call succeeds —
-- everything else about a subscription (status, plan, provider ids) is
-- only ever written by the service-role webhook handler, never by a user
-- directly, so this stays narrowly an owner-scoped update, not full CRUD.
drop policy if exists "subscriptions_update_own" on public.subscriptions;
create policy "subscriptions_update_own" on public.subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own" on public.transactions
  for select using (user_id = auth.uid());

drop policy if exists "notifications_all_own" on public.notifications;
create policy "notifications_all_own" on public.notifications
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "plans_select_all" on public.plans;
create policy "plans_select_all" on public.plans
  for select using (active = true);

drop policy if exists "templates_select_published" on public.templates;
create policy "templates_select_published" on public.templates
  for select using (is_published = true);
