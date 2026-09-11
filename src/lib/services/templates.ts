import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";
import { startOrContinueBuild } from "@/lib/services/build-orchestrator";
import { detectAndRecordIntegrations } from "@/lib/services/integrations";
import { checkProjectCapacity } from "@/lib/services/usage";
import { toSafeMessage } from "@/lib/utils/external-provider-error";

type Template = Database["public"]["Tables"]["templates"]["Row"];

export async function listPublishedTemplates(
  supabase: SupabaseClient<Database>,
): Promise<Template[]> {
  const { data } = await supabase
    .from("templates")
    .select("*")
    .eq("is_published", true)
    .order("sort_order", { ascending: true });
  return data ?? [];
}

export async function getTemplateBySlug(
  supabase: SupabaseClient<Database>,
  slug: string,
): Promise<Template | null> {
  const { data } = await supabase
    .from("templates")
    .select("*")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  return data ?? null;
}

// Entitlement seam (spec: "is this user entitled to use this template?",
// not `if (plan === "pro")`). Every template is free today, so this always
// returns true — the point is that call sites already ask the right
// question, so plan-gated/purchased templates can land later without
// touching them.
export function isUserEntitledToTemplate(_userId: string, _template: Template): boolean {
  return true;
}

// "Use Template" clones the template's authored build_prompt into a new,
// independent, user-owned project by replaying it through the same
// startOrContinueBuild() every other build goes through (Option A — see
// schema.ts's templates table comment for why this was chosen over forking
// the v0 chat directly). Later edits to the template never touch projects
// already cloned from it, since only the prompt text and a provenance
// pointer are copied, not a live reference.
export async function cloneProjectFromTemplate(
  supabase: SupabaseClient<Database>,
  input: { userId: string; template: Template },
): Promise<{ projectId: string }> {
  const { template, userId } = input;

  const capacity = await checkProjectCapacity(supabase, userId);
  if (!capacity.allowed) {
    throw new Error(capacity.reason);
  }

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      owner_id: userId,
      name: template.name,
      description: template.build_prompt,
      status: "draft",
      template_id: template.id,
    })
    .select("id")
    .single();

  if (error || !project) {
    throw new Error("Couldn't create the project. Please try again.");
  }

  // Mirrors createProject()'s error handling in projects/new/actions.ts —
  // the project row exists either way, with a clear explanation rather
  // than losing the user's click to a crashed request.
  try {
    await detectAndRecordIntegrations(supabase, {
      projectId: project.id,
      promptText: template.build_prompt,
    }).catch((err) => console.error("Integration detection failed", project.id, err));

    await startOrContinueBuild(supabase, {
      projectId: project.id,
      prompt: template.build_prompt,
    });

    // Best-effort, approximate counter for display only (spec: "usage
    // metadata") — not billing-relevant, so a non-atomic increment racing
    // under concurrent clones is an acceptable trade-off against needing a
    // dedicated RPC for one display number.
    await supabase
      .from("templates")
      .update({ uses_count: template.uses_count + 1 })
      .eq("id", template.id);
  } catch (err) {
    await supabase.from("projects").update({ status: "failed" }).eq("id", project.id);
    await supabase.from("messages").insert({
      project_id: project.id,
      role: "system",
      content: toSafeMessage(
        err,
        "The builder is temporarily unavailable. Your project is safe — try again shortly.",
      ),
    });
    console.error("Failed to start build for templated project", project.id, err);
  }

  return { projectId: project.id };
}
