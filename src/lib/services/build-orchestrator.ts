import "server-only";
import { after } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/db";
import {
  builds,
  messages,
  projects,
  usageEvents,
  creditLedger,
  projectIntegrations,
} from "@/db/schema";
import type { Database } from "@/db/types";
import { getBuilderEngine } from "@/lib/services";
import { isTerminalFinishReason, BuilderCapacityError } from "@/lib/services/builder-engine";
import { toSafeMessage } from "@/lib/utils/external-provider-error";
import { usdToCredits } from "@/lib/config/credits";
import { resolveAttachmentsForBuilder } from "@/lib/services/attachments";
import { checkBuildAllowance } from "@/lib/services/usage";
import { notifyUser } from "@/lib/services/notifications";
import { captureAndStoreScreenshot } from "@/lib/services/screenshot";

// A build that has been failing every status check for this long is treated
// as stuck rather than transient — see the try/catch in advanceBuild().
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Trigger side — runs inside a user-authenticated server action, so it uses
// the RLS-respecting Supabase client. This is the only place a build gets
// created.
// ---------------------------------------------------------------------------

// Postgres unique_violation — see the `builds_one_active_per_project`
// partial unique index in schema.ts.
const UNIQUE_VIOLATION = "23505";

const ALREADY_IN_PROGRESS_MESSAGE =
  "A build is already in progress for this project. Wait for it to finish before sending another change.";

