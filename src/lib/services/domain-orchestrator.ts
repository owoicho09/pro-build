import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";
import { getBuilderEngine } from "@/lib/services";
import {
  addProjectDomain,
  verifyProjectDomain,
  getDomainConfig,
  removeProjectDomain,
} from "@/lib/services/vercel-api";
import { toSafeMessage } from "@/lib/utils/external-provider-error";
import { getEffectivePlan } from "@/lib/services/usage";

type DomainRow = Database["public"]["Tables"]["domains"]["Row"];

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/i;

function describeChallenge(challenge: { type: string; domain: string; value: string }): string {
  if (challenge.type === "TXT") {
    return `Add a TXT record on ${challenge.domain} with value: ${challenge.value}`;
  }
  if (challenge.type === "CNAME") {
    return `Add a CNAME record on ${challenge.domain} pointing to: ${challenge.value}`;
  }
  return `Add a ${challenge.type} record on ${challenge.domain}: ${challenge.value}`;
}

async function requireVercelProjectId(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<{ vercelProjectId: string; ownerId: string }> {
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, owner_id, v0_project_id")
    .eq("id", projectId)
    .single();

  if (error || !project) {
    throw new Error("Project not found.");
  }
  if (!project.v0_project_id) {
    throw new Error("Publish this project before connecting a domain.");
  }

  const vercelProjectId = await getBuilderEngine().getVercelProjectId(project.v0_project_id);
  if (!vercelProjectId) {
    throw new Error("Publish this project before connecting a domain.");
  }

  return { vercelProjectId, ownerId: project.owner_id };
}

// Adds the domain on Vercel's side and records it locally. Per the plan
// (Check 7 / spec §16): connecting an existing domain is the V1 feature —
// this never purchases anything.
export async function connectDomain(
  supabase: SupabaseClient<Database>,
  input: { projectId: string; domainName: string },
): Promise<DomainRow> {
  const domainName = input.domainName.trim().toLowerCase();
  if (!DOMAIN_PATTERN.test(domainName)) {
    throw new Error("That doesn't look like a valid domain name.");
  }

  const { vercelProjectId, ownerId } = await requireVercelProjectId(supabase, input.projectId);

  const plan = await getEffectivePlan(supabase, ownerId);
  if (!plan?.features?.custom_domains) {
    throw new Error(
      "Custom domains are available on the Builder and Pro plans — upgrade to connect a domain.",
    );
  }

  let result: { verified: boolean; verification: { type: string; domain: string; value: string }[] };
  try {
    result = await addProjectDomain(vercelProjectId, domainName);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/already/i.test(message)) {
      throw new Error("This domain is already connected to a project — remove it there first.");
    }
    throw new Error(toSafeMessage(err, "Couldn't connect that domain right now. Please try again."));
  }

  const dnsInstructions =
    result.verification.length > 0 ? result.verification.map(describeChallenge).join("\n") : null;

  const { data: domain, error } = await supabase
    .from("domains")
    .insert({
      owner_id: ownerId,
      project_id: input.projectId,
      domain_name: domainName,
      status: result.verified ? "verified" : "pending_verification",
      verification_json: result.verification,
      dns_instructions: dnsInstructions,
      source: "connected",
    })
    .select("*")
    .single();

  if (error || !domain) {
    if (error?.code === "23505") {
      throw new Error("This domain is already connected somewhere on this account.");
    }
    throw new Error("This domain was connected but couldn't be saved — please try again.");
  }

  return domain;
}

// Re-checks a pending domain's DNS challenge. A "not ready yet" result is
// not an error (see vercel-api.ts) — the caller just isn't verified, same
// as before the check.
export async function checkDomainVerification(
  supabase: SupabaseClient<Database>,
  input: { domainId: string },
): Promise<{ domain: DomainRow; reason?: string }> {
  const { data: domain, error } = await supabase
    .from("domains")
    .select("*")
    .eq("id", input.domainId)
    .single();
  if (error || !domain) {
    throw new Error("Domain not found.");
  }
  if (!domain.project_id) {
    throw new Error("This domain isn't attached to a project.");
  }

  const { vercelProjectId } = await requireVercelProjectId(supabase, domain.project_id);
  let result: { verified: boolean };
  try {
    result = await verifyProjectDomain(vercelProjectId, domain.domain_name);
  } catch (err) {
    throw new Error(toSafeMessage(err, "Couldn't check verification right now. Please try again."));
  }

  if (!result.verified) {
    // The specific reason (from vercel-api.ts) is provider-internal text —
    // not shown directly; DNS propagation delay is the overwhelmingly
    // common real cause, so that's the honest, plain-language default.
    return {
      domain,
      reason: "DNS changes haven't finished propagating yet — this can take a few minutes to a few hours.",
    };
  }

  let sslStatus: string | null = "active";
  try {
    const config = await getDomainConfig(domain.domain_name);
    sslStatus = config.misconfigured ? "pending" : "active";
  } catch {
    // SSL status is informational — verification itself already succeeded.
    sslStatus = null;
  }

  const { data: updated, error: updateError } = await supabase
    .from("domains")
    .update({ status: "verified", ssl_status: sslStatus })
    .eq("id", domain.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    throw new Error("This domain was verified but couldn't be saved — please refresh.");
  }

  return { domain: updated };
}

export async function removeDomain(
  supabase: SupabaseClient<Database>,
  input: { domainId: string },
): Promise<void> {
  const { data: domain, error } = await supabase
    .from("domains")
    .select("*")
    .eq("id", input.domainId)
    .single();
  if (error || !domain) {
    throw new Error("Domain not found.");
  }

  if (domain.project_id) {
    try {
      const { vercelProjectId } = await requireVercelProjectId(supabase, domain.project_id);
      await removeProjectDomain(vercelProjectId, domain.domain_name);
    } catch (err) {
      // If the project was never actually published there's nothing to
      // remove remotely — the local row is still safe to delete.
      const message = err instanceof Error ? err.message : "";
      if (!/publish this project/i.test(message)) {
        throw new Error(toSafeMessage(err, "Couldn't remove that domain right now. Please try again."));
      }
    }
  }

  await supabase.from("domains").delete().eq("id", domain.id);
}
