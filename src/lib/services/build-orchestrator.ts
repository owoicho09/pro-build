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
import { resolveAttachmentsForBuilder, linkAttachmentsToMessage } from "@/lib/services/attachments";
import { checkBuildAllowance, checkAndRecordRateLimit } from "@/lib/services/usage";
import { PREVIEW_REFRESH_RATE_LIMIT } from "@/lib/config/rate-limits";
import { notifyUser } from "@/lib/services/notifications";
import { captureAndStoreScreenshot } from "@/lib/services/screenshot";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_CONCURRENT_BUILDS, MAX_DISPATCH_ATTEMPTS } from "@/lib/config/concurrency";
import { validateRenderedStyling } from "@/lib/services/build-validation";

// Bounds the automatic "fix your own styling/runtime bug" loop (spec: "Use
// bounded retries only, e.g. max 2 repair attempts") — see the validation
// gate in advanceBuild() below.
const MAX_REPAIR_ATTEMPTS = 2;

// A build that has been failing every status check for this long is treated
// as stuck rather than transient — see the try/catch in advanceBuild().
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

// Bounded exponential backoff between dispatch retries after a provider
// (v0) capacity/429 response — spec §4E: "retry with bounded exponential
// backoff... never retry infinitely." Capped dispatchAttempts (see
// MAX_DISPATCH_ATTEMPTS) bounds the total retry count; this bounds the
// spacing between them so a 429 storm doesn't hammer v0 every few seconds
// via the workspace's own 3s poll.
const DISPATCH_BACKOFF_BASE_MS = 2000;
const DISPATCH_BACKOFF_MAX_MS = 60_000;

function dispatchBackoffMs(attempts: number): number {
  return Math.min(DISPATCH_BACKOFF_BASE_MS * 2 ** Math.max(attempts - 1, 0), DISPATCH_BACKOFF_MAX_MS);
}

// ---------------------------------------------------------------------------
// Trigger side — runs inside a user-authenticated server action, so it uses
// the RLS-respecting Supabase client. This is the only place a build gets
// created.
// ---------------------------------------------------------------------------

// Postgres unique_violation — see the `builds_one_active_per_project` /
// `builds_one_active_per_user` partial unique indexes in schema.ts.
const UNIQUE_VIOLATION = "23505";

const ALREADY_IN_PROGRESS_MESSAGE =
  "A build is already in progress for this project. Wait for it to finish before sending another change.";