export async function startOrContinueBuild(
  supabase: SupabaseClient<Database>,
  input: { projectId: string; prompt: string; attachmentIds?: string[] },
): Promise<{ buildId: string }> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", input.projectId)
    .single();

  if (projectError || !project) {
    throw new Error("Project not found.");
  }

  const allowance = await checkBuildAllowance(supabase, {
    userId: project.owner_id,
    projectId: project.id,
  });
  if (!allowance.allowed) {
    throw new Error(allowance.reason);
  }

  // Fast pre-check for a friendly early exit — not the real guarantee. Two
  // requests racing this close together could both pass it (live-testing
  // found exactly this: two tabs submitting near-simultaneously both got
  // past a check-then-insert guard here). The `builds_one_active_per_project`
  // partial unique index below is the actual guarantee; this just avoids
  // unnecessary work in the common, non-racing case.
  const { data: activeBuild } = await supabase
    .from("builds")
    .select("id")
    .eq("project_id", project.id)
    .in("state", ["queued", "streaming"])
    .limit(1)
    .maybeSingle();

  if (activeBuild) {
    throw new Error(ALREADY_IN_PROGRESS_MESSAGE);
  }

  const { data: userMessage, error: messageError } = await supabase
    .from("messages")
    .insert({ project_id: project.id, role: "user", content: input.prompt })
    .select("id")
    .single();

  if (messageError || !userMessage) {
    throw new Error("Couldn't save your message. Please try again.");
  }

  // Insert the build row BEFORE calling the builder, not after. Live
  // testing found that when the v0 call hung, no build row ever existed to
  // show it — the user message just sat there with no visible state, even
  // after a reload. Creating it first, in "queued", means every attempt is
  // durably recorded and closes most of the race window against the
  // partial unique index (the real guarantee, not the pre-check above).
  const { data: build, error: buildError } = await supabase
    .from("builds")
    .insert({
      project_id: project.id,
      trigger_message_id: userMessage.id,
      state: "queued",
    })
    .select("id")
    .single();

  if (buildError?.code === UNIQUE_VIOLATION) {
    throw new Error(ALREADY_IN_PROGRESS_MESSAGE);
  }
  if (buildError || !build) {
    throw new Error("Couldn't start the build. Please try again.");
  }

  // Everything from here down is genuinely slow (attachment resolution
  // makes Storage signed-URL calls; the builder kickoff itself is the
  // dominant, highly variable latency — bounded at KICKOFF_TIMEOUT_MS,
  // "a few seconds" typically) and none of it needs to finish before the
  // caller returns: the message and a durable "queued" build row already
  // exist, so a refresh/reopen during this window still shows correct
  // state (workspace.tsx's polling picks it up once v0_message_id lands).
  // `after()` runs this once the response has already been sent — this is
  // the fix for "Sending..." blocking on v0's latency instead of just the
  // fast DB writes above.
  after(async () => {
    try {
      const { builderAttachments, skipped } = await resolveAttachmentsForBuilder(supabase, {
        attachmentIds: input.attachmentIds ?? [],
        messageId: userMessage.id,
      });

      if (skipped.length > 0) {
        await supabase.from("messages").insert({
          project_id: project.id,
          role: "system",
          content: `Couldn't use ${skipped.join(", ")} — that file type isn't supported yet. Everything else in your message was sent.`,
        });
      }

      const engine = getBuilderEngine();
      const handle =
        project.v0_chat_id && project.v0_project_id
          ? await engine.continueProject({
              ref: {
                externalProjectId: project.v0_project_id,
                externalChatId: project.v0_chat_id,
              },
              prompt: input.prompt,
              attachments: builderAttachments,
            })
          : await engine.startProject({
              name: project.name,
              prompt: input.prompt,
              attachments: builderAttachments,
            });

      await supabase
        .from("projects")
        .update({
          v0_project_id: handle.externalProjectId,
          v0_chat_id: handle.externalChatId,
          status: "building",
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", project.id);

      await supabase
        .from("builds")
        .update({ v0_message_id: handle.externalMessageId })
        .eq("id", build.id);
    } catch (err) {
      // The project's own status is left untouched here on purpose — if it
      // already had a working preview, a failed follow-up kickoff shouldn't
      // regress it. Only this specific build attempt is marked failed.
      // error_code distinguishes "v0 is at capacity" (transient, safe to
      // retry shortly) from every other kickoff failure, so the UI can show
      // different copy for each rather than one generic failure message.
      // error_message is rendered UNGUARDED in workspace.tsx (no allowlist,
      // unlike sendProjectMessage's inline error) — toSafeMessage is the
      // only thing standing between a raw provider error and that bubble,
      // so every write to this column must go through it.
      console.error("Deferred build kickoff failed", build.id, err);
      await supabase
        .from("builds")
        .update({
          state: "failed",
          error_code: err instanceof BuilderCapacityError ? "provider_capacity" : null,
          error_message: toSafeMessage(
            err,
            "That change failed to build. Your project is unaffected — try rephrasing it.",
          ),
          finished_at: new Date().toISOString(),
        })
        .eq("id", build.id);
    }
  });

  return { buildId: build.id };
}

// ---------------------------------------------------------------------------
// Advance side — no signed-in user (called from a cron route and, for local
// dev before real cron infra is wired up, directly from client polling), so
// it uses the trusted direct-Postgres Drizzle client. Ownership isn't
// re-checked here because nothing here is scoped by caller identity — it
// just moves a specific build forward by id.
// ---------------------------------------------------------------------------

// Shared terminal-failure path for a build that's been unresolved (no
// definitive outcome from v0) for longer than STUCK_THRESHOLD_MS — used
// both when the status check itself keeps throwing, and when it keeps
// succeeding but never reports a real terminal finishReason (see
// isTerminalFinishReason; the HavenRock acceptance test live-caught this
// second case: v0 returned finishReason: "tool-calls" with zero files/text
// and never progressed further).
async function markBuildStuck(
  buildId: string,
  project: { id: string; ownerId: string; name: string },
  errorMessage: string,
): Promise<void> {
  await db
    .update(builds)
    .set({ state: "failed", errorMessage, finishedAt: new Date() })
    .where(eq(builds.id, buildId));
  await db
    .update(projects)
    .set({ status: "failed", lastActivityAt: new Date() })
    .where(eq(projects.id, project.id));
  await notifyUser({
    userId: project.ownerId,
    projectId: project.id,
    projectName: project.name,
    type: "build_failed",
  }).catch((notifyErr) => console.error("Failed to notify user of stuck build", buildId, notifyErr));
}

export async function advanceBuild(buildId: string): Promise<void> {
  const build = await db.query.builds.findFirst({
    where: eq(builds.id, buildId),
  });

  if (!build || build.state === "succeeded" || build.state === "failed" || build.state === "stopped") {
    return;
  }

  if (!build.v0MessageId) {
    return;
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, build.projectId),
  });

  if (!project?.v0ChatId || !project.v0ProjectId) {
    return;
  }

  const engine = getBuilderEngine();
  let status: Awaited<ReturnType<typeof engine.getMessageStatus>>;
  try {
    status = await engine.getMessageStatus({
      externalProjectId: project.v0ProjectId,
      externalChatId: project.v0ChatId,
      externalMessageId: build.v0MessageId,
    });
  } catch (err) {
    // A single failed poll is often transient (network blip, v0 timeout) —
    // don't fail the build over one bad check, the next poll (client or
    // cron, a few seconds out) will likely succeed. But don't retry forever
    // either: past STUCK_THRESHOLD_MS, treat repeated failure as terminal
    // so the build doesn't poll indefinitely with no visible outcome —
    // exactly the silent-hang failure mode live testing surfaced.
    console.error("Status check failed for build", buildId, err);
    const ageMs = Date.now() - build.startedAt.getTime();
    if (ageMs < STUCK_THRESHOLD_MS) {
      return;
    }
    await markBuildStuck(
      buildId,
      project,
      toSafeMessage(err, "The builder stopped responding while generating this change."),
    );
    return;
  }

  if (!isTerminalFinishReason(status.finishReason)) {
    if (build.state === "queued") {
      await db.update(builds).set({ state: "streaming" }).where(eq(builds.id, buildId));
    }
    // A response that keeps resolving with a non-terminal finishReason
    // (null, or "tool-calls" — see isTerminalFinishReason) forever is the
    // same "no real outcome" failure mode as the exception branch above,
    // just without ever throwing. Age it out the same way instead of
    // polling indefinitely.
    const ageMs = Date.now() - build.startedAt.getTime();
    if (ageMs >= STUCK_THRESHOLD_MS) {
      await markBuildStuck(
        buildId,
        project,
        "The builder didn't finish generating this change in a reasonable time.",
      );
    }
    return;
  }

  const succeeded = status.finishReason !== "error";
  const creditsCost = status.usage ? usdToCredits(status.usage.totalCostUsd ?? 0) : null;

  // Spec: a project with an unconfigured integration still reaches a usable
  // preview — it just needs a visible nudge (dashboard/workspace status)
  // rather than looking indistinguishable from a fully-finished project.
  const hasUnconfiguredIntegration = succeeded
    ? await db.query.projectIntegrations
        .findFirst({
          where: (fields, { and: andOp, eq: eqOp }) =>
            andOp(eqOp(fields.projectId, build.projectId), eqOp(fields.status, "not_configured")),
        })
        .then((row) => Boolean(row))
    : false;

  // Fetched outside the transaction since it's an external API call, not a
  // DB operation — best-effort only, a preview is never worth failing the
  // build finalization over. previewUrl is the fix for the "No preview yet
  // after reopening" bug: it's now durably written here instead of only
  // ever being fetched live (and unreliably) on each page load — see
  // projects.previewUrl's comment in schema.ts.
  //
  // The project THUMBNAIL is deliberately NOT sourced from this call (or
  // from v0 at all) — see the screenshot-capture block below, after the
  // transaction. v0's own `screenshotUrl` here is the same family of
  // signed, short-lived link as `previewUrl`, and was the actual root
  // cause of project cards going blank after a refresh/reopen: it isn't
  // durable, so persisting it directly just relocated the "preview" bug
  // onto project cards. Thumbnails and the interactive preview are
  // different resources with different lifecycles now.
  let previewUrl: string | null | undefined;
  if (succeeded) {
    try {
      const preview = await engine.getPreview({
        externalProjectId: project.v0ProjectId,
        externalChatId: project.v0ChatId,
      });
      previewUrl = preview?.url ?? undefined;
    } catch (err) {
      console.error("Failed to fetch preview for project", build.projectId, err);
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(builds)
      .set({
        state: succeeded ? "succeeded" : "failed",
        errorMessage: succeeded
          ? null
          : "The builder reported an error while generating this change.",
        creditsCost,
        finishedAt: new Date(),
      })
      .where(eq(builds.id, buildId));

    if (status.assistantText) {
      await tx.insert(messages).values({
        projectId: build.projectId,
        role: "assistant",
        content: status.assistantText,
        v0MessageId: status.externalMessageId,
      });
    }

    await tx
      .update(projects)
      .set({
        status: succeeded
          ? hasUnconfiguredIntegration
            ? "needs_attention"
            : "preview_ready"
          : "failed",
        lastActivityAt: new Date(),
        ...(previewUrl ? { previewUrl } : {}),
      })
      .where(eq(projects.id, build.projectId));

    if (creditsCost !== null) {
      await tx.insert(usageEvents).values({
        projectId: build.projectId,
        userId: project.ownerId,
        buildId: build.id,
        creditsCost,
        eventType: "build_generation",
      });

      const [{ balance } = { balance: 0 }] = await tx
        .select({ balance: creditLedger.balanceAfter })
        .from(creditLedger)
        .where(eq(creditLedger.userId, project.ownerId))
        .orderBy(desc(creditLedger.createdAt))
        .limit(1);

      await tx.insert(creditLedger).values({
        userId: project.ownerId,
        projectId: build.projectId,
        delta: -creditsCost,
        balanceAfter: balance - creditsCost,
        reason: "build_debit",
        referenceId: build.id,
      });
    }
  });

  // Thumbnail capture is deliberately deferred and decoupled from the
  // transaction above — it's a real browser navigation + screenshot, not a
  // DB write, and can take anywhere from a couple of seconds to tens of
  // seconds depending on how long the generated site takes to actually
  // render (see screenshot.ts). The build has already fully "succeeded" the
  // moment the transaction commits; a slow or failed screenshot must never
  // hold that up, and per screenshot.ts's contract (it throws, never
  // returns a partial/placeholder result) a failure here leaves
  // `thumbnail_url` completely untouched — the previous successful
  // thumbnail stays exactly as it was.
  if (succeeded && previewUrl) {
    const capturedProjectId = build.projectId;
    const capturedPreviewUrl = previewUrl;
    after(async () => {
      try {
        const thumbnailUrl = await captureAndStoreScreenshot({
          previewUrl: capturedPreviewUrl,
          projectId: capturedProjectId,
        });
        await db.update(projects).set({ thumbnailUrl }).where(eq(projects.id, capturedProjectId));
      } catch (err) {
        console.error("Screenshot capture failed for project", capturedProjectId, err);
      }
    });
  }

  await notifyUser({
    userId: project.ownerId,
    projectId: build.projectId,
    projectName: project.name,
    type: succeeded
      ? hasUnconfiguredIntegration
        ? "integration_attention"
        : "build_completed"
      : "build_failed",
  }).catch((err) => console.error("Failed to notify user of build outcome", build.id, err));
}

