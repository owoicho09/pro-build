import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";
import { getBuilderEngine } from "@/lib/services";
import { disableDeploymentProtection } from "@/lib/services/vercel-api";
import { notifyUser } from "@/lib/services/notifications";

// v0's deploy() call is a single request/response — confirmed live: no
// separate polling needed, `webUrl` comes back once the call resolves (see
// README "Live integration test"). So publishing doesn't need a builds-style
// queued/streaming state machine; it either succeeds or throws.
export async function publishProject(
  supabase: SupabaseClient<Database>,
  input: { projectId: string },
): Promise<{ url: string; publicWarning?: string }> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", input.projectId)
    .single();

  if (projectError || !project) {
    throw new Error("Project not found.");
  }

  if (!project.v0_chat_id || !project.v0_project_id) {
    throw new Error("This project hasn't been built yet — nothing to publish.");
  }

  const engine = getBuilderEngine();

  // Deliberately no DB write before this call and no intermediate
  // "publishing" project status: the call is a single bounded (timeout-
  // wrapped) request, so there's nothing meaningful to persist mid-flight,
  // and persisting one would risk a stuck "publishing" state if the process
  // restarts mid-call. If it fails, the project's existing production_url
  // (if any) is left completely untouched — spec: a failed publish must not
  // take down a working production site.
  let result: Awaited<ReturnType<typeof engine.deploy>>;
  try {
    result = await engine.deploy({
      externalProjectId: project.v0_project_id,
      externalChatId: project.v0_chat_id,
    });
    if (!result.url) {
      throw new Error(
        "We started publishing this version but didn't get back a live link. Please try publishing again.",
      );
    }
  } catch (err) {
    await notifyUser({
      userId: project.owner_id,
      projectId: project.id,
      projectName: project.name,
      type: "deployment_failed",
    }).catch((notifyErr) => console.error("Failed to notify user of deploy failure", project.id, notifyErr));
    throw err;
  }

  // Best-effort: Vercel projects v0 creates have deployment protection
  // (Vercel Authentication) on by default, so the URL above isn't actually
  // publicly reachable until this is turned off — see vercel-api.ts. Never
  // fail the publish over this; the deployment itself genuinely succeeded.
  let publicWarning: string | undefined;
  try {
    const protectionResult = await disableDeploymentProtection(result.vercelProjectId);
    if (!protectionResult.disabled) {
      publicWarning =
        "Published — but this link may still ask visitors to sign in before we can confirm it. Try opening it yourself; contact support if that doesn't clear up.";
      console.error(
        "Could not disable deployment protection for",
        result.vercelProjectId,
        protectionResult.reason,
      );
    }
  } catch (err) {
    publicWarning =
      "Published — but this link may still ask visitors to sign in before we can confirm it. Try opening it yourself; contact support if that doesn't clear up.";
    console.error("Error disabling deployment protection", result.vercelProjectId, err);
  }

  const nowIso = new Date().toISOString();

  // Demote any previously-current production deployment before recording
  // the new one, so `is_current_production` never has two true rows.
  await supabase
    .from("deployments")
    .update({ is_current_production: false })
    .eq("project_id", project.id)
    .eq("is_current_production", true);

  const { data: deployment, error: deploymentError } = await supabase
    .from("deployments")
    .insert({
      project_id: project.id,
      vercel_deployment_id: result.deploymentId,
      target: "production",
      ready_state: "ready",
      url: result.url,
      is_current_production: true,
    })
    .select("id")
    .single();

  if (deploymentError || !deployment) {
    throw new Error("Deployed successfully, but couldn't save the deployment record.");
  }

  // production_deployment_id references our own deployments.id (an
  // internal uuid), not v0's external deployment id — that one lives on
  // deployments.vercel_deployment_id, matching the rest of the schema's
  // external-id-mapping pattern.
  await supabase
    .from("projects")
    .update({
      status: "live",
      production_deployment_id: deployment.id,
      production_url: result.url,
      last_activity_at: nowIso,
    })
    .eq("id", project.id);

  await notifyUser({
    userId: project.owner_id,
    projectId: project.id,
    projectName: project.name,
    type: "deployment_completed",
    payload: { url: result.url },
  }).catch((err) => console.error("Failed to notify user of deploy success", project.id, err));

  return { url: result.url, publicWarning };
}
