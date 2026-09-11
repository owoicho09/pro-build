"use client";

import { useActionState, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { AttachmentPicker } from "@/components/attachment-picker";
import { consumeDraftPrompt } from "@/lib/draft-prompt";
import { handleComposerKeyDown } from "@/lib/composer-keydown";
import { createProject } from "./actions";

const EXAMPLE_CHIPS = [
  "A restaurant website",
  "A real estate agency",
  "A blog or newsletter",
  "A SaaS landing page",
];

export function NewProjectForm() {
  const [state, formAction, pending] = useActionState(createProject, null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Picks up a prompt typed on the landing page before the user signed
  // up/in (see LandingCreateBox) — one-time, so it doesn't keep reappearing
  // on later visits to this page.
  useEffect(() => {
    const draft = consumeDraftPrompt();
    if (draft && promptRef.current && !promptRef.current.value) {
      promptRef.current.value = draft;
      promptRef.current.focus();
    }
  }, []);

  function insertExample(text: string) {
    if (!promptRef.current) return;
    promptRef.current.value = text;
    promptRef.current.focus();
  }

  return (
    <div className="w-full space-y-6">
      {/* The card itself IS the composer — a plain textarea would read as
          an afterthought (spec: "do not let the composer feel like a plain
          textarea"), so the border/shadow/radius live here and the
          textarea inside is borderless/transparent. */}
      <form
        action={formAction}
        className="rounded-2xl border border-border bg-card p-5 shadow-md transition-shadow focus-within:shadow-lg sm:p-6"
      >
        <Textarea
          ref={promptRef}
          name="prompt"
          rows={5}
          required
          aria-label="Describe what you want to build"
          onKeyDown={handleComposerKeyDown}
          placeholder="Describe what you want to build..."
          className="min-h-32 border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
        />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <AttachmentPicker disabled={pending} />
          <p className="hidden text-xs text-muted-foreground md:block">
            <kbd className="rounded border border-border bg-border/30 px-1.5 py-0.5 font-sans">Enter</kbd> to send ·{" "}
            <kbd className="rounded border border-border bg-border/30 px-1.5 py-0.5 font-sans">Shift</kbd>+
            <kbd className="rounded border border-border bg-border/30 px-1.5 py-0.5 font-sans">Enter</kbd> for a new line
          </p>
          <Button type="submit" disabled={pending} size="lg" className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            {pending ? "Creating..." : "Build project"}
          </Button>
        </div>
        {state?.error && (
          <p className="mt-3 text-sm text-danger" role="alert">
            {state.error}
          </p>
        )}
      </form>

      <div className="space-y-2.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Examples
        </p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_CHIPS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => insertExample(example)}
              className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
