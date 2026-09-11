import "server-only";

// Live-checks which OAuth providers are actually enabled on this Supabase
// project via GoTrue's public, unauthenticated /auth/v1/settings endpoint —
// no service-role key or Management API access needed, just the anon key
// already used everywhere else. Confirmed live against this project:
// { "external": { "google": false, ... }, "mailer_autoconfirm": false, ... }.
//
// Google is only shown on the sign in/up screens once this returns true —
// spec: "Google should be the prominent/easiest option IF configured".
// Cached for 5 minutes (Next's fetch cache) since this would otherwise be a
// live network round-trip on every /login and /signup render; fails closed
// (provider hidden) on any error, since showing a button that errors on
// click is worse than not showing it.
export async function isGoogleOAuthEnabled(): Promise<boolean> {
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`;
    const res = await fetch(url, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      next: { revalidate: 300 },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { external?: { google?: boolean } };
    return data.external?.google === true;
  } catch {
    return false;
  }
}
