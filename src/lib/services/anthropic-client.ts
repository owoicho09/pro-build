import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Per-model $/1M-token rates (input, output) — used only to convert a real
// call's actual usage into a USD cost for the credit ledger (see
// config/credits.ts's usdToCredits), same idea as v0's own cost accounting.
// Confirmed current pricing, not recalled from training data.
const PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "claude-fable-5-1": { inputPerM: 10, outputPerM: 50 },
  "claude-sonnet-5": { inputPerM: 2, outputPerM: 10 },
};

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export interface AnthropicCallResult {
  text: string;
  costUsd: number;
}

// Best-effort, single-turn call — used for both plan generation and
// smart-repair-prompt generation, neither of which is ever allowed to block
// the build pipeline. Returns null (never throws) on a missing API key,
// timeout, or any API error; callers fall back to today's behavior (no
// plan / the static repair template) exactly as if this function didn't
// exist. Never streams: outputs here are short and bounded (a structured
// plan or a repair paragraph), well under what forces streaming.
export async function callAnthropic(input: {
  model: string;
  system: string;
  userMessage: string;
  maxTokens: number;
}): Promise<AnthropicCallResult | null> {
  const anthropic = client();
  if (!anthropic) return null;

  try {
    // claude-fable-5-1: thinking is always on and must not be configured
    // explicitly (an explicit `thinking` param is rejected) — omitting it
    // entirely is correct for every model used here. Per the model's own
    // guidance, server-side fallbacks are included by default for
    // claude-fable-5-1 calls so a safety-classifier decline doesn't just
    // silently drop the plan.
    const isFable = input.model === "claude-fable-5-1";
    const response = isFable
      ? await anthropic.beta.messages.create({
          model: input.model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages: [{ role: "user", content: input.userMessage }],
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        })
      : await anthropic.messages.create({
          model: input.model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages: [{ role: "user", content: input.userMessage }],
        });

    if (response.stop_reason === "refusal") {
      console.error("Anthropic call refused", input.model, response.stop_details);
      return null;
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    if (!textBlock) return null;

    const pricing = PRICING[input.model];
    const costUsd = pricing
      ? (response.usage.input_tokens * pricing.inputPerM) / 1_000_000 +
        (response.usage.output_tokens * pricing.outputPerM) / 1_000_000
      : 0;

    return { text: textBlock.text, costUsd };
  } catch (err) {
    console.error("Anthropic call failed", input.model, err);
    return null;
  }
}
