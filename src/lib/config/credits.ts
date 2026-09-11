// Build Credit economics — deliberately isolated so pricing changes never
// require touching business logic (spec: "pricing must be configurable
// rather than scattered as constants throughout the codebase"). Still a
// static constant for now; move to the `plans`/admin-config table once an
// admin surface exists to edit it without a deploy.
export const CREDITS_PER_USD = 100;

export function usdToCredits(usd: number): number {
  return Math.ceil(usd * CREDITS_PER_USD);
}