const ALREADY_BUILDING_ELSEWHERE_MESSAGE =
  "You already have a build in progress on another project. Wait for it to finish before starting a new one.";

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

  // Same fast-pre-check-not-real-guarantee pattern as above, scoped to the
  // user across ALL of their projects (spec §4B: one active generation per
  // user) — `builds_one_active_per_user` below is the actual guarantee.
  const { data: activeBuildForUser } = await supabase
    .from("builds")
    .select("id")
    .eq("user_id", project.owner_id)
    .in("state", ["queued", "streaming"])
    .limit(1)
    .maybeSingle();

  if (activeBuildForUser) {
    throw new Error(ALREADY_BUILDING_ELSEWHERE_MESSAGE);
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
      user_id: project.owner_id,
      trigger_message_id: userMessage.id,
      state: "queued",
    })
    .select("id")
    .single();

  if (buildError?.code === UNIQUE_VIOLATION) {
    throw new Error(
      buildError.message.includes("builds_one_active_per_user")
        ? ALREADY_BUILDING_ELSEWHERE_MESSAGE
        : ALREADY_IN_PROGRESS_MESSAGE,
    );
  }
  if (buildError || !build) {
    throw new Error("Couldn't start the build. Please try again.");
  }

  // Durable and fast (no Storage calls yet, just a column update) — done
  // synchronously so a build's attachments are always resolvable later
  // purely from its trigger_message_id, regardless of whether dispatch
  // happens immediately below or, under load, minutes from now via the
  // cron-driven dispatch sweep (see dispatchBuild()). Best-effort: a
  // failure here just means attachments won't be found at dispatch time,
  // never worth failing the whole build over.
  if (input.attachmentIds?.length) {
    await linkAttachmentsToMessage(supabase, {
      attachmentIds: input.attachmentIds,
      messageId: userMessage.id,
    }).catch((err) => console.error("Failed to link attachments to message", userMessage.id, err));
  }

  // Set synchronously, not only inside dispatchBuild's after() callback —
  // otherwise a project list/dashboard card can briefly still show a
  // pre-build badge (Draft/Preview ready) for the few seconds before
  // dispatch actually runs, which is exactly the "vague Draft state while a
  // build is actually running" the spec calls out (§6). Safe even if
  // dispatch ends up queued rather than immediate: "Building" reads fine
  // either way from outside the workspace, which shows the finer-grained
  // queued/busy states itself (see workspace.tsx's BuildStatusCard).
  await supabase
    .from("projects")
    .update({ status: "building", last_activity_at: new Date().toISOString() })
    .eq("id", project.id);

  // Everything from here down is genuinely slow (attachment resolution
  // makes Storage signed-URL calls; the builder kickoff itself is the
  // dominant, highly variable latency — bounded at KICKOFF_TIMEOUT_MS,
  // "a few seconds" typically) and none of it needs to finish before the
  // caller returns: the message and a durable "queued" build row already
  // exist, so a refresh/reopen during this window still shows correct
  // state (workspace.tsx's polling picks it up once v0_message_id lands).
  // `after()` runs this once the response has already been sent — this is
  // the fix for "Sending..." blocking on v0's latency instead of just the
  // fast DB writes above. dispatchBuild() itself re-fetches everything it
  // needs by id (never trusts this closure's `project`/`input`), because
  // it's the same function the cron-driven dispatch sweep calls later for
  // builds that don't get a free concurrency slot immediately.
  after(async () => {
    try {
      await dispatchBuild(build.id);
    } catch (err) {
      console.error("Deferred dispatch threw unexpectedly", build.id, err);
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
// Sent as a normal continuation message on the SAME v0 chat (full context
// of its own prior code) — deliberately scoped to "find and fix the exact
// cause" rather than inviting a broader rewrite, per spec: "Do not blindly
// rewrite the whole project or styling stack." Modeled on a real precedent:
// a plain "find and fix that malformed class name" follow-up previously
// resolved this exact class of error on a different project.
function buildRepairPrompt(diagnosticDetail: string): string {
  return `Automated validation found a styling/runtime problem with the current version of this site: it rendered without its styling system properly applied.

Diagnostic detail captured from the live preview:
"${diagnosticDetail}"

Please find and fix the exact, smallest cause of this specific problem (for example: a malformed or concatenated Tailwind utility class, a missing CSS import, a broken PostCSS/Tailwind config, or an invalid import) without rewriting unrelated code, changing the design, or replacing the styling system.`;
}

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

// Sends a queued build's prompt to v0 for the first time — the actual
// "kickoff" work that startOrContinueBuild's after() block used to do
// inline. Pulled out on its own and made re-callable by (buildId) alone,
// using the service-role admin client rather than a request-scoped one,
// because it's now ALSO called from the cron-driven dispatch sweep
// (advanceBuild below, via advancePendingBuilds) for a build that didn't
// get a free MAX_CONCURRENT_BUILDS slot the first time — see spec §4C.
// Idempotent/self-guarding: safe to call repeatedly on the same build, and
// a no-op once it's already been dispatched or reached a terminal state.
export async function dispatchBuild(buildId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: build } = await admin.from("builds").select("*").eq("id", buildId).single();
  if (!build || build.state !== "queued" || build.dispatched_at) {
    return;
  }

  // Bounded exponential backoff between retries after a provider-capacity
  // error — only applies once there's been at least one prior attempt; a
  // build's very first dispatch attempt is never delayed by this.
  if (build.dispatch_attempts > 0 && build.last_dispatch_attempt_at) {
    const elapsedMs = Date.now() - new Date(build.last_dispatch_attempt_at).getTime();
    if (elapsedMs < dispatchBackoffMs(build.dispatch_attempts)) {
      return;
    }
  }

  // Global concurrency gate (spec §4C) — count builds that are actually
  // occupying a slot (already sent to v0), not just "queued" in the
  // broader sense that also includes builds waiting right here for a slot.
  const { count: activeDispatchedCount } = await admin
    .from("builds")
    .select("id", { count: "exact", head: true })
    .in("state", ["queued", "streaming"])
    .not("dispatched_at", "is", null);

  if ((activeDispatchedCount ?? 0) >= MAX_CONCURRENT_BUILDS) {
    // Stay queued — this doesn't count as a dispatch attempt (we never
    // actually called v0), so dispatch_attempts/backoff are untouched. The
    // next cron tick (or client poll, if the tab happens to be open) tries
    // again.
    return;
  }

  const { data: project } = await admin.from("projects").select("*").eq("id", build.project_id).single();
  if (!project) return;

  if (!build.trigger_message_id) {
    await admin
      .from("builds")
      .update({
        state: "failed",
        error_message: "This build has no associated message to send.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", buildId);
    return;
  }

  const { data: triggerMessage } = await admin
    .from("messages")
    .select("content")
    .eq("id", build.trigger_message_id)
    .single();
  if (!triggerMessage) return;

  const nowIso = new Date().toISOString();

  try {
    const { data: attachmentRows } = await admin
      .from("attachments")
      .select("id")
      .eq("message_id", build.trigger_message_id);

    const { builderAttachments, skipped } = await resolveAttachmentsForBuilder(admin, {
      attachmentIds: (attachmentRows ?? []).map((row) => row.id),
      messageId: build.trigger_message_id,
    });

    // Only worth telling the user once — every retry after the first
    // dispatch attempt would otherwise repeat the same notice.
    if (skipped.length > 0 && build.dispatch_attempts === 0) {
      await admin.from("messages").insert({
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
            prompt: triggerMessage.content,
            attachments: builderAttachments,
          })
        : await engine.startProject({
            name: project.name,
            prompt: triggerMessage.content,
            attachments: builderAttachments,
          });

    await admin
      .from("projects")
      .update({
        v0_project_id: handle.externalProjectId,
        v0_chat_id: handle.externalChatId,
        status: "building",
        last_activity_at: nowIso,
      })
      .eq("id", project.id);

    await admin
      .from("builds")
      .update({
        v0_message_id: handle.externalMessageId,
        dispatched_at: nowIso,
        last_dispatch_attempt_at: nowIso,
        error_code: null,
      })
      .eq("id", buildId);
  } catch (err) {
    // The project's own status is left untouched here on purpose — if it
    // already had a working preview, a failed follow-up kickoff shouldn't
    // regress it. Only this specific build attempt is marked failed.
    // error_message is rendered UNGUARDED in workspace.tsx (no allowlist,
    // unlike sendProjectMessage's inline error) — toSafeMessage is the
    // only thing standing between a raw provider error and that bubble,
    // so every write to this column must go through it.
    console.error("Dispatch failed for build", buildId, err);
    const attempts = build.dispatch_attempts + 1;

    if (err instanceof BuilderCapacityError && attempts < MAX_DISPATCH_ATTEMPTS) {
      // Stay queued and retry later (bounded — see dispatchBackoffMs above
      // and MAX_DISPATCH_ATTEMPTS) instead of failing outright. This is
      // the "Builder is busy. Your build will continue shortly." case
      // (spec §4E) — workspace.tsx renders it from error_code + state
      // still being "queued", not as a failure.
      await admin
        .from("builds")
        .update({ dispatch_attempts: attempts, last_dispatch_attempt_at: nowIso, error_code: "provider_capacity" })
        .eq("id", buildId);
      return;
    }

    await admin
      .from("builds")
      .update({
        state: "failed",
        error_code: err instanceof BuilderCapacityError ? "provider_capacity" : null,
        error_message: toSafeMessage(
          err,
          "That change failed to build. Your project is unaffected — try rephrasing it.",
        ),
        dispatch_attempts: attempts,
        last_dispatch_attempt_at: nowIso,
        finished_at: nowIso,
      })
      .eq("id", buildId);

    await notifyUser({
      userId: project.owner_id,
      projectId: project.id,
      projectName: project.name,
      type: "build_failed",
    }).catch((notifyErr) => console.error("Failed to notify user of dispatch failure", buildId, notifyErr));
  }
}

export async function advanceBuild(buildId: string): Promise<void> {
  const build = await db.query.builds.findFirst({
    where: eq(builds.id, buildId),
  });

  if (!build || build.state === "succeeded" || build.state === "failed" || build.state === "stopped") {
    return;
  }

  if (!build.v0MessageId) {
    // Not dispatched yet — either still waiting for a free
    // MAX_CONCURRENT_BUILDS slot, or backing off after a provider-capacity
    // error (see dispatchBuild's backoff gate, which no-ops if it's not
    // time to retry yet). Nothing else to check until it has a message id.
    await dispatchBuild(buildId);
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

  // Post-build validation gate: v0 reporting a terminal, non-error
  // finishReason only means generation finished — it says nothing about
  // whether the actual rendered page works. Confirmed live: a project can
  // compile and open while its styling system silently fails to apply
  // (v0's own preview-time Tailwind engine threw a runtime error on
  // correctly-formed source CSS). A build must never be marked "succeeded"
  // without actually opening the rendered preview and checking it. Skipped
  // when there's no previewUrl to check — that's an existing, separate
  // best-effort degrade path (see the comment above), not something this
  // gate should block on.
  if (succeeded && previewUrl) {
    const validation = await validateRenderedStyling(previewUrl).catch((err) => {
      // The validator itself failing (e.g. a Chromium launch problem) is
      // never grounds to fail a build that v0 genuinely reported as
      // successful — that would make infrastructure flakiness look like a
      // generation failure. Best-effort: treat as passed.
      console.error("Style validation threw for build", buildId, err);
      return { passed: true } as const;
    });

    if (!validation.passed) {
      if (build.repairAttempts < MAX_REPAIR_ATTEMPTS) {
        try {
          const repairHandle = await engine.continueProject({
            ref: { externalProjectId: project.v0ProjectId, externalChatId: project.v0ChatId },
            prompt: buildRepairPrompt(validation.diagnosticDetail ?? validation.reason ?? "unknown styling failure"),
          });

          if (status.assistantText) {
            await db.insert(messages).values({
              projectId: build.projectId,
              role: "assistant",
              content: status.assistantText,
              v0MessageId: status.externalMessageId,
            });
          }
          await db.insert(messages).values({
            projectId: build.projectId,
            role: "system",
            content:
              "Automated checks found a styling problem with this version — retrying automatically to fix it.",
          });

          await db
            .update(builds)
            .set({
              state: "streaming",
              v0MessageId: repairHandle.externalMessageId,
              repairAttempts: build.repairAttempts + 1,
              validationError: validation.diagnosticDetail ?? validation.reason ?? null,
            })
            .where(eq(builds.id, buildId));
        } catch (err) {
          if (err instanceof BuilderCapacityError) {
            // Transient — leave everything untouched, the next poll tick
            // re-resolves the same terminal status and retries this same
            // repair attempt (same "one bad tick isn't fatal" philosophy
            // as the status-check catch above).
            console.error("Repair dispatch hit provider capacity for build", buildId, err);
            return;
          }
          console.error("Failed to send repair message for build", buildId, err);
          await markBuildStuck(
            buildId,
            project,
            toSafeMessage(err, "We found a styling problem but couldn't send the automatic fix. Please try again."),
          );
        }
        return;
      }

      // Repair attempts exhausted — this must never be marked "succeeded".
      // Credits are still charged for the real v0 usage this resolution
      // incurred, same as any other terminal build (see the transaction
      // below) — only the interim repair-triggering generations go
      // unbilled, a deliberate, conservative simplification.
      await db.transaction(async (tx) => {
        await tx
          .update(builds)
          .set({
            state: "failed",
            errorCode: "styling_validation_failed",
            errorMessage:
              "We generated this site, but automated checks found the styling didn't load correctly, and automatic repair attempts didn't resolve it. Your project and its code are preserved — try describing the specific visual problem, or contact support.",
            validationError: validation.diagnosticDetail ?? validation.reason ?? null,
            creditsCost,
            finishedAt: new Date(),
          })
          .where(eq(builds.id, buildId));

        await tx
          .update(projects)
          .set({ status: "failed", lastActivityAt: new Date() })
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

      await notifyUser({
        userId: project.ownerId,
        projectId: build.projectId,
        projectName: project.name,
        type: "build_failed",
      }).catch((err) => console.error("Failed to notify user of validation failure", build.id, err));

      return;
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
    .select("owner_id, v0_project_id, v0_chat_id")
    .eq("id", input.projectId)
    .single();

  if (error || !project) {
    throw new Error("Project not found.");
  }
  if (!project.v0_project_id || !project.v0_chat_id) {
    return { previewUrl: null };
  }

  const rateLimit = await checkAndRecordRateLimit(supabase, {
    userId: project.owner_id,
    action: "preview_refresh",
    ...PREVIEW_REFRESH_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    throw new Error(rateLimit.reason);
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
