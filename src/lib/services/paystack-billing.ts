import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withTimeout } from "@/lib/utils/timeout";
import { ExternalProviderError } from "@/lib/utils/external-provider-error";
import type { BillingProvider, CheckoutSession } from "./billing-provider";

// Confirmed against Paystack's own docs (not the SDK — Paystack's REST API
// needs no SDK, plain fetch is the norm): POST /transaction/initialize with
// a `plan` code overrides the transaction amount and subscribes the
// customer to that plan on successful payment; POST /subscription/disable
// takes the subscription `code` + the `token` (email_token) captured from
// the `subscription.create` webhook — there's no other way to fetch that
// token after the fact, so it must be stored when that event arrives.
const API_BASE = "https://api.paystack.co";
const REQUEST_TIMEOUT_MS = 20_000;

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error("Billing isn't configured yet. Please try again later.");
  }
  return key;
}

async function paystackFetch(path: string, init: RequestInit) {
  const response = await withTimeout(
    fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out reaching the billing provider.",
  );

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.status) {
    throw new ExternalProviderError(
      body?.message ?? `Billing provider request failed (${response.status}).`,
    );
  }
  return body;
}

export class PaystackBillingProvider implements BillingProvider {
  async initializeSubscriptionCheckout(input: {
    email: string;
    planCode: string;
    amountCents: number;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<CheckoutSession> {
    const body = await paystackFetch("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        // `plan` overrides the actual charge with the plan's own amount —
        // this is still passed (matching the plan's real price, from our
        // own `plans.price_cents`) since whether Paystack requires a
        // positive amount even when overridden isn't confirmed; passing the
        // real price costs nothing and satisfies either behavior.
        amount: input.amountCents,
        plan: input.planCode,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    });

    return {
      authorizationUrl: body.data.authorization_url,
      reference: body.data.reference,
    };
  }

  async disableSubscription(input: {
    subscriptionCode: string;
    emailToken: string;
  }): Promise<void> {
    await paystackFetch("/subscription/disable", {
      method: "POST",
      body: JSON.stringify({ code: input.subscriptionCode, token: input.emailToken }),
    });
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac("sha512", secretKey()).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(signatureHeader, "utf8");
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }
}
