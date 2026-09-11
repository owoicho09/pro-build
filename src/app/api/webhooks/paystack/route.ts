import { NextResponse } from "next/server";
import { processPaystackWebhook } from "@/lib/services/billing-orchestrator";

// Paystack requires the RAW request body for HMAC signature verification —
// reading it as text (not request.json()) before any parsing, so the bytes
// verified are exactly the bytes Paystack signed.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  try {
    await processPaystackWebhook(rawBody, signature);
  } catch (err) {
    console.error("Paystack webhook processing failed", err);
    // A bad signature is the one case worth a real 401 — anything else
    // (a malformed/unexpected payload) still gets 200 below, so Paystack
    // doesn't retry-storm us for something a code fix is what actually
    // needs, not a retry.
    if (err instanceof Error && err.message.includes("Invalid Paystack webhook signature")) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // Always 200 once the signature is valid — Paystack's own guidance is to
  // acknowledge quickly and not treat processing detail failures as reasons
  // to retry the same event indefinitely.
  return NextResponse.json({ received: true });
}
