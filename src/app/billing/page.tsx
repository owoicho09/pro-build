import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getCreditBalance } from "@/lib/services/usage";
import { PlanCard } from "./plan-card";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan_id")
    .eq("id", user.id)
    .single();

  const { data: plans } = await supabase
    .from("plans")
    .select("*")
    .eq("active", true)
    .order("price_cents", { ascending: true });

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const balance = await getCreditBalance(supabase, user.id);

  const { count: projectCount } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);

  const currentPlan = (plans ?? []).find((p) => p.id === profile?.plan_id);

  let statusLine: string | null = null;
  if (subscription?.status === "active" && subscription.cancel_at_period_end) {
    statusLine = subscription.current_period_end
      ? `Canceling — access continues until ${new Date(subscription.current_period_end).toLocaleDateString()}.`
      : "Canceling at the end of the current billing period.";
  } else if (subscription?.status === "past_due") {
    statusLine = "Your last payment failed — update your payment method to keep your plan active.";
  } else if (subscription?.status === "active" && subscription.current_period_end) {
    statusLine = `Renews ${new Date(subscription.current_period_end).toLocaleDateString()}.`;
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build, publish and continuously improve your websites with AI.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          {currentPlan?.name ?? "Free"} plan · {projectCount ?? 0} / {currentPlan?.project_limit ?? 1}{" "}
          project{(currentPlan?.project_limit ?? 1) === 1 ? "" : "s"} · {balance.toLocaleString()} build
          credits remaining
        </p>
        {statusLine && <p className="mt-1 text-sm text-muted-foreground">{statusLine}</p>}

        {checkout === "complete" && (
          <div className="mt-4 rounded-lg border border-border bg-card p-4 text-sm">
            Thanks! Your payment is being confirmed — this can take a minute
            to reflect below.
          </div>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {(plans ?? []).map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={plan.id === profile?.plan_id}
              hasActiveSubscription={
                subscription?.plan_id === plan.id &&
                subscription.status === "active" &&
                !subscription.cancel_at_period_end
              }
              cancelAtPeriodEnd={
                subscription?.plan_id === plan.id && subscription.cancel_at_period_end
              }
            />
          ))}
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Canceling stops future billing — your projects, and everything
          you&apos;ve built, stay exactly as they are.
        </p>
      </div>
    </AppShell>
  );
}
