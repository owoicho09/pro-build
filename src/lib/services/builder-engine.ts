// Provider-agnostic seam over the underlying app-generation engine (v0
// today; conceptually replaceable by Claude Code/Codex/Vercel Sandbox
// later without rewriting project/build domain logic). Callers — server
// actions, the build orchestrator, the preview proxy — depend on this
// interface, never on the v0 SDK directly.
//
// Shape note: the installed v0-sdk (v0-sdk@0.16.x, the actual published
// package — not the chat-only API surface an earlier doc pass assumed)
// models a v0 "Project" as a distinct container above "chat": it holds
// shared environment variables and the Vercel project link, and a chat is
// assigned into one. So every builder-engine call after creation carries
// both an externalChatId and an externalProjectId.

export interface BuilderAttachment {
  /** Public URL or `data:` URI — the only attachment shape this API accepts. */
  url: string;
}

export interface BuilderUsage {
  totalCostUsd: number | null;
}

export type BuilderFinishReason =
  | "stop"
  | "length"
  | "content-filter"
  | "tool-calls"
  | "error"
  | "other"
  | null;

// Live-testing discovery (HavenRock acceptance test, a more complex prompt
// than earlier live tests): v0 can resolve a message with
// finishReason: "tool-calls" while `chat.files`/`chat.text` are still
// empty — this is NOT the terminal "the generation is done" signal the rest
// of this codebase originally assumed every non-null finishReason to be.
// Per AI SDK conventions (which v0's API mirrors), "tool-calls" means the
// model paused after invoking a tool — mid-turn, not finished. Only these
// reasons mean the message is actually done generating.
export function isTerminalFinishReason(
  reason: BuilderFinishReason,
): reason is Exclude<BuilderFinishReason, null | "tool-calls"> {
  return reason !== null && reason !== "tool-calls";
}

// Distinguishes "v0 itself is at capacity" from every other build failure,
// so build-orchestrator.ts can show "proBuild is busy right now, your
// request is saved" instead of a generic failure message (spec: never
// expose HTTP 429 / provider rate limit to normal users, but do
// differentiate provider capacity from the user's own plan/build limit).
// Verified against the installed v0-sdk's actual runtime, not just its
// .d.ts: on any non-2xx response it throws a plain `Error` shaped exactly
// like `HTTP ${status}: ${body}` (node_modules/v0-sdk/dist/index.js) — not
// a typed subclass — so v0-builder-engine.ts detects a 429 by matching
// that message shape and rethrows this instead.
export class BuilderCapacityError extends Error {
  constructor(
    message = "proBuild is at capacity right now. Your request is saved — try again shortly.",
  ) {
    super(message);
    this.name = "BuilderCapacityError";
  }
}

export interface BuilderResourceRef {
  externalChatId: string;
  externalProjectId: string;
}

export interface BuilderMessageHandle extends BuilderResourceRef {
  externalMessageId: string;
}

export interface BuilderMessageStatus extends BuilderMessageHandle {
  assistantText: string | null;
  finishReason: BuilderFinishReason;
  /** Only populated once finishReason is terminal (see isTerminalFinishReason) — no cost to report before then. */
  usage: BuilderUsage | null;
}

export interface BuilderFile {
  path: string;
  content: string;
}

export interface BuilderPreview {
  url: string;
  screenshotUrl: string | null;
}

export interface BuilderDeployResult {
  deploymentId: string;
  vercelProjectId: string;
  url: string | null;
}

export interface BuilderEnvVar {
  key: string;
  value: string;
}

export interface BuilderEngine {
  /** Starts a new project: creates the v0 Project container, then the first chat/message in it. */
  startProject(input: {
    name: string;
    prompt: string;
    attachments?: BuilderAttachment[];
  }): Promise<BuilderMessageHandle>;

  /** Continues an existing project with a follow-up instruction. */
  continueProject(input: {
    ref: BuilderResourceRef;
    prompt: string;
    attachments?: BuilderAttachment[];
  }): Promise<BuilderMessageHandle>;

  /** Polls a previously started/continued message for completion. */
  getMessageStatus(
    input: BuilderMessageHandle,
  ): Promise<BuilderMessageStatus>;

  /** Current generated file snapshot for a project. */
  getFiles(input: BuilderResourceRef): Promise<BuilderFile[]>;

  /** Live preview URL for the current version — must be proxied server-side, never exposed directly to the browser. */
  getPreview(input: BuilderResourceRef): Promise<BuilderPreview | null>;

  /** Deploys the current snapshot; creates/links the Vercel project on first use. */
  deploy(input: BuilderResourceRef): Promise<BuilderDeployResult>;

  /** The linked Vercel project id, if this project has been deployed at least once — null otherwise. */
  getVercelProjectId(externalProjectId: string): Promise<string | null>;

  /**
   * Sets environment variables on the v0 Project so both the generator and
   * the deployed app can see them. Values must never appear in a chat
   * message/prompt — this is the only sanctioned path for secrets to reach
   * the builder.
   */
  setEnvVars(input: {
    externalProjectId: string;
    vars: BuilderEnvVar[];
  }): Promise<void>;
}
