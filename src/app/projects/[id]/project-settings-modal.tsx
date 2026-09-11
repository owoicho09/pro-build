"use client";

import { Dialog } from "@/components/ui/dialog";
import type { Database } from "@/db/types";
import { IntegrationsPanel } from "./integrations-panel";
import { DomainsPanel } from "./domains-panel";

type Domain = Database["public"]["Tables"]["domains"]["Row"];
type Integration = Database["public"]["Tables"]["project_integrations"]["Row"];

// Integrations + Domains used to render as permanent full-width bars above
// the workspace on every load. Both are occasional/setup actions, not
// ongoing workspace content, so they live behind the "More" trigger in
// WorkspaceTopBar instead (see workspace-more-menu.tsx).
export function ProjectSettingsModal({
  projectId,
  integrations,
  domains,
  canConnectDomain,
  onClose,
}: {
  projectId: string;
  integrations: Integration[];
  domains: Domain[];
  canConnectDomain: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title="Project settings" className="max-w-lg">
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">Project settings</h2>
        <IntegrationsPanel projectId={projectId} integrations={integrations} />
        <div>
          <DomainsPanel projectId={projectId} domains={domains} canConnect={canConnectDomain} />
        </div>
      </div>
    </Dialog>
  );
}
