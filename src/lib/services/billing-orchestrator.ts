import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBillingProvider } from "@/lib/services";
import { getCreditBalance } from "@/lib/services/usage";

// ---------------------------------------------------------------------------
// Checkout — runs inside a user-authenticated server action.
// ---------------------------------------------------------------------------

export async function startCheckout(
  supabase: SupabaseClient<Database>,
  input: { planId: string },
): Promise<{ authorizationUrl: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    throw new Error("Your session expired. Please sign in again.");
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("*")
    .eq("id", input.planId)
    .single();

  if (!plan?.paystack_plan_code) {
    throw new Error("This plan isn't available for checkout yet.");
  }

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", user.id)
    .in("status", ["active", "past_due"])
    .limit(1)
    .maybeSingle();

  if (existing) {
    // V1 doesn't support switching plans while a subscription is active —
    // Paystack proration would need to be invented, which the spec
    // explicitly says not to do. Cancel first, then re-subscribe once the
    // current period ends.
    throw new Error("You already have an active subscription. Cancel it before starting a new one.");
  }

  const billing = getBillingProvider();
  const session = await billing.initializeSubscriptionCheckout({
    email: user.email,
    planCode: plan.paystack_plan_code,
    amountCents: plan.price_cents,
    callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/billing?checkout=complete`,
    // The one thing guaranteed to survive to the *first* charge.success —
    // later lifecycle events (renewals, subscription.create) are matched
    // back to our user via profiles.paystack_customer_code instead, since
    // metadata isn't confirmed to propagate to those.
    metadata: { userId: user.id, planId: plan.id },
  });

  return { authorizationUrl: session.authorizationUrl };
}

// ---------------------------------------------------------------------------
// Cancellation — runs inside a user-authenticated server action.
// ---------------------------------------------------------------------------

export async function cancelActiveSubscription(
  supabase: SupabaseClient<Database>,
  input: { userId: string },
): Promise<void> {
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", input.userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!subscription?.paystack_subscription_code || !subscription.paystack_email_token) {
    throw new Error("No active subscription to cancel.");
  }

  await getBillingProvider().disableSubscription({
    subscriptionCode: subscription.paystack_subscription_code,
    emailToken: subscription.paystack_email_token,
  });

  // Spec: cancellation must not delete or restrict project data — only the
  // subscription record changes here. `cancel_at_period_end` (not an
  // immediate status flip to `canceled`) because Paystack's disable call
  // stops future renewal, but the customer keeps what they already paid
  // for until current_period_end; the final `canceled` status is set when
  // the `subscription.disable`/period-end webhook actually confirms it.
  await supabase
    .from("subscriptions")
    .update({ cancel_at_period_end: true })
    .eq("id", subscription.id);
}

// ---------------------------------------------------------------------------
// Webhook processing — no user session (Paystack calling our server
// directly), so this uses the trusted service-role client throughout, the
// same pattern as the cron route.
// ---------------------------------------------------------------------------

interface PaystackEventData {
  reference?: string;
  amount?: number;
  status?: string;
  plan?: { plan_code?: string } | string | null;
  subscription_code?: string;
  email_token?: string;
  subscription?: { subscription_code?: string } | string | null;
  customer?: { customer_code?: string; email?: string };
  metadata?: { userId?: string; planId?: string } | null;
  next_payment_date?: string;
}

async function resolveUserId(
  admin: ReturnType<typeof createAdminClient>,
  data: PaystackEventData,
): Promise<string | null> {
  if (data.metadata?.userId) return data.metadata.userId;

  const customerCode = data.customer?.customer_code;
  if (!customerCode) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("paystack_customer_code", customerCode)
    .maybeSingle();

  return profile?.id ?? null;
}

// A successful charge's own metadata only survives from the *first*
// transaction.initialize call (see startCheckout's comment) — recurring
// renewal charges won't carry it, so without this fallback chain a
// renewal's charge.success would silently grant nothing (spec test #4
// requires renewals to reset the allowance correctly). Falls back to the
// plan_code Paystack sends on the charge itself, then to whatever plan the
// user's own active subscription row already says.
async function resolvePlanForCharge(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  data: PaystackEventData,
): Promise<{ id: string; monthly_credits: number } | null> {
  if (data.metadata?.planId) {
    const { data: plan } = await admin
      .from("plans")
      .select("id, monthly_credits")
      .eq("id", data.metadata.planId)
      .maybeSingle();
    if (plan) return plan;
  }

  const planCode = typeof data.plan === "string" ? data.plan : data.plan?.plan_code;
  if (planCode) {
    const { data: plan } = await admin
      .from("plans")
      .select("id, monthly_credits")
      .eq("paystack_plan_code", planCode)
      .maybeSingle();
    if (plan) return plan;
  }

  const { data: subscription } = await admin
    .from("subscriptions")
    .select("plan_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!subscription) return null;

  const { data: plan } = await admin
    .from("plans")
    .select("id, monthly_credits")
    .eq("id", subscription.plan_id)
    .maybeSingle();
  return plan;
}

// Paystack doesn't guarantee charge.success and subscription.create arrive
// in any particular order — entitlements must not depend on which comes
// first. Called right after a verified charge resolves a paid plan, this
// makes getEffectivePlan() correct immediately instead of waiting for
// subscription.create: it reuses whatever row already represents this
// activation (a genuinely live subscription — the renewal case — or an
// unreconciled placeholder left by an earlier charge.success for the same
// user) rather than ever inserting a second row. subscription.create below
// is what fills in the canonical Paystack identifiers on that same row;
// this function never touches them, so it can never race subscription.create
// for ownership of the subscription_code.
async function ensureSubscriptionForCharge(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  planId: string,
): Promise<void> {
  const { data: existing } = await admin
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .or("paystack_subscription_code.is.null,status.in.(active,past_due)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await admin.from("subscriptions").update({ status: "active", plan_id: planId }).eq("id", existing.id);
    return;
  }

  const { error } = await admin
    .from("subscriptions")
    .insert({ user_id: userId, plan_id: planId, status: "active" });
  if (error) {
    console.error("Failed to create placeholder subscription", userId, error);
  }
}

export async function processPaystackWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<{ handled: boolean }> {
  if (!getBillingProvider().verifyWebhookSignature(rawBody, signatureHeader)) {
    throw new Error("Invalid Paystack webhook signature.");
  }

  const event = JSON.parse(rawBody) as { event: string; data: PaystackEventData };
  const admin = createAdminClient();
  const userId = await resolveUserId(admin, event.data);

  // Self-healing linkage: once we know both the user and their Paystack
  // customer_code, keep profiles.paystack_customer_code up to date so
  // later events (which may not carry metadata) can still resolve.
  if (userId && event.data.customer?.customer_code) {
    await admin
      .from("profiles")
      .update({ paystack_customer_code: event.data.customer.customer_code })
      .eq("id", userId)
      .is("paystack_customer_code", null);
  }

  switch (event.event) {
    case "charge.success": {
      if (!userId || !event.data.reference) break;

      const { error: insertError } = await admin.from("transactions").insert({
        user_id: userId,
        type: "subscription",
        amount_cents: event.data.amount ?? 0,
        provider: "paystack",
        provider_reference: event.data.reference,
        status: "succeeded",
      });

      // Unique violation on provider_reference = already processed this
      // exact transaction — the idempotency guarantee webhook retries need.
      if (insertError) {
        if (insertError.code === "23505") return { handled: true };
        console.error("Failed to record transaction", event.data.reference, insertError);
        break;
      }

      const plan = await resolvePlanForCharge(admin, userId, event.data);
      if (plan) {
        // Reset, not accumulate — spec: "monthly subscription allowance
        // BECOMES 1,000 credits" each cycle, unused allowance does not roll
        // over. Applied uniformly to the first activation charge and every
        // renewal charge, so a plan switch or repeated charge.success can
        // never stack multiple full allowances (each charge does exactly
        // one reset, and the transaction insert above already guarantees
        // this whole block only ever runs once per unique reference).
        const balance = await getCreditBalance(admin, userId);
        const newBalance = plan.monthly_credits;
        await admin.from("credit_ledger").insert({
          user_id: userId,
          delta: newBalance - balance,
          balance_after: newBalance,
          reason: "monthly_grant",
          reference_id: event.data.reference,
        });

        await admin.from("profiles").update({ plan_id: plan.id }).eq("id", userId);
        await ensureSubscriptionForCharge(admin, userId, plan.id);
      }
      break;
    }

    case "subscription.create": {
      if (!userId || !event.data.subscription_code) break;

      const planCode =
        typeof event.data.plan === "string" ? event.data.plan : event.data.plan?.plan_code;
      const { data: plan } = planCode
        ? await admin.from("plans").select("id").eq("paystack_plan_code", planCode).maybeSingle()
        : { data: null };
      const resolvedPlanId = plan?.id ?? event.data.metadata?.planId ?? "free";

      // If charge.success for this same activation already arrived first,
      // ensureSubscriptionForCharge above left an unreconciled placeholder
      // (active, no subscription_code yet) — attach the canonical Paystack
      // identifiers to that same row instead of inserting a second one.
      const { data: placeholder } = await admin
        .from("subscriptions")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .is("paystack_subscription_code", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (placeholder) {
        await admin
          .from("subscriptions")
          .update({
            plan_id: resolvedPlanId,
            status: "active",
            paystack_subscription_code: event.data.subscription_code,
            paystack_email_token: event.data.email_token ?? null,
            current_period_end: event.data.next_payment_date ?? null,
          })
          .eq("id", placeholder.id);
        break;
      }

      const { error: subscriptionInsertError } = await admin.from("subscriptions").insert({
        user_id: userId,
        plan_id: resolvedPlanId,
        status: "active",
        paystack_subscription_code: event.data.subscription_code,
        paystack_email_token: event.data.email_token ?? null,
        current_period_end: event.data.next_payment_date ?? null,
      });

      // Unique violation on paystack_subscription_code = this redelivery
      // already created/reconciled the row — same idempotency pattern as
      // charge.success above, guarding against Paystack's own webhook
      // retries.
      if (subscriptionInsertError && subscriptionInsertError.code !== "23505") {
        console.error("Failed to record subscription", event.data.subscription_code, subscriptionInsertError);
      }
      break;
    }

    case "invoice.payment_failed": {
      const subCode =
        typeof event.data.subscription === "string"
          ? event.data.subscription
          : event.data.subscription?.subscription_code;
      if (!subCode) break;

      await admin
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("paystack_subscription_code", subCode);
      break;
    }

    case "subscription.disable": {
      if (!event.data.subscription_code) break;

      await admin
        .from("subscriptions")
        .update({ status: "canceled" })
        .eq("paystack_subscription_code", event.data.subscription_code);
      break;
    }

    default:
      // Unrecognized event types are acknowledged, not treated as errors —
      // Paystack adds new event types over time and a 500 here would just
      // cause pointless retries for something we deliberately don't handle.
      return { handled: false };
  }

  return { handled: true };
}
