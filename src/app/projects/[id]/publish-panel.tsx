"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Database } from "@/db/types";
import { PublishModal } from "./publish-modal";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Deployment = Database["public"]["Tables"]["deployments"]["Row"];

export function PublishPanel({
  project,
  deployments,
  canPublish,
}: {
  project: Project;
  deployments: Deployment[];
  canPublish: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        {project.production_url && (
          <a
            href={project.production_url}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:flex"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View live site
          </a>
        )}
        <Button size="sm" disabled={!canPublish} onClick={() => setOpen(true)}>
          {project.production_url ? "Publish update" : "Publish"}
        </Button>
      </div>
      {open && (
        <PublishModal
          project={project}
          deployments={deployments}
          canPublish={canPublish}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
