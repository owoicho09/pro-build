import "server-only";
import { createClient } from "v0-sdk";
import type {
  BuilderEngine,
  BuilderResourceRef,
  BuilderMessageHandle,
  BuilderMessageStatus,
  BuilderFile,
  BuilderPreview,
  BuilderDeployResult,
  BuilderEnvVar,
} from "./builder-engine";
import { isTerminalFinishReason, BuilderCapacityError } from "./builder-engine";
import { withTimeout } from "@/lib/utils/timeout";
import { ExternalProviderError } from "@/lib/utils/external-provider-error";
import { BUILDER_SYSTEM_PROMPT } from "@/lib/config/builder-system-prompt";

// See BuilderCapacityError's doc comment — this is the exact shape the
// installed v0-sdk throws for ANY non-2xx response (node_modules/v0-sdk/
// dist/index.js): `new Error(\`HTTP ${status}: ${body}\`)`, a plain Error
// carrying the provider's raw response text. Every SDK call below is
// wrapped so that shape never escapes this file un-translated — a 429
// becomes the friendly BuilderCapacityError, anything else becomes
// ExternalProviderError (masked to a generic fallback by toSafeMessage at
// whatever layer ultimately catches it, e.g. build-orchestrator.ts before
// writing builds.error_message, which workspace.tsx renders unguarded).
const RAW_HTTP_ERROR_PATTERN = /^HTTP \d+\b/;
const RATE_LIMIT_MESSAGE_PATTERN = /^HTTP 429\b/;

async function withSanitizedErrors<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof Error && RATE_LIMIT_MESSAGE_PATTERN.test(err.message)) {
      throw new BuilderCapacityError();
    }
    if (err instanceof Error && RAW_HTTP_ERROR_PATTERN.test(err.message)) {
      throw new ExternalProviderError(err.message);
    }
    throw err;
  }
}

function client() {
  const apiKey = process.env.V0_API_KEY;
  if (!apiKey) {
    throw new Error("The builder isn't configured yet. Please try again later.");
  }
  return createClient({ apiKey });
}

// `chats.create`/`sendMessage` are typed to return `ChatDetail | ReadableStream`
// because the same method also serves `responseMode: 'experimental_stream'`.
// We never pass that mode, so a stream here would mean the SDK's behavior
// doesn't match what Check 2 assumed — fail loudly rather than silently
// mishandle it.
function assertNotStream<T>(value: T | ReadableStream<Uint8Array>): T {
  if (value instanceof ReadableStream) {
    throw new Error(
      "Expected a JSON chat response but got a stream — responseMode handling needs re-checking against the live API.",
    );
  }
  return value;
}

// The type-only ChatDetail response doesn't document ordering/timing
// guarantees for `messages` under responseMode: 'async' — whether the
// newest entry is the assistant's (pending) reply or just the user's own
// echoed prompt is unverified without a live key. Prefer the last
// assistant-role message if one already exists; otherwise fall back to
// whatever is last, so this doesn't crash either way — just flag it as an
// early live-testing target if the wrong message ever gets polled.
function pickMessageToTrack(chat: {
  messages: Array<{ id: string; role: "user" | "assistant" }>;
}) {
  const messages = chat.messages;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === "assistant") {
      return messages[i]!;
    }
  }
  return messages.at(-1);
}

// Live-testing discovery: a `chats.create`/`sendMessage` call can hang with
// no response at all — confirmed against v0 directly afterward that neither
// side ever received the message, so this is an outbound fetch hang, not a
// v0-side rejection or slow generation (responseMode: 'async' means this
// call only needs to *kick off* generation, which observed at a few seconds
// normally). Every call here is bounded so a hang becomes a clean, visible,
// retryable failure instead of stranding the request forever.
const KICKOFF_TIMEOUT_MS = 45_000;
const READ_TIMEOUT_MS = 20_000;

export class V0BuilderEngine implements BuilderEngine {
  async startProject(input: {
    name: string;
    prompt: string;
    attachments?: { url: string }[];
  }): Promise<BuilderMessageHandle> {
    const v0 = client();
    const project = await withSanitizedErrors(
      withTimeout(
        v0.projects.create({ name: input.name }),
        READ_TIMEOUT_MS,
        "Timed out setting up your project.",
      ),
    );

    const chat = assertNotStream(
      await withSanitizedErrors(
        withTimeout(
          v0.chats.create({
            message: input.prompt,
            attachments: input.attachments,
            projectId: project.id,
            system: BUILDER_SYSTEM_PROMPT,
            responseMode: "async",
          }),
          KICKOFF_TIMEOUT_MS,
          "Timed out starting the build.",
        ),
      ),
    );

    const message = pickMessageToTrack(chat);
    if (!message) {
      throw new Error("Didn't get a response back for the first message.");
    }

    return {
      externalProjectId: project.id,
      externalChatId: chat.id,
      externalMessageId: message.id,
    };
  }

  async continueProject(input: {
    ref: BuilderResourceRef;
    prompt: string;
    attachments?: { url: string }[];
  }): Promise<BuilderMessageHandle> {
    const v0 = client();
    const chat = assertNotStream(
      await withSanitizedErrors(
        withTimeout(
          v0.chats.sendMessage({
            chatId: input.ref.externalChatId,
            message: input.prompt,
            attachments: input.attachments,
            system: BUILDER_SYSTEM_PROMPT,
            responseMode: "async",
          }),
          KICKOFF_TIMEOUT_MS,
          "Timed out sending your change.",
        ),
      ),
    );

    const message = pickMessageToTrack(chat);
    if (!message) {
      throw new Error("Didn't get a response back for that change.");
    }

    return {
      externalProjectId: input.ref.externalProjectId,
      externalChatId: chat.id,
      externalMessageId: message.id,
    };
  }

