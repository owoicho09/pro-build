"use client";

import { useActionState, useEffect, useMemo, useOptimistic, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Image as ImageIcon, File as FileIcon, Paperclip, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { AttachmentPicker } from "@/components/attachment-picker";
import { PreviewPane } from "@/components/workspace/preview-pane";
import { handleComposerKeyDown } from "@/lib/composer-keydown";
import {
  DEFAULT_BUILD_WIDTH_PCT,
  MIN_BUILD_WIDTH_PCT,
  MAX_BUILD_WIDTH_PCT,
  readBuildWidthPct,
  writeBuildWidthPct,
} from "@/lib/workspace-split-prefs";
import { cn } from "@/lib/utils";
import type { Database } from "@/db/types";
import { sendProjectMessage, pollBuildStatus } from "./actions";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Message = Database["public"]["Tables"]["messages"]["Row"];
type Build = Database["public"]["Tables"]["builds"]["Row"];
type Attachment = Database["public"]["Tables"]["attachments"]["Row"];

// The client-only echo of a just-submitted message, shown instantly via
// useOptimistic while the server action persists it for real. Never
// written anywhere — purely a rendering aid, discarded once the
// transition settles and router.refresh() hands back the real row.
type WorkspaceMessage = Message & { pendingAttachmentNames?: string[] };

const ATTACHMENT_ICON = {
  image: ImageIcon,
  document: FileText,
  other: FileIcon,
};

const IN_PROGRESS_STATES: Build["state"][] = ["queued", "streaming"];
const LONG_BUILD_THRESHOLD_MS = 90_000;

type StepStatus = "done" | "current" | "pending";

function BuildStep({ label, status }: { label: string; status: StepStatus }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
          status === "done" && "bg-brand text-brand-foreground",
          status === "current" && "border-2 border-brand",
          status === "pending" && "border border-border",
        )}
      >
        {status === "done" && <Check className="h-2.5 w-2.5" />}
        {status === "current" && <span className="h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse" />}
      </span>
      <span className={cn("text-sm", status === "pending" ? "text-muted-foreground/70" : "text-foreground")}>
        {label}
      </span>
    </div>
  );
}

// Only two real backend states exist while a build is in progress (queued,
// streaming) — the three rows below map to that real distinction rather
// than inventing fake granularity/percentages the backend can't back up.
function BuildStatusCard({
  buildState,
  longRunningNotice,
}: {
  buildState: "sending" | Build["state"];
  longRunningNotice: string | null;
}) {
  const steps: { label: string; status: StepStatus }[] = [
    { label: "Request received", status: buildState === "sending" ? "current" : "done" },
    {
      label: "Working on your project",
      status: buildState === "sending" ? "pending" : buildState === "queued" ? "current" : "done",
    },
    {
      label: "Preparing preview",
      status: buildState === "streaming" ? "current" : "pending",
    },
  ];

  return (
    <div className="mr-auto max-w-[85%] space-y-2.5 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <p className="text-sm font-medium">Building your project</p>
      <div className="space-y-1.5">
        {steps.map((step) => (
          <BuildStep key={step.label} label={step.label} status={step.status} />
        ))}
      </div>
      {longRunningNotice && <p className="text-xs text-muted-foreground">{longRunningNotice}</p>}
    </div>
  );
}

