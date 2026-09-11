// Tags an error whose message came from a third-party API's own raw
// response text (v0, Vercel, Paystack) rather than something authored for
// a normal user to read. Thrown at the exact point a provider call fails
// with unexpected/untranslated text — every other thrown Error in this
// codebase is assumed to have been written for a user, so it's shown as-is.
//
// Found during a UX audit: several server actions (`connectDomainAction`,
// `verifyDomainAction`, `removeDomainAction`, `configureIntegrationAction`,
// billing's checkout/cancel actions) did `err instanceof Error ?
// err.message : fallback` with no gate at all, unlike sendProjectMessage's
// EXPECTED_ERRORS allowlist — meaning any raw Vercel/Paystack API error
// text reached the UI verbatim. This is the single place that decides
// whether a caught error's message is safe to show.
export class ExternalProviderError extends Error {}

export function toSafeMessage(err: unknown, fallback: string): string {
  if (err instanceof ExternalProviderError) return fallback;
  return err instanceof Error ? err.message : fallback;
}
