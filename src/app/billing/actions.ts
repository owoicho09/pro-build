"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { startCheckout, cancelActiveSubscription } from "@/lib/services/billing-orchestrator";
import { toSafeMessage } from "@/lib/utils/external-provider-error";

export async function startCheckoutAction(_prevState: unknown, formData: FormData) {
  const planId = formData.get("planId");
  if (typeof planId !== "string") {
    return { error: "Missing plan." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  let authorizationUrl: string;
  try {
    ({ authorizationUrl } = await startCheckout(supabase, { planId }));
  } catch (err) {
    console.error("Failed to start checkout", planId, err);
    return {
      error: toSafeMessage(err, "Couldn't start checkout. Please try again."),
    };
  }

  redirect(authorizationUrl);
}

export async function cancelSubscriptionAction(_prevState: unknown, _formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Your session expired. Please sign in again." };
  }

  try {
    await cancelActiveSubscription(supabase, { userId: user.id });
  } catch (err) {
    console.error("Failed to cancel subscription", user.id, err);
    return {
      error: toSafeMessage(err, "Couldn't cancel your subscription. Please try again."),
    };
  }

  return { success: true };
}
