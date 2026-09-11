"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { renameProjectAction } from "./actions";

// Initial names are a heuristic guess derived from the build prompt (see
// lib/project-name.ts) — this is the escape hatch when the guess is wrong.
export function ProjectNameEditor({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(renameProjectAction, null);

  // Render-time sync (same idiom used elsewhere in this app) — close the
  // editor and pick up the saved name without a setState-in-effect.
  const [syncedState, setSyncedState] = useState(state);
  if (state !== syncedState) {
    setSyncedState(state);
    if (state?.success) {
      setEditing(false);
      router.refresh();
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Rename project"
        className="group flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-0.5 hover:bg-border/30"
      >
        <h1 className="min-w-0 truncate font-medium">{name}</h1>
        <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <form action={action} className="flex min-w-0 flex-wrap items-center gap-1">
      <input type="hidden" name="projectId" value={projectId} />
      <input
        name="name"
        defaultValue={name}
        autoFocus
        required
        maxLength={80}
        aria-label="Project name"
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      />
      <button
        type="submit"
        disabled={pending}
        aria-label="Save name"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-border/40 hover:text-foreground"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        aria-label="Cancel"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-border/40 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      {state?.error && (
        <p className="w-full text-xs text-danger" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
