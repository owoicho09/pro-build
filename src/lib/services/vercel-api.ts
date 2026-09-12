import "server-only";
import { withTimeout } from "@/lib/utils/timeout";
import { ExternalProviderError } from "@/lib/utils/external-provider-error";

const VERCEL_API_BASE = "https://api.vercel.com";
const REQUEST_TIMEOUT_MS = 20_000;

// Root-cause investigation (see deploy-orchestrator.ts's publish flow for
// the full writeup): Vercel projects v0 creates come back with Deployment
// Protection's "Standard Protection" mode already on
// (ssoProtection.deploymentType: "prod_deployment_urls_and_all_previews") —
// confirmed against Vercel's own REST API docs, which name that exact enum
// value "Standard Protection" in their dashboard. Per Vercel's own
// deployment-protection docs, that mode protects each deployment's own
// unique per-deployment URL (both production's and every preview's) but
// deliberately leaves the project's assigned production alias/custom
// domain public — the alias is what real visitors are meant to use.
// getDeploymentPublicAlias() below resolves that alias directly from the
// deployment record rather than trusting v0's returned webUrl (which is
// that unique, protectable per-deployment URL — see v0-sdk's
// `DeploymentDetail.webUrl`, and Vercel's own deployment schema, where the
// equivalent field is documented as "the unique URL of the deployment").
//
// ensureProductionProtectionIsPublic() unconditionally clears the
// project's Vercel Authentication (`ssoProtection: null`) — per product
// decision, every generated customer site in this beta is meant to be
// fully public with no Vercel login wall anywhere, preview deployments
// included. This is a deliberate change from an earlier, narrower
// approach that only unprotected production while leaving preview
// deployments gated; that trade-off was rejected in favor of matching the
// literal, simpler "disable protection for the project" behavior Vercel's
// docs describe for `ssoProtection: null`.
//
// GET /v13/deployments/{id} and the ssoProtection shape below are both
// confirmed against Vercel's current REST API reference docs, not guessed.
export async function getDeploymentPublicAlias(
  vercelDeploymentId: string,
): Promise<string | null> {
  const token = process.env.VERCEL_ACCESS_TOKEN;
  if (!token) return null;

  const response = await withTimeout(
    fetch(apiUrl(`/v13/deployments/${vercelDeploymentId}`), {
      headers: { Authorization: `Bearer ${token}` },
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out resolving the deployment's production alias.",
  );

  if (!response.ok) {
    console.error(
      "Failed to read deployment for alias resolution",
      vercelDeploymentId,
      response.status,
      await response.text().catch(() => ""),
    );
    return null;
  }

  const data = (await response.json()) as {
    alias?: string[];
    aliasFinal?: string | null;
  };
  const hostname = data.aliasFinal ?? data.alias?.[0] ?? null;
  return hostname ? `https://${hostname}` : null;
}

export async function ensureProductionProtectionIsPublic(
  vercelProjectId: string,
): Promise<{ adjusted: boolean; reason?: string }> {
  const token = process.env.VERCEL_ACCESS_TOKEN;
  if (!token) {
    return { adjusted: false, reason: "VERCEL_ACCESS_TOKEN is not configured." };
  }

  const patchResponse = await withTimeout(
    fetch(apiUrl(`/v9/projects/${vercelProjectId}`), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ssoProtection: null }),
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out updating deployment protection settings.",
  );
  if (!patchResponse.ok) {
    const body = await patchResponse.text().catch(() => "");
    return {
      adjusted: false,
      reason: `Vercel API returned ${patchResponse.status}: ${body.slice(0, 300)}`,
    };
  }

  return { adjusted: true };
}

// Never speculate about whether a link is protected — confirm it. A
// protected deployment sends visitors through a Vercel login redirect (see
// Vercel's Vercel Authentication docs); `fetch`'s default redirect-following
// means a protected URL resolves to a final `response.url` on vercel.com
// instead of the original site, which is the one reliable, documented
// signal available without a real browser session. A network error or
// timeout here is "couldn't verify," not evidence of protection — it must
// never produce a false warning on a working link.
export async function verifyPublicUrl(
  url: string,
): Promise<{ verified: boolean; requiresVercelAuth: boolean }> {
  try {
    const response = await withTimeout(
      fetch(url, { method: "GET", redirect: "follow" }),
      10_000,
      "Timed out verifying the published URL.",
    );
    const redirectedToVercelAuth =
      response.url.includes("vercel.com/sso-api") || response.url.includes("vercel.com/login");
    const requiresVercelAuth = response.status === 401 || redirectedToVercelAuth;
    return { verified: response.ok && !requiresVercelAuth, requiresVercelAuth };
  } catch (err) {
    console.error("Failed to verify published URL is public", url, err);
    return { verified: false, requiresVercelAuth: false };
  }
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
