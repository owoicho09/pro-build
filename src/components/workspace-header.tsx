import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SidebarTrigger } from "@/components/shell/sidebar-trigger";
import { ProjectStatusBadge } from "@/components/project-status-badge";
import { PublishPanel } from "@/app/projects/[id]/publish-panel";
import { WorkspaceMoreMenu } from "@/app/projects/[id]/workspace-more-menu";
import { ProjectNameEditor } from "@/app/projects/[id]/project-name-editor";
import type { Database } from "@/db/types";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Deployment = Database["public"]["Tables"]["deployments"]["Row"];
type Domain = Database["public"]["Tables"]["domains"]["Row"];
type Integration = Database["public"]["Tables"]["project_integrations"]["Row"];

// The workspace's ONLY top bar (spec: no duplicated navigation controls —
// notifications/credits/theme/sign-out now live exclusively in the
// application sidebar, rendered by AppShell around this). Purely
// contextual to this one project: back-to-projects, name, status, publish,
// and a compact settings trigger (domains/integrations no longer render as
// permanent full-width bars in the main workspace).
export function WorkspaceTopBar({
  project,
  deployments,
  integrations,
  domains,
  canPublish,
}: {
  project: Project;
  deployments: Deployment[];
  integrations: Integration[];
  domains: Domain[];
  canPublish: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        <Link
          href="/dashboard"
          aria-label="Back to projects"
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-border/40 md:flex"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <ProjectNameEditor projectId={project.id} name={project.name} />
        <ProjectStatusBadge status={project.status} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <PublishPanel project={project} deployments={deployments} canPublish={canPublish} />
        <WorkspaceMoreMenu
          projectId={project.id}
          integrations={integrations}
          domains={domains}
          canConnectDomain={Boolean(project.production_url)}
        />
      </div>
    </div>
  );
}
