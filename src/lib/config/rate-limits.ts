// Sliding-window budgets for expensive endpoints not already covered by
// checkBuildAllowance's builds-per-hour check (see usage.ts) — spec §4D.
// Generous on purpose: these exist to stop rapid, repeated/automated abuse
// of a single endpoint, not to throttle a normal user's real usage during
// a 10-30 person beta (preview refresh in particular fires automatically
// once per workspace visit, see preview-pane.tsx).
export const PUBLISH_RATE_LIMIT = { windowMs: 60 * 60 * 1000, maxRequests: 10 };
export const PREVIEW_REFRESH_RATE_LIMIT = { windowMs: 60 * 60 * 1000, maxRequests: 60 };
export const ATTACHMENT_UPLOAD_RATE_LIMIT = { windowMs: 60 * 60 * 1000, maxRequests: 60 };
