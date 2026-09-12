// Load-control knobs for the beta (10-30 users) — see launch-update.txt
// §4. Deliberately plain env-configured constants, not a DB/admin-editable
// value: these protect our own infrastructure and v0's, not per-customer
// economics (that's credits/plans, see config/credits.ts), so there's no
// need for them to be editable without a deploy.
const parsedMax = Number(process.env.MAX_CONCURRENT_BUILDS);
export const MAX_CONCURRENT_BUILDS =
  Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : 3;

// A build stuck in "queued" without ever being dispatched (either waiting
// on a concurrency slot, or retrying after provider capacity errors) for
// longer than this is treated the same as any other stuck build — see
// build-orchestrator.ts's STUCK_THRESHOLD_MS, which this deliberately
// matches so "stuck" means one consistent thing across the whole pipeline.
export const MAX_DISPATCH_ATTEMPTS = 5;
