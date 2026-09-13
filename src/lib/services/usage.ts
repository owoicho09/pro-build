import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";

const DEFAULT_BUILDS_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function getCreditBalance(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("credit_ledger")
    .select("balance_after")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.balance_after ?? 0;
}

async function getPlanById(supabase: SupabaseClient<Database>, planId: string) {
  const { data: plan } = await supabase.from("plans").select("*").eq("id", planId).single();
  return plan;
}

// The plan that actually governs a user's entitlements right now — not
// necessarily profiles.plan_id (which is just "last plan a webhook set" and
// never reflects a cancellation's grace period). Reads the latest
// subscription row and applies the spec's grace rules:
//  - "active": paid plan applies.
//  - "past_due": a failed renewal must not immediately restrict anything
//    (spec: "should NOT ... eventually be restricted" — restriction happens
//    once Paystack itself gives up and sends subscription.disable).
//  - "canceled" but still before current_period_end: the customer already
//    paid for this period, so it stays paid until that date passes (spec:
//    "retain paid access until the end of the already-paid billing period").
// Anything else (no subscription row, canceled + period over) is Free —
// computed at read time, so there's no separate downgrade job that can
// drift out of sync.
export async function getEffectivePlan(supabase: SupabaseClient<Database>, userId: string) {
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan_id, status, current_period_end")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const stillPaid =
    subscription?.status === "active" ||
    subscription?.status === "past_due" ||
    (subscription?.status === "canceled" &&
      !!subscription.current_period_end &&
      new Date(subscription.current_period_end) > new Date());

  const planId = stillPaid && subscription ? subscription.plan_id : "free";
  return getPlanById(supabase, planId);
}

// Checked once, right before starting a build (spec: credits/rate limits
// protect economics and infrastructure respectively — both gate here,
// separately, so the error message can say which one actually applied).
export async function checkBuildAllowance(
  supabase: SupabaseClient<Database>,
  input: { userId: string; projectId: string },
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const balance = await getCreditBalance(supabase, input.userId);
  if (balance <= 0) {
    return {
      allowed: false,
      reason:
        "You're out of build credits. Upgrade your plan or wait for your next monthly grant to keep building.",
    };
  }

  const plan = await getEffectivePlan(supabase, input.userId);
  const buildsPerHour = plan?.rate_limits?.builds_per_hour ?? DEFAULT_BUILDS_PER_HOUR;

  // Per-project, not per-user-across-all-projects — a deliberate V1
  // simplification (documented in the README): it still catches the most
  // likely abuse shape (one project being hammered) without needing to
  // join across every project a user owns for each check.
  const { count } = await supabase
    .from("builds")
    .select("id", { count: "exact", head: true })
    .eq("project_id", input.projectId)
    .gte("started_at", new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString());

  if ((count ?? 0) >= buildsPerHour) {
    return {
      allowed: false,
      reason: `You've hit this project's build limit for the hour (${buildsPerHour}). Try again shortly.`,
    };
  }

  return { allowed: true };
}

// Sidebar's "Active builds" row — RLS on `builds` already scopes this to
// the caller's own projects (see rls.sql's project-ownership join), so no
// explicit owner filter is needed here beyond the state check.
export async function getActiveBuildCount(supabase: SupabaseClient<Database>): Promise<number> {
  const { count } = await supabase
    .from("builds")
    .select("id", { count: "exact", head: true })
    .in("state", ["queued", "streaming"]);

  return count ?? 0;
}

// Generic sliding-window rate limiter for expensive endpoints that aren't
// already covered by checkBuildAllowance above (spec §4D: publish, preview
// refresh, attachment upload). `action` names the endpoint so each has its
// own independent budget. Checks and records in one call — the caller
// should treat `allowed: false` as a hard stop (no side effect performed),
// and only call this once it's actually about to do the expensive work.
export async function checkAndRecordRateLimit(
  supabase: SupabaseClient<Database>,
  input: { userId: string; action: string; windowMs: number; maxRequests: number },
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const { count } = await supabase
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .eq("action", input.action)
    .gte("created_at", new Date(Date.now() - input.windowMs).toISOString());

  if ((count ?? 0) >= input.maxRequests) {
    return {
      allowed: false,
      reason: "You're doing that a bit too fast. Please wait a moment and try again.",
    };
  }

  await supabase.from("rate_limit_events").insert({ user_id: input.userId, action: input.action });
  return { allowed: true };
}

export async function checkProjectCapacity(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const plan = await getEffectivePlan(supabase, userId);
  const limit = plan?.project_limit ?? 1;

  const { count } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);

  if ((count ?? 0) >= limit) {
    return {
      allowed: false,
      reason: `Your plan allows up to ${limit} project${limit === 1 ? "" : "s"}. Upgrade to start another.`,
    };
  }

  return { allowed: true };
}
