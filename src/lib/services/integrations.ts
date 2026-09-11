import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";
import type { AdminDatabase } from "@/db/admin-types";
import { detectProviders, getProvider } from "@/lib/config/providers";
import { encryptSecret, decryptSecret } from "@/lib/services/encryption";
import { getBuilderEngine } from "@/lib/services";
import { startOrContinueBuild } from "@/lib/services/build-orchestrator";

function adminClient() {
  return createSupabaseClient<AdminDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Scans a user's own prompt text for known provider keywords and records a
// `not_configured` integration requirement for any new match. Pure text
// heuristic — see providers.ts for why this isn't tied to any v0-side
// signal. Never throws: a detection miss should never block a build.
export async function detectAndRecordIntegrations(
  supabase: SupabaseClient<Database>,
  input: { projectId: string; promptText: string },
): Promise<void> {
  const matches = detectProviders(input.promptText);
  if (matches.length === 0) return;

  for (const provider of matches) {
    const { data: existing } = await supabase
      .from("project_integrations")
      .select("id")
      .eq("project_id", input.projectId)
      .eq("provider", provider.id)
      .maybeSingle();

    if (existing) continue;

    await supabase.from("project_integrations").insert({
      project_id: input.projectId,
      provider: provider.id,
      status: "not_configured",
      required_env_vars: provider.envVars.map((v) => ({ key: v.key, label: v.label })),
    });
  }
}

// Encrypts and stores the supplied values, pushes them to v0 as real
// project env vars (the confirmed mechanism — see Check 9 in the plan and
// v0.projects.createEnvVars in v0-builder-engine.ts), marks the integration
// configured, and sends v0 a follow-up message naming which env var KEYS
// are now available — never the values themselves, so a secret never
// appears in a chat message, prompt, or log line.
export async function configureIntegration(
  supabase: SupabaseClient<Database>,
  input: { projectId: string; provider: string; values: Record<string, string> },
): Promise<{ buildId: string | null }> {
  const providerDef = getProvider(input.provider);
  if (!providerDef) {
    throw new Error("Unknown integration.");
  }

  // Ownership check via the RLS-scoped client — only after this passes do
  // we touch the service-role client for the secret write itself.
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, v0_project_id, v0_chat_id, name")
    .eq("id", input.projectId)
    .single();
  if (projectError || !project) {
    throw new Error("Project not found.");
  }

  const { data: integration, error: integrationError } = await supabase
    .from("project_integrations")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("provider", input.provider)
    .single();
  if (integrationError || !integration) {
    throw new Error("This integration hasn't been requested for this project.");
  }

  const missingKeys = providerDef.envVars
    .map((v) => v.key)
    .filter((key) => !input.values[key]?.trim());
  if (missingKeys.length > 0) {
    throw new Error(`Missing a value for: ${missingKeys.join(", ")}`);
  }

  const admin = adminClient();
  for (const envVar of providerDef.envVars) {
    const value = input.values[envVar.key]!.trim();
    await admin.from("project_secrets").insert({
      project_integration_id: integration.id,
      env_key: envVar.key,
      encrypted_value: encryptSecret(value),
    });
  }

  if (project.v0_project_id) {
    await getBuilderEngine().setEnvVars({
      externalProjectId: project.v0_project_id,
      vars: providerDef.envVars.map((v) => ({
        key: v.key,
        value: input.values[v.key]!.trim(),
      })),
    });
  }

  await supabase
    .from("project_integrations")
    .update({ status: "configured", updated_at: new Date().toISOString() })
    .eq("id", integration.id);

  if (!project.v0_chat_id || !project.v0_project_id) {
    // Nothing built yet to continue — the secret is saved and will be
    // picked up whenever the first build happens.
    return { buildId: null };
  }

  const keyNames = providerDef.envVars.map((v) => v.key).join(", ");
  const { buildId } = await startOrContinueBuild(supabase, {
    projectId: input.projectId,
    prompt: `The ${providerDef.label} integration is now configured (environment variables ${keyNames} are available). Please finish wiring up real ${providerDef.label} functionality using process.env, removing any mock/placeholder behavior for it, and verify it works.`,
  });

  return { buildId };
}

// Retrieval helper kept for completeness/testing — never called from a
// client-facing path, and no UI ever displays a decrypted value back
// (spec: "do not display secret values again unnecessarily").
export async function getDecryptedSecrets(
  integrationId: string,
): Promise<Record<string, string>> {
  const admin = adminClient();
  const { data } = await admin
    .from("project_secrets")
    .select("env_key, encrypted_value")
    .eq("project_integration_id", integrationId);

  const result: Record<string, string> = {};
  for (const row of data ?? []) {
    result[row.env_key] = decryptSecret(row.encrypted_value);
  }
  return result;
}
