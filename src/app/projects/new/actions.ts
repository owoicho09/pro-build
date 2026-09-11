"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { startOrContinueBuild } from "@/lib/services/build-orchestrator";
import { uploadAttachmentsFromFormData } from "@/lib/services/attachments";
import { detectAndRecordIntegrations } from "@/lib/services/integrations";
import { checkProjectCapacity } from "@/lib/services/usage";
import { toSafeMessage } from "@/lib/utils/external-provider-error";
import { deriveProjectName } from "@/lib/project-name";

const createProjectSchema = z.object({
  prompt: z.string().min(10, "Tell us a bit more about what you want to build."),
});

export async function createProject(_prevState: unknown, formData: FormData) {
  const parsed = createProjectSchema.safeParse({
    prompt: formData.get("prompt"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/projects/new");
  }

  const capacity = await checkProjectCapacity(supabase, user.id);
  if (!capacity.allowed) {
    return { error: capacity.reason };
  }

  const name = deriveProjectName(parsed.data.prompt);

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      owner_id: user.id,
      name,
      description: parsed.data.prompt,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !project) {
    return { error: "Couldn't create the project. Please try again." };
  }

  // The project row exists even if kicking off the build fails right here —
  // the user lands on a real project either way, with a clear explanation
  // rather than losing their idea to a crashed request (spec: a build
  // failure must not corrupt the project).
  try {
    const attachmentIds = await uploadAttachmentsFromFormData(supabase, {
      ownerId: user.id,
      projectId: project.id,
      formData,
      fieldName: "attachments",
    });

    // Best-effort and independent of the build itself — a detection miss
    // or failure here should never stop the build from starting.
    await detectAndRecordIntegrations(supabase, {
      projectId: project.id,
      promptText: parsed.data.prompt,
    }).catch((err) => console.error("Integration detection failed", project.id, err));

    await startOrContinueBuild(supabase, {
      projectId: project.id,
      prompt: parsed.data.prompt,
      attachmentIds,
    });
  } catch (err) {
    await supabase
      .from("projects")
      .update({ status: "failed" })
      .eq("id", project.id);
    // Visible in the workspace even after the redirect below — a "Failed"
    // badge with no explanation anywhere isn't a clean failure state.
    // System messages render unguarded in workspace.tsx, same as
    // builds.error_message — toSafeMessage is required here too.
    await supabase.from("messages").insert({
      project_id: project.id,
      role: "system",
      content: toSafeMessage(
        err,
        "The builder is temporarily unavailable. Your project is safe — try again shortly.",
      ),
    });
    console.error("Failed to start build for new project", project.id, err);
  }

  redirect(`/projects/${project.id}`);
}
