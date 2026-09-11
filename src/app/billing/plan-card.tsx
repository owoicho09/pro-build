"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Database } from "@/db/types";
import { startCheckoutAction, cancelSubscriptionAction } from "./actions";

type Plan = Database["public"]["Tables"]["plans"]["Row"];

export function PlanCard({
  plan,
  isCurrent,
  hasActiveSubscription,
  cancelAtPeriodEnd,
}: {
  plan: Plan;
  isCurrent: boolean;
  hasActiveSubscription: boolean;
  cancelAtPeriodEnd: boolean;
}) {
  const [checkoutState, checkoutAction, checkoutPending] = useActionState(
    startCheckoutAction,
    null,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelSubscriptionAction,
    null,
  );

  return (
    <Card className={"flex flex-col gap-3 p-5" + (isCurrent ? " border-brand" : "")}>
      <div>
        <h2 className="font-medium">{plan.name}</h2>
        <p className="text-2xl font-semibold">
          {plan.price_cents === 0 ? "Free" : `$${(plan.price_cents / 100).toFixed(0)}`}
          {plan.price_cents > 0 && (
            <span className="text-sm font-normal text-muted-foreground">/mo</span>
          )}
        </p>
      </div>
      <ul className="flex-1 space-y-1 text-sm text-muted-foreground">
        <li>{plan.monthly_credits.toLocaleString()} build credits / mo</li>
        <li>
          {plan.project_limit} project{plan.project_limit === 1 ? "" : "s"}
        </li>
        {plan.rate_limits?.builds_per_hour && (
          <li>{plan.rate_limits.builds_per_hour} builds/hour per project</li>
        )}
      </ul>

      {isCurrent ? (
        <span className="rounded-md bg-border/60 px-3 py-1.5 text-center text-sm font-medium">
          Current plan
        </span>
      ) : plan.paystack_plan_code ? (
        <form action={checkoutAction}>
          <input type="hidden" name="planId" value={plan.id} />
          <Button type="submit" className="w-full" disabled={checkoutPending}>
            {checkoutPending ? "Redirecting..." : "Upgrade"}
          </Button>
        </form>
      ) : (
        <Button className="w-full" disabled>
          Downgrade unavailable
        </Button>
      )}
      {checkoutState?.error && (
        <p className="text-xs text-danger" role="alert">
          {checkoutState.error}
        </p>
      )}

      {hasActiveSubscription && (
        <form action={cancelAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="w-full text-danger"
            disabled={cancelPending}
          >
            {cancelPending ? "Canceling..." : "Cancel subscription"}
          </Button>
        </form>
      )}
      {cancelAtPeriodEnd && (
        <p className="text-center text-xs text-muted-foreground">
          Cancels at the end of the current billing period.
        </p>
      )}
      {cancelState?.error && (
        <p className="text-xs text-danger" role="alert">
          {cancelState.error}
        </p>
      )}
    </Card>
  );
}
