// Provider-agnostic seam over platform subscription billing — same pattern
// as BuilderEngine: domain code depends on this interface, never on
// Paystack's API directly, so a future provider swap doesn't ripple through
// checkout/webhook/cancellation call sites.

export interface CheckoutSession {
  authorizationUrl: string;
  reference: string;
}

export interface BillingProvider {
  /**
   * Starts a subscription checkout for a plan already provisioned on the
   * provider's side (a plan code, not created dynamically at runtime).
   */
  initializeSubscriptionCheckout(input: {
    email: string;
    planCode: string;
    amountCents: number;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<CheckoutSession>;

  /** Cancels an active subscription. */
  disableSubscription(input: {
    subscriptionCode: string;
    emailToken: string;
  }): Promise<void>;

  /** Verifies a webhook request actually came from the provider. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
}
