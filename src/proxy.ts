import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the middleware.js file convention to proxy.js (same
// runtime behavior, new name/location) — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
// This previously lived at the project root as `middleware.ts`, which is
// the pre-src-directory convention; with `app` under `src/app`, Next.js
// expects this file at `src/proxy.ts` to actually be picked up. Verified
// live: the old root `middleware.ts` was never being invoked at all (a
// diagnostic log inside updateSession() never fired for any request),
// which is why routes with no page-level auth check of their own (e.g.
// /projects/new before this fix) were silently reachable while signed
// out — every other "protected" route only worked because it also has
// its own redirect()/notFound() guard, not because of this file.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // `api` is excluded here, not just left out of PUBLIC_PATHS: API routes
  // (the cron job, the Paystack webhook) authenticate themselves — a
  // CRON_SECRET bearer token / webhook signature, no Supabase session —
  // and must never be redirected to /login. Confirmed live: before this
  // exclusion existed, this proxy wasn't running at all (see the comment
  // above), which is the only reason these routes ever worked; fixing
  // proxy.ts to actually execute without also excluding `api` here would
  // have broken both.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
