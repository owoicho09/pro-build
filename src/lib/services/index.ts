import "server-only";
import type { BuilderEngine } from "./builder-engine";
import { V0BuilderEngine } from "./v0-builder-engine";
import type { BillingProvider } from "./billing-provider";
import { PaystackBillingProvider } from "./paystack-billing";

let engine: BuilderEngine | null = null;

// Single seam the rest of the app depends on. Swapping the underlying
// provider later means changing this one function, not every call site.
export function getBuilderEngine(): BuilderEngine {
  if (!engine) {
    engine = new V0BuilderEngine();
  }
  return engine;
}

let billing: BillingProvider | null = null;

export function getBillingProvider(): BillingProvider {
  if (!billing) {
    billing = new PaystackBillingProvider();
  }
  return billing;
}

export type * from "./builder-engine";
export type * from "./billing-provider";
