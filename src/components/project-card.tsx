import Link from "next/link";
import { Globe } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ProjectStatusBadge } from "@/components/project-status-badge";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { timeAgo } from "@/lib/time-ago";
import type { Database } from "@/db/types";

type Project = Database["public"]["Tables"]["projects"]["Row"];

// Strongly visual by design (spec: "do not leave large amounts of empty
// page space while displaying one tiny project card") — a large preview
// area is the point, not an afterthought, since it's the fastest way for a
// nontechnical user to recognize which project is which.
export function ProjectCard({ project }: { project: Project }) {
  const isLive = project.status === "live" && project.production_url;
  const hasUnpublishedWork = Boolean(project.production_url) && project.status !== "live";

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="flex h-full flex-col overflow-hidden transition-colors hover:border-brand/40">
        <div className="relative aspect-video bg-border/30">
          <ImageWithFallback
            key={project.thumbnail_url}
            src={project.thumbnail_url}
            alt=""
            className="h-full w-full object-cover"
            fallback={
              <div className="flex h-full w-full items-center justify-center">
                <span className="text-2xl font-medium text-muted-foreground">
                  {project.name.slice(0, 1).toUpperCase()}
                </span>
              </div>
            }
          />
          {isLive && (
            <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-xs font-medium text-white">
              <Globe className="size-3" />
              Live
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate font-medium">{project.name}</h3>
            <ProjectStatusBadge status={project.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {hasUnpublishedWork ? "Unpublished changes — " : ""}
            Active {timeAgo(project.last_activity_at)}
          </p>
        </div>
      </Card>
    </Link>
  );
}
