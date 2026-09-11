"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import type { Database } from "@/db/types";
import { ProjectSettingsModal } from "./project-settings-modal";

type Domain = Database["public"]["Tables"]["domains"]["Row"];
type Integration = Database["public"]["Tables"]["project_integrations"]["Row"];

// Compact contextual trigger for domain/integration configuration — kept
// out of the workspace's main flow (spec: no permanent full-width
// domain-management bars). The dot only appears when something actually
// needs attention, so it doubles as the discovery path the removed banner
// used to provide.
export function WorkspaceMoreMenu({
  projectId,
  integrations,
  domains,
  canConnectDomain,
}: {
  projectId: string;
  integrations: Integration[];
  domains: Domain[];
  canConnectDomain: boolean;
}) {
  const [open, setOpen] = useState(false);
  const needsAttention = integrations.some((i) => i.status === "not_configured");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Project settings"
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-border/40 hover:text-foreground"
      >
        <Settings2 className="h-4 w-4" />
        {needsAttention && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning" />
        )}
      </button>
      {open && (
        <ProjectSettingsModal
          projectId={projectId}
          integrations={integrations}
          domains={domains}
          canConnectDomain={canConnectDomain}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
