import "server-only";
import { callAnthropic } from "@/lib/services/anthropic-client";
import { PLANNER_MODEL } from "@/lib/config/models";

export interface BuildPlan {
  goal: string;
  projectType: string;
  requirements: string[];
  designDirection?: string;
  implementationSteps: string[];
  integrations?: string[];
  risks?: string[];
  validationRequirements?: string[];
}

const PLANNER_SYSTEM_PROMPT = `You are a senior technical planner for an AI website-building platform. Given a user's request, produce a concrete implementation plan for the AI builder that will actually generate the code.

Respond with ONLY a single JSON object, no prose before or after it, matching exactly this shape:
{
  "goal": string,
  "projectType": string,
  "requirements": string[],
  "designDirection": string,
  "implementationSteps": string[],
  "integrations": string[],
  "risks": string[],
  "validationRequirements": string[]
}

Keep every field concrete and specific to this request — never generic boilerplate. Omit a field (empty array or omit the key) if it genuinely doesn't apply.`;

export interface PlanResult {
  plan: BuildPlan;
  costUsd: number;
}

// Best-effort — returns null (never throws) on any failure, including a
// malformed/non-JSON response. Planning is a pure enhancement layer over
// today's "send the raw prompt to v0" behavior, never a hard dependency of
// generation (see build-orchestrator.ts's dispatchBuild).
export async function planBuildRequest(input: {
  prompt: string;
  isNewProject: boolean;
}): Promise<PlanResult | null> {
  const result = await callAnthropic({
    model: PLANNER_MODEL,
    system: PLANNER_SYSTEM_PROMPT,
    userMessage: `${input.isNewProject ? "New project request" : "Follow-up change request for an existing project"}:\n\n${input.prompt}`,
    // Fable 5.1 always does adaptive thinking internally (can't be
    // disabled), which eats into this budget before the visible JSON
    // answer — 2048 truncated the JSON mid-string in live testing.
    maxTokens: 8192,
  });
  if (!result) return null;

  try {
    // Fable sometimes wraps JSON in a fenced code block despite the
    // "ONLY a JSON object" instruction — strip that before parsing rather
    // than failing on it.
    const jsonText = result.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(jsonText) as Partial<BuildPlan>;
    if (!parsed.goal || !Array.isArray(parsed.implementationSteps)) {
      return null;
    }
    const plan: BuildPlan = {
      goal: parsed.goal,
      projectType: parsed.projectType ?? "web application",
      requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [],
      designDirection: parsed.designDirection,
      implementationSteps: parsed.implementationSteps,
      integrations: parsed.integrations,
      risks: parsed.risks,
      validationRequirements: parsed.validationRequirements,
    };
    return { plan, costUsd: result.costUsd };
  } catch (err) {
    console.error("Failed to parse planner response as JSON", err);
    return null;
  }
}

// When `plan` is null (planning skipped or failed), returns the original
// prompt completely unchanged — zero regression risk over today's behavior.
export function buildPromptFromPlan(originalPrompt: string, plan: BuildPlan | null): string {
  if (!plan) return originalPrompt;

  const sections: string[] = [`Goal: ${plan.goal}`, `Project type: ${plan.projectType}`];
  if (plan.requirements.length > 0) {
    sections.push(`Requirements:\n${plan.requirements.map((r) => `- ${r}`).join("\n")}`);
  }
  if (plan.designDirection) {
    sections.push(`Design direction: ${plan.designDirection}`);
  }
  sections.push(
    `Implementation steps:\n${plan.implementationSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
  );
  if (plan.integrations?.length) {
    sections.push(`Integrations to account for: ${plan.integrations.join(", ")}`);
  }
  if (plan.risks?.length) {
    sections.push(`Risks to avoid:\n${plan.risks.map((r) => `- ${r}`).join("\n")}`);
  }
  if (plan.validationRequirements?.length) {
    sections.push(`Must satisfy: ${plan.validationRequirements.join("; ")}`);
  }

  return `Follow this implementation plan:\n\n${sections.join("\n\n")}\n\nOriginal request (for context): ${originalPrompt}`;
}

// Cheap, deterministic routing so the common small edit never pays the
// planning call's latency/cost — biased toward planning when uncertain
// (over-planning only costs latency/credits; under-planning risks a worse
// result on something genuinely complex). New projects always plan
// (decided by the caller, not here — see dispatchBuild).
const SIMPLE_EDIT_PATTERN =
  /\b(change|update|edit|fix|replace|swap)\b.*\b(text|copy|color|colour|button|image|photo|icon|font|title|heading|label|typo|spelling)\b/i;
const COMPLEX_KEYWORDS =
  /\b(auth(entication)?|login|sign[- ]?up|database|payment|checkout|stripe|integrat(e|ion)|redesign|architecture|migrat(e|ion)|api\b|backend|schema)\b/i;
const SIMPLE_EDIT_MAX_WORDS = 25;

export function isComplexFollowUp(prompt: string): boolean {
  const wordCount = prompt.trim().split(/\s+/).length;
  const looksSimple =
    wordCount <= SIMPLE_EDIT_MAX_WORDS &&
    SIMPLE_EDIT_PATTERN.test(prompt) &&
    !COMPLEX_KEYWORDS.test(prompt);
  return !looksSimple;
}
