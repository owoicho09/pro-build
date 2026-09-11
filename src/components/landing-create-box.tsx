"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { saveDraftPrompt } from "@/lib/draft-prompt";

// Anonymous users can type their idea right here (spec: don't force
// auth -> dashboard -> new project -> retype prompt). The prompt is saved
// locally and replayed on /projects/new once they've signed up.
export function LandingCreateBox() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    saveDraftPrompt(prompt);
    router.push("/signup?next=/projects/new");
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-3 text-left">
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        placeholder="Describe what you want to build..."
        className="text-base"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Already have an account?{" "}
          <button
            type="button"
            onClick={() => {
              if (prompt.trim()) saveDraftPrompt(prompt);
              router.push("/login?next=/projects/new");
            }}
            className="font-medium text-brand hover:underline"
          >
            Sign in
          </button>
        </p>
        <Button type="submit" disabled={!prompt.trim()}>
          Start building
        </Button>
      </div>
    </form>
  );
}
