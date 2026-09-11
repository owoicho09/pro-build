"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Globe } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Database } from "@/db/types";
import { publishProjectAction } from "./actions";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Deployment = Database["public"]["Tables"]["deployments"]["Row"];

// Mounted only while open (see publish-panel.tsx) so useActionState's
// result always starts fresh — otherwise a stale "just published" success
// view would reappear the next time this opens.
export function PublishModal({
  project,
  deployments,
  canPublish,
  onClose,
}: {
  project: Project;
  deployments: Deployment[];
  canPublish: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(publishProjectAction, null);
  const [copied, setCopied] = useState(false);

  const isFirstPublish = !project.production_url;

  function handleCopy(url: string) {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  function handleClose() {
    if (state?.success) router.refresh();
    onClose();
  }

  return (
    <Dialog open onClose={handleClose} title={state?.success ? "Your website is live" : "Publish"}>
      {state?.success ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
              <Globe className="h-4 w-4" />
            </span>
            <h2 className="text-lg font-semibold">Your website is live</h2>
          </div>
          <p className="truncate rounded-xl border border-border bg-border/20 px-3 py-2 text-sm text-muted-foreground">
            {state.url}
          </p>
          {/* Only ever shown when the deployment protection check genuinely
              didn't confirm success — never a speculative default. */}
          {state.warning && (
            <p className="text-sm text-warning" role="alert">
              {state.warning}
            </p>
          )}
          <div className="flex gap-2">
            <a href={state.url} target="_blank" rel="noreferrer" className="flex-1">
              <Button variant="secondary" className="w-full gap-1.5">
                <ExternalLink className="h-4 w-4" />
                Open site
              </Button>
            </a>
            <Button variant="secondary" className="flex-1 gap-1.5" onClick={() => handleCopy(state.url)}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="block w-full text-center text-xs font-medium text-brand hover:underline"
          >
            Connect a custom domain →
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {isFirstPublish ? "Publish your website" : "Publish latest changes?"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isFirstPublish
              ? "Your current version is ready to go live."
              : "A newer version is ready. Your current live site stays online unless this succeeds."}
          </p>
          {!isFirstPublish && project.production_url && (
            <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-muted-foreground">Current live version</span>
                <span className="truncate text-xs text-muted-foreground">{project.production_url}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-muted-foreground">New version</span>
                <span className="text-xs font-medium text-brand">Ready to publish</span>
              </div>
            </div>
          )}
          {state?.error && (
            <p className="text-sm text-danger" role="alert">
              {state.error}
            </p>
          )}
          <form action={action}>
            <input type="hidden" name="projectId" value={project.id} />
            <Button type="submit" size="lg" className="w-full" disabled={pending || !canPublish}>
              {pending ? "Publishing..." : isFirstPublish ? "Publish website" : "Publish update"}
            </Button>
          </form>
          {deployments.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">
                Deployment history ({deployments.length})
              </summary>
              <ul className="mt-1.5 space-y-1">
                {deployments.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <span>{new Date(d.created_at).toLocaleString()}</span>
                    {d.url && (
                      <a href={d.url} target="_blank" rel="noreferrer" className="shrink-0 hover:underline">
                        {d.is_current_production ? "current" : "view"}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Dialog>
  );
}
