import "server-only";
import { withTimeout } from "@/lib/utils/timeout";
import { ExternalProviderError } from "@/lib/utils/external-provider-error";

const VERCEL_API_BASE = "https://api.vercel.com";
const REQUEST_TIMEOUT_MS = 20_000;

// Live-testing discovery (see README "Live integration test — Slice 6"):
// a Vercel project created via v0's deploy() has Vercel Authentication
// (SSO deployment protection) ON by default, so the "production" URL
// isn't actually publicly reachable — visiting it redirects to
// vercel.com/sso-api. v0's own API has no setting for this; it's a Vercel
// project-level setting, only reachable via Vercel's own REST API with a
// token that has access to whatever Vercel team/account owns the project.
export async function disableDeploymentProtection(
  vercelProjectId: string,
): Promise<{ disabled: boolean; reason?: string }> {
  const token = process.env.VERCEL_ACCESS_TOKEN;
  if (!token) {
    return { disabled: false, reason: "VERCEL_ACCESS_TOKEN is not configured." };
  }

  const url = new URL(`${VERCEL_API_BASE}/v9/projects/${vercelProjectId}`);
  if (process.env.VERCEL_TEAM_ID) {
    url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  }

  const response = await withTimeout(
    fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ssoProtection: null }),
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out disabling deployment protection.",
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      disabled: false,
      reason: `Vercel API returned ${response.status}: ${body.slice(0, 300)}`,
    };
  }

  return { disabled: true };
}

function requireToken(): string {
  const token = process.env.VERCEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error("Custom domains aren't available yet — please try again later.");
  }
  return token;
}

function apiUrl(path: string): URL {
  const url = new URL(`${VERCEL_API_BASE}${path}`);
  if (process.env.VERCEL_TEAM_ID) {
    url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  }
  return url;
}

async function vercelErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // fall through to raw body below
  }
  return body.slice(0, 300) || `Vercel API returned ${response.status}`;
}

export interface DomainVerificationChallenge {
  type: string;
  domain: string;
  value: string;
  reason: string;
}

// Confirmed live against Vercel's REST API reference (docs.vercel.com/docs/rest-api):
// POST /v10/projects/{idOrName}/domains — adding a domain the platform doesn't
// already control returns 200 with `verified: false` and a `verification`
// challenge array (almost always a single TXT record) rather than an error;
// the domain isn't usable on the project until that challenge is completed
// and confirmed via verifyProjectDomain below.
export async function addProjectDomain(
  vercelProjectId: string,
  domainName: string,
): Promise<{ verified: boolean; verification: DomainVerificationChallenge[] }> {
  const token = requireToken();
  const response = await withTimeout(
    fetch(apiUrl(`/v10/projects/${vercelProjectId}/domains`), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: domainName }),
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out connecting the domain.",
  );

  if (!response.ok) {
    throw new ExternalProviderError(await vercelErrorMessage(response));
  }

  const data = (await response.json()) as {
    verified: boolean;
    verification?: DomainVerificationChallenge[];
  };
  return { verified: data.verified, verification: data.verification ?? [] };
}

// POST /v9/projects/{idOrName}/domains/{domain}/verify. A domain whose
// challenge isn't satisfied yet comes back as a 400 (not a 200 with
// verified: false) — that's the expected "not ready yet" case, distinct
// from a real failure, so it's reported back rather than thrown.
export async function verifyProjectDomain(
  vercelProjectId: string,
  domainName: string,
): Promise<{ verified: boolean; reason?: string }> {
  const token = requireToken();
  const response = await withTimeout(
    fetch(
      apiUrl(`/v9/projects/${vercelProjectId}/domains/${encodeURIComponent(domainName)}/verify`),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    ),
    REQUEST_TIMEOUT_MS,
    "Timed out checking domain verification.",
  );

  if (response.status === 400) {
    return { verified: false, reason: await vercelErrorMessage(response) };
  }
  if (!response.ok) {
    throw new ExternalProviderError(await vercelErrorMessage(response));
  }

  const data = (await response.json()) as { verified: boolean };
  return { verified: data.verified };
}

// GET /v6/domains/{domain}/config — DNS/SSL health check, independent of
// which project (if any) the domain is attached to.
export async function getDomainConfig(
  domainName: string,
): Promise<{ misconfigured: boolean; configuredBy: string | null }> {
  const token = requireToken();
  const response = await withTimeout(
    fetch(apiUrl(`/v6/domains/${encodeURIComponent(domainName)}/config`), {
      headers: { Authorization: `Bearer ${token}` },
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out checking domain configuration.",
  );

  if (!response.ok) {
    throw new ExternalProviderError(await vercelErrorMessage(response));
  }

  const data = (await response.json()) as {
    misconfigured: boolean;
    configuredBy: string | null;
  };
  return { misconfigured: data.misconfigured, configuredBy: data.configuredBy };
}

// DELETE /v9/projects/{idOrName}/domains/{domain}. A domain that's already
// gone from Vercel's side (404) is treated as success — the end state the
// caller wants is "not attached", which is already true.
export async function removeProjectDomain(
  vercelProjectId: string,
  domainName: string,
): Promise<void> {
  const token = requireToken();
  const response = await withTimeout(
    fetch(apiUrl(`/v9/projects/${vercelProjectId}/domains/${encodeURIComponent(domainName)}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out removing the domain.",
  );

  if (!response.ok && response.status !== 404) {
    throw new ExternalProviderError(await vercelErrorMessage(response));
  }
}
