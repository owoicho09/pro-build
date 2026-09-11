// V1 admin authorization: a plain env-var allowlist checked server-side
// only (never sent to the client, never trusted from a request). Simpler
// than a `profiles.is_admin` column + RLS policy for the same outcome, and
// avoids the privilege-escalation surface a client-writable admin flag
// would add — see spec §51: "do not spend excessive development time
// creating a huge admin product."
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}
