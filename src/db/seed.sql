-- Seeds the plans table (V1 monetization spec — Free / Builder / Pro in
-- Naira). Run once after migrations, before any signups: profiles.plan_id
-- defaults to 'free' with a foreign key into this table, so signup fails
-- until this exists.
--
-- Idempotent: safe to re-run. `price_cents` is actually kobo (Paystack's
-- smallest NGN unit — see seed-paystack-plans.md): 1,500,000 = ₦15,000,
-- 3,000,000 = ₦30,000. Change pricing/credits/limits here, not in
-- application code.
--
-- NOTE: changing `free.monthly_credits` only changes what NEW signups get
-- (handle_new_user() in rls.sql reads this table live at insert time) — it
-- never touches existing users' credit_ledger history or balances.

insert into public.plans (id, name, price_cents, monthly_credits, project_limit, rate_limits, features, active)
values
  ('free', 'Free', 0, 75, 1,
    '{"builds_per_hour": 5}'::jsonb,
    '{"custom_domains": false, "attachments": true}'::jsonb,
    true),
  ('builder', 'Builder', 1500000, 1000, 5,
    '{"builds_per_hour": 20}'::jsonb,
    '{"custom_domains": true, "attachments": true}'::jsonb,
    true),
  ('pro', 'Pro', 3000000, 2500, 15,
    '{"builds_per_hour": 60}'::jsonb,
    '{"custom_domains": true, "attachments": true, "priority_support": true}'::jsonb,
    true)
on conflict (id) do update set
  name = excluded.name,
  price_cents = excluded.price_cents,
  monthly_credits = excluded.monthly_credits,
  project_limit = excluded.project_limit,
  rate_limits = excluded.rate_limits,
  features = excluded.features,
  active = excluded.active;

-- Paystack plan codes are set separately, once, via seed-paystack-plans.md
-- (not here — this file has no env-var substitution, and the codes aren't
-- known until the plans are created on Paystack's side).
