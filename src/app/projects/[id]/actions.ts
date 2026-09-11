"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { startOrContinueBuild, advanceBuild } from "@/lib/services/build-orchestrator";
import { uploadAttachmentsFromFormData } from "@/lib/services/attachments";
import { publishProject } from "@/lib/services/deploy-orchestrator";
import {
  detectAndRecordIntegrations,
  configureIntegration,
} from "@/lib/services/integrations";
import {
  connectDomain,
  checkDomainVerification,
  removeDomain,
} from "@/lib/services/domain-orchestrator";
import { toSafeMessage } from "@/lib/utils/external-provider-error";

const renameProjectSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1, "Give this project a name.").max(80, "Keep the name under 80 characters."),
});

// The project name is separate from the build prompt (see
// lib/project-name.ts) but the initial heuristic guess is still just a
// guess — this lets the user fix it without touching the conversation or
// the generated project itself.
export async function renameProjectAction(_prevState: unknown, formData: FormData) {
  const parsed = renameProjectSchema.safeParse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your session expired. Please sign in again." };
  }

  // RLS scopes this update to the caller's own projects — renaming a
  // project that isn't yours silently affects zero rows.
  const { error } = await supabase
    .from("projects")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.projectId);

  if (error) {
    console.error("Failed to rename project", parsed.data.projectId, error);
    return { error: "Couldn't rename this project. Please try again." };
  }

  return { success: true as const, name: parsed.data.name };
}

const sendMessageSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1, "Type a message first."),
});

const EXPECTED_ERRORS = [
  "A build is already in progress",
  "You're out of build credits",
  "You've hit this project's build limit",
  "proBuild is at capacity right now",
];

export async function sendProjectMessage(_prevState: unknown, formData: FormData) {
  const parsed = sendMessageSchema.safeParse({
    projectId: formData.get("projectId"),
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
    return { error: "Your session expired. Please sign in again." };
  }

  try {
    const attachmentIds = await uploadAttachmentsFromFormData(supabase, {
      ownerId: user.id,
      projectId: parsed.data.projectId,
      formData,
      fieldName: "attachments",
    });

    await detectAndRecordIntegrations(supabase, {
      projectId: parsed.data.projectId,
      promptText: parsed.data.prompt,
    }).catch((err) => console.error("Integration detection failed", parsed.data.projectId, err));

    await startOrContinueBuild(supabase, {
      projectId: parsed.data.projectId,
      prompt: parsed.data.prompt,
      attachmentIds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const expected = EXPECTED_ERRORS.some((prefix) => message.startsWith(prefix));
    console.error("Failed to continue build", parsed.data.projectId, err);
    return {
      error: expected
        ? message
        : "The builder is temporarily unavailable. Your project is safe — try again shortly.",
    };
  }

  return { success: true };
}

// Called by the workspace UI while a build is in progress, so progress
// shows up without waiting on the cron fallback. advanceBuild() itself runs
// on the trusted direct-Postgres connection with no ownership check, so we
// gate it here: only advance a build the RLS-scoped read proves the caller
// can already see.
export async function pollBuildStatus(buildId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your session expired. Please sign in again." };
  }

  const { data: existing } = await supabase
    .from("builds")
    .select("id")
    .eq("id", buildId)
    .single();

  if (!existing) {
    return { build: null };
  }

  await advanceBuild(buildId);

  const { data: build } = await supabase
    .from("builds")
    .select("*")
    .eq("id", buildId)
    .single();

  return { build: build ?? null };
}

export async function configureIntegrationAction(_prevState: unknown, formData: FormData) {
  const projectId = formData.get("projectId");
  const provider = formData.get("provider");
  if (typeof projectId !== "string" || typeof provider !== "string") {
    return { error: "Missing project or integration." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your session expired. Please sign in again." };
  }

  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("env:") && typeof value === "string") {
      values[key.slice("env:".length)] = value;
    }
  }

  try {
    await configureIntegration(supabase, { projectId, provider, values });
  } catch (err) {
    console.error("Failed to configure integration", projectId, provider, err);
    return {
      error: toSafeMessage(err, "Couldn't save this integration. Please try again."),
    };
  }

  return { success: true };
}

export async function connectDomainAction(_prevState: unknown, formData: FormData) {
  const projectId = formData.get("projectId");
  const domainName = formData.get("domainName");
  if (typeof projectId !== "string" || typeof domainName !== "string" || !domainName.trim()) {
    return { error: "Enter a domain name." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Your session expired. Please sign in again." };
  }

  try {
    await connectDomain(supabase, { projectId, domainName });
  } catch (err) {
    console.error("Failed to connect domain", projectId, domainName, err);
    return {
      error: toSafeMessage(err, "Couldn't connect that domain. Please try again."),
    };
  }

  return { success: true };
}

export async function verifyDomainAction(domainId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Your session expired. Please sign in again." };
  }

  try {
    const { reason } = await checkDomainVerification(supabase, { domainId });
    return { success: true as const, reason };
  } catch (err) {
    console.error("Failed to check domain verification", domainId, err);
    return {
      error: toSafeMessage(err, "Couldn't check verification. Please try again."),
    };
  }
}

export async function removeDomainAction(domainId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Your session expired. Please sign in again." };
  }

  try {
    await removeDomain(supabase, { domainId });
  } catch (err) {
    console.error("Failed to remove domain", domainId, err);
    return {
      error: toSafeMessage(err, "Couldn't remove that domain. Please try again."),
    };
  }

  return { success: true };
}

export async function publishProjectAction(_prevState: unknown, formData: FormData) {
  const projectId = formData.get("projectId");
  if (typeof projectId !== "string") {
    return { error: "Missing project." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your session expired. Please sign in again." };
  }

  try {
    const { url, publicWarning } = await publishProject(supabase, { projectId });
    return { success: true as const, url, warning: publicWarning };
  } catch (err) {
    console.error("Failed to publish project", projectId, err);
    return {
      error: toSafeMessage(
        err,
        "We couldn't publish this version. Your existing live version is unaffected.",
      ),
    };
  }
}
