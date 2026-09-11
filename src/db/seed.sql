-- Seeds the plans table (spec §20 — configuration-driven pricing, not
-- hardcoded constants). Run once after migrations, before any signups:
-- profiles.plan_id defaults to 'free' with a foreign key into this table,
-- so signup fails until this exists.
--
-- Idempotent: safe to re-run. Numbers here are the spec's own "conceptual
-- starting point" (§20), not locked production pricing — change them here,
-- not in application code.

insert into public.plans (id, name, price_cents, monthly_credits, project_limit, rate_limits, features, active)
values
  ('free', 'Free', 0, 500, 1,
    '{"builds_per_hour": 5}'::jsonb,
    '{"custom_domains": false, "attachments": true}'::jsonb,
    true),
  ('builder', 'Builder', 1900, 5000, 3,
    '{"builds_per_hour": 20}'::jsonb,
    '{"custom_domains": true, "attachments": true}'::jsonb,
    true),
  ('pro', 'Pro', 4900, 15000, 10,
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