export function Workspace({
  project,
  initialMessages,
  initialBuild,
  attachments,
  previewUrl,
}: {
  project: Project;
  initialMessages: Message[];
  initialBuild: Build | null;
  attachments: Attachment[];
  previewUrl: string | null;
}) {
  const router = useRouter();
  const attachmentsByMessage = useMemo(() => {
    const map = new Map<string, Attachment[]>();
    for (const attachment of attachments) {
      if (!attachment.message_id) continue;
      const existing = map.get(attachment.message_id) ?? [];
      existing.push(attachment);
      map.set(attachment.message_id, existing);
    }
    return map;
  }, [attachments]);
  const [build, setBuild] = useState(initialBuild);
  // Resets local build state when the server hands us a fresh initialBuild
  // (after router.refresh()) — done during render, not in an effect, so it
  // doesn't trigger an extra cascading render.
  const [syncedInitialBuild, setSyncedInitialBuild] = useState(initialBuild);
  if (initialBuild !== syncedInitialBuild) {
    setSyncedInitialBuild(initialBuild);
    setBuild(initialBuild);
  }
  const [optimisticMessages, addOptimisticMessage] = useOptimistic<WorkspaceMessage[], WorkspaceMessage>(
    initialMessages,
    (state, message) => [...state, message],
  );
  const [sendState, sendAction, pending] = useActionState(sendProjectMessage, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [attachmentPickerKey, setAttachmentPickerKey] = useState(0);
  // Same render-time-sync pattern as build state above: bump the picker's
  // remount key as soon as a send succeeds, without a setState-in-effect.
  const [syncedSendState, setSyncedSendState] = useState(sendState);
  if (sendState !== syncedSendState) {
    setSyncedSendState(sendState);
    if (sendState?.success) {
      setAttachmentPickerKey((key) => key + 1);
    }
  }
  // `pending` (from useActionState) becomes true the instant the form
  // submits — folding it in here means the "in progress" UI (disabled
  // composer, building bubble) appears immediately on click, not only once
  // the server confirms a real "queued" build row a moment later. Now that
  // startOrContinueBuild defers the actual v0 kickoff via after(), `pending`
  // only spans the fast DB-write round trip, not v0's latency.
  const inProgress = pending || (build ? IN_PROGRESS_STATES.includes(build.state) : false);
  // Mobile shows one pane at a time (spec §44) — both panes stay mounted
  // (just hidden) so polling/scroll position aren't lost switching modes.
  const [mobileMode, setMobileMode] = useState<"build" | "preview">("build");

  // Desktop/tablet resizable split (target ~32-38% for Build) — starts at
  // the default (matches SSR) and is corrected once from localStorage after
  // mount, same trade-off as the sidebar's collapse preference: a saved
  // non-default width can cause one brief adjustment on a hard reload,
  // never on client-side navigation.
  const [buildWidthPct, setBuildWidthPct] = useState(DEFAULT_BUILD_WIDTH_PCT);
  const [isDragging, setIsDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = readBuildWidthPct();
    if (saved !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a persisted preference that's inherently unknowable during render/SSR
      setBuildWidthPct(saved);
    }
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    function onMove(e: MouseEvent) {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setBuildWidthPct(Math.min(MAX_BUILD_WIDTH_PCT, Math.max(MIN_BUILD_WIDTH_PCT, pct)));
    }
    function onUp() {
      setIsDragging(false);
      setBuildWidthPct((pct) => {
        writeBuildWidthPct(pct);
        return pct;
      });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  // Truthful, non-fake-percentage build copy (spec: no invented steps/%).
  // Ticks every 5s only while a build is actually in progress, so we can
  // surface "this is taking longer than usual" instead of staying silent.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!inProgress) return;
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, [inProgress]);

  // Drives the structured BuildStatusCard below — covers the brief window
  // between clicking Send and the fast DB-write round trip confirming a
  // real "queued" row via the synthetic "sending" state, distinct from
  // both real backend states.
  const displayBuildState = useMemo<"sending" | Build["state"] | null>(() => {
    if (pending && !(build && IN_PROGRESS_STATES.includes(build.state))) {
      return "sending";
    }
    if (!build || !IN_PROGRESS_STATES.includes(build.state)) return null;
    return build.state;
  }, [build, pending]);

  const longRunningNotice = useMemo(() => {
    if (!build || displayBuildState === "sending" || displayBuildState === null) return null;
    const elapsedMs = now - new Date(build.started_at).getTime();
    if (elapsedMs > LONG_BUILD_THRESHOLD_MS) {
      return "This is taking longer than usual. You can leave this project and come back later.";
    }
    return null;
  }, [build, displayBuildState, now]);

  function handleSend(formData: FormData) {
    const prompt = formData.get("prompt");
    if (typeof prompt === "string" && prompt.trim().length > 0) {
      const pendingAttachmentNames = formData
        .getAll("attachments")
        .filter((entry): entry is File => entry instanceof File && entry.size > 0)
        .map((file) => file.name);
      addOptimisticMessage({
        id: `optimistic-${crypto.randomUUID()}`,
        project_id: project.id,
        role: "user",
        content: prompt,
        v0_message_id: null,
        created_at: new Date().toISOString(),
        pendingAttachmentNames,
      });
    }
    sendAction(formData);
  }

  // One-click recovery for a failed build (spec: "mark the optimistic
  // message/build with a recoverable failed state and Retry") — replays the
  // same trigger message's text through the identical send path. Scoped to
  // text only, not attachments: re-sending the original files would need
  // re-uploading them, which is meaningfully more complex than what a
  // "try that again" action needs to solve.
  function handleRetry(promptText: string) {
    const formData = new FormData();
    formData.set("projectId", project.id);
    formData.set("prompt", promptText);
    handleSend(formData);
  }

  const failedPrompt = useMemo(() => {
    if (build?.state !== "failed" || !build.trigger_message_id) return null;
    return optimisticMessages.find((m) => m.id === build.trigger_message_id)?.content ?? null;
  }, [build, optimisticMessages]);

  useEffect(() => {
    if (!build || !IN_PROGRESS_STATES.includes(build.state)) return;

    const interval = setInterval(async () => {
      const result = await pollBuildStatus(build.id);
      if (result.build) {
        setBuild(result.build);
        if (!IN_PROGRESS_STATES.includes(result.build.state)) {
          router.refresh();
        }
      }
    }, 3000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build?.id, build?.state]);

  useEffect(() => {
    if (!sendState) return;
    if (sendState.success) {
      formRef.current?.reset();
    }
    // Refresh on error too, not just success: build-orchestrator.ts documents
    // a real (if rare) race where the user message gets persisted right
    // before an "already in progress" error is thrown for the build itself —
    // without this, that persisted message would stay invisible (reverted by
    // useOptimistic, and initialMessages never resynced) until some later,
    // unrelated refresh happened to reveal it.
    router.refresh();
  }, [sendState, router]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex border-b border-border md:hidden">
        {(["build", "preview"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setMobileMode(mode)}
            aria-pressed={mobileMode === mode}
            className={cn(
              "flex-1 py-2 text-sm font-medium capitalize",
              mobileMode === mode
                ? "border-b-2 border-brand text-foreground"
                : "text-muted-foreground",
            )}
          >
            {mode}
          </button>
        ))}
      </div>
      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col md:flex-row">
      <section
        style={{ "--build-w": `${buildWidthPct}%` } as React.CSSProperties}
        className={cn(
          "min-h-0 flex-1 flex-col border-b border-border md:flex md:w-[var(--build-w)] md:flex-none md:border-b-0",
          mobileMode === "build" ? "flex" : "hidden",
        )}
      >
        <div role="log" aria-live="polite" className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {optimisticMessages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              proBuild is putting your first version together.
            </p>
          )}
          {optimisticMessages.map((message) => {
            if (message.role === "system") {
              return (
                <p
                  key={message.id}
                  className="mx-auto max-w-[90%] text-center text-xs text-muted-foreground"
                >
                  {message.content}
                </p>
              );
            }

            const messageAttachments = attachmentsByMessage.get(message.id) ?? [];
            const pendingAttachmentNames = message.pendingAttachmentNames ?? [];
            const isUser = message.role === "user";
            const isOptimistic = message.id.startsWith("optimistic-");

            return (
              <div key={message.id} className={isUser ? "ml-auto max-w-[80%]" : "mr-auto max-w-[85%]"}>
                <div
                  className={cn(
                    "rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                    isUser
                      ? "bg-brand text-brand-foreground"
                      : "border border-border bg-card text-foreground",
                    isOptimistic && "opacity-70",
                  )}
                >
                  {message.content}
                </div>
                {messageAttachments.length > 0 && (
                  <ul className={"mt-1.5 flex flex-wrap gap-1.5" + (isUser ? " justify-end" : "")}>
                    {messageAttachments.map((attachment) => {
                      const Icon = ATTACHMENT_ICON[attachment.kind];
                      return (
                        <li
                          key={attachment.id}
                          title={
                            attachment.included_in_builder
                              ? attachment.original_filename
                              : `${attachment.original_filename} (not used — unsupported file type)`
                          }
                          className={
                            "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs " +
                            (attachment.included_in_builder
                              ? "bg-border/60 text-muted-foreground"
                              : "bg-border/30 text-muted-foreground/60 line-through")
                          }
                        >
                          <Icon className="size-3" />
                          {attachment.original_filename}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {pendingAttachmentNames.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5 justify-end">
                    {pendingAttachmentNames.map((name) => (
                      <li
                        key={name}
                        className="flex items-center gap-1 rounded-full bg-border/60 px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        <Paperclip className="size-3" />
                        {name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {displayBuildState && (
            <BuildStatusCard buildState={displayBuildState} longRunningNotice={longRunningNotice} />
          )}
          {build?.state === "failed" && !pending && (
            <div
              role="alert"
              className={cn(
                "mr-auto max-w-[85%] space-y-2 rounded-2xl border px-4 py-3 text-sm shadow-sm",
                // Provider capacity is transient and not the user's fault —
                // shown as a calmer warning, not an alarming failure.
                build.error_code === "provider_capacity"
                  ? "border-warning/30 bg-warning/5 text-warning"
                  : "border-danger/30 bg-danger/5 text-danger",
              )}
            >
              <p className="font-medium text-foreground">
                {build.error_code === "provider_capacity"
                  ? "proBuild is busy right now."
                  : "We couldn't complete those changes."}
              </p>
              <p>
                {build.error_code === "provider_capacity"
                  ? "Your request is saved and can be retried."
                  : (build.error_message ?? "Your current project is safe. Try rephrasing your request.")}
              </p>
              {failedPrompt && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => handleRetry(failedPrompt)}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>

        <form
          ref={formRef}
          action={handleSend}
          className="m-3 space-y-2 rounded-2xl border border-border bg-card p-3 shadow-sm transition-shadow focus-within:shadow-md"
        >
          <input type="hidden" name="projectId" value={project.id} />
          <Textarea
            name="prompt"
            rows={2}
            required
            disabled={inProgress}
            aria-label="Describe the next change"
            onKeyDown={handleComposerKeyDown}
            placeholder="Describe the next change..."
            className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AttachmentPicker key={attachmentPickerKey} disabled={inProgress} />
              <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
                Enter to send · Shift+Enter for a new line
              </kbd>
            </div>
            <Button type="submit" disabled={inProgress} className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {pending ? "Sending..." : "Send"}
            </Button>
          </div>
        </form>
        {sendState?.error && (
          <p className="px-3 pb-3 text-sm text-danger" role="alert">
            {sendState.error}
          </p>
        )}
      </section>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the conversation panel"
        aria-valuenow={Math.round(buildWidthPct)}
        aria-valuemin={MIN_BUILD_WIDTH_PCT}
        aria-valuemax={MAX_BUILD_WIDTH_PCT}
        tabIndex={0}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const delta = e.key === "ArrowLeft" ? -2 : 2;
          setBuildWidthPct((pct) => {
            const next = Math.min(MAX_BUILD_WIDTH_PCT, Math.max(MIN_BUILD_WIDTH_PCT, pct + delta));
            writeBuildWidthPct(next);
            return next;
          });
        }}
        className={cn(
          "hidden w-1.5 shrink-0 cursor-col-resize border-r border-border bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand md:block",
          isDragging ? "bg-brand/40" : "hover:bg-brand/30",
        )}
      />

      <section className={cn("min-h-0 flex-1 md:flex", mobileMode === "preview" ? "flex" : "hidden")}>
        <PreviewPane projectId={project.id} previewUrl={previewUrl} inProgress={inProgress} title={project.name} />
      </section>
      </div>
    </div>
  );
}