// v0's preview URL carries a signed token that doesn't survive being
// reused indefinitely (live-tested: even a "fresh" one only reliably works
// once). This does a live re-check against v0 and persists the result —
// used by both the manual "Refresh" button and the workspace's
// auto-refresh-on-mount (see preview-pane.tsx). Deliberately does NOT
// touch thumbnail_url: the interactive preview and the project-card
// thumbnail are different resources with different lifecycles now — see
// screenshot.ts for how the thumbnail is actually captured and stored.
export async function refreshProjectPreview(
  supabase: SupabaseClient<Database>,
  input: { projectId: string },
): Promise<{ previewUrl: string | null }> {
  const { data: project, error } = await supabase
    .from("projects")
    .select("v0_project_id, v0_chat_id")
    .eq("id", input.projectId)
    .single();

  if (error || !project) {
    throw new Error("Project not found.");
  }
  if (!project.v0_project_id || !project.v0_chat_id) {
    return { previewUrl: null };
  }

  const preview = await getBuilderEngine().getPreview({
    externalProjectId: project.v0_project_id,
    externalChatId: project.v0_chat_id,
  });

  await supabase
    .from("projects")
    .update({
      preview_url: preview?.url ?? null,
      preview_url_checked_at: new Date().toISOString(),
    })
    .eq("id", input.projectId);

  return { previewUrl: preview?.url ?? null };
}

export async function advancePendingBuilds(): Promise<{ advanced: number }> {
  const pending = await db.query.builds.findMany({
    where: inArray(builds.state, ["queued", "streaming"]),
  });

  for (const pendingBuild of pending) {
    await advanceBuild(pendingBuild.id);
  }

  return { advanced: pending.length };
}
