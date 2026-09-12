// V1 admin authorization: a plain env-var allowlist checked server-side
// only (never sent to the client, never trusted from a request). Simpler
// than a `profiles.is_admin` column + RLS policy for the same outcome, and
// avoids the privilege-escalation surface a client-writable admin flag
// would add — see spec §51: "do not spend excessive development time
// creating a huge admin product."
function adminEmailAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmailAllowlist().includes(email.toLowerCase());
}

// Same list, reused as the recipient set for operational alerts (e.g. "a
// new user signed up" — see notifications.ts's sendWelcomeIfNeeded) rather
// than introducing a second, separate "who gets notified" config value.
export function getAdminEmails(): string[] {
  return adminEmailAllowlist();
}