  async getMessageStatus(
    input: BuilderMessageHandle,
  ): Promise<BuilderMessageStatus> {
    const v0 = client();
    const message = await withSanitizedErrors(
      withTimeout(
        v0.chats.getMessage({
          chatId: input.externalChatId,
          messageId: input.externalMessageId,
        }),
        READ_TIMEOUT_MS,
        "Timed out checking build status.",
      ),
    );

    const finishReason = message.finishReason ?? null;
    let usage: BuilderMessageStatus["usage"] = null;
    let assistantText: string | null = null;

    // message.content is v0's internal structured "parts" JSON (thinking
    // steps, tool calls, file writes) — not display text. `chat.text` is
    // the actual human-readable summary v0's own UI shows, confirmed
    // against a live response; message.content must never be shown as-is.
    // Only worth fetching once the message has actually finished — both are
    // meaningless mid-generation, and "tool-calls" is NOT finished (see
    // isTerminalFinishReason).
    if (isTerminalFinishReason(finishReason)) {
      const [usageResp, chat] = await withSanitizedErrors(
        withTimeout(
          Promise.all([
            v0.reports.getUsage({
              chatId: input.externalChatId,
              messageId: input.externalMessageId,
            }),
            v0.chats.getById({ chatId: input.externalChatId }),
          ]),
          READ_TIMEOUT_MS,
          "Timed out fetching build results.",
        ),
      );

      const totalCostUsd = usageResp.data.reduce(
        (sum, event) => sum + Number(event.totalCost ?? 0),
        0,
      );
      usage = { totalCostUsd };
      assistantText = chat.text ?? null;
    }

    return {
      externalProjectId: input.externalProjectId,
      externalChatId: input.externalChatId,
      externalMessageId: input.externalMessageId,
      assistantText,
      finishReason,
      usage,
    };
  }

  async getFiles(input: BuilderResourceRef): Promise<BuilderFile[]> {
    const v0 = client();
    const chat = await withSanitizedErrors(
      withTimeout(
        v0.chats.getById({ chatId: input.externalChatId }),
        READ_TIMEOUT_MS,
        "Timed out fetching generated files.",
      ),
    );
    const files = chat.latestVersion?.files ?? [];
    return files.map((file) => ({ path: file.name, content: file.content }));
  }

  async getPreview(input: BuilderResourceRef): Promise<BuilderPreview | null> {
    const v0 = client();
    const chat = await withSanitizedErrors(
      withTimeout(
        v0.chats.getById({ chatId: input.externalChatId }),
        READ_TIMEOUT_MS,
        "Timed out fetching the preview.",
      ),
    );
    const demoUrl = chat.latestVersion?.demoUrl;
    return demoUrl
      ? { url: demoUrl, screenshotUrl: chat.latestVersion?.screenshotUrl ?? null }
      : null;
  }

  async deploy(input: BuilderResourceRef): Promise<BuilderDeployResult> {
    const v0 = client();

    const project = await withSanitizedErrors(
      withTimeout(
        v0.projects.getById({ projectId: input.externalProjectId }),
        READ_TIMEOUT_MS,
        "Timed out reading your project before publishing.",
      ),
    );

    let vercelProjectId = project.vercelProjectId;
    if (!vercelProjectId) {
      const vercelProject = await withSanitizedErrors(
        withTimeout(
          v0.integrations.vercel.projects.create({
            projectId: input.externalProjectId,
            name: project.name,
          }),
          READ_TIMEOUT_MS,
          "Timed out setting up hosting for this project.",
        ),
      );
      vercelProjectId = vercelProject.id;
    }

    const chat = await withSanitizedErrors(
      withTimeout(
        v0.chats.getById({ chatId: input.externalChatId }),
        READ_TIMEOUT_MS,
        "Timed out reading the latest version before publishing.",
      ),
    );
    const versionId = chat.latestVersion?.id;
    if (!versionId) {
      throw new Error("This project has no generated version to publish yet.");
    }

    const deployment = await withSanitizedErrors(
      withTimeout(
        v0.deployments.create({
          projectId: input.externalProjectId,
          chatId: input.externalChatId,
          versionId,
        }),
        KICKOFF_TIMEOUT_MS,
        "Timed out starting the publish.",
      ),
    );

    return {
      deploymentId: deployment.id,
      vercelProjectId,
      url: deployment.webUrl ?? null,
    };
  }

  async getVercelProjectId(externalProjectId: string): Promise<string | null> {
    const v0 = client();
    const project = await withSanitizedErrors(
      withTimeout(
        v0.projects.getById({ projectId: externalProjectId }),
        READ_TIMEOUT_MS,
        "Timed out reading your project.",
      ),
    );
    return project.vercelProjectId ?? null;
  }

  async setEnvVars(input: {
    externalProjectId: string;
    vars: BuilderEnvVar[];
  }): Promise<void> {
    const v0 = client();
    await withSanitizedErrors(
      withTimeout(
        v0.projects.createEnvVars({
          projectId: input.externalProjectId,
          environmentVariables: input.vars,
          upsert: true,
        }),
        READ_TIMEOUT_MS,
        "Timed out saving this integration's configuration.",
      ),
    );
  }
}
