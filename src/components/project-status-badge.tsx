import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/db/types";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  planning: "Planning",
  building: "Building",
  preview_ready: "Preview ready",
  needs_attention: "Needs attention",
  publishing: "Publishing",
  live: "Live",
  failed: "Failed",
};

const STATUS_CLASS: Record<ProjectStatus, string> = {
  draft: "bg-border/60 text-muted-foreground",
  planning: "bg-brand/10 text-brand",
  building: "bg-brand/10 text-brand",
  preview_ready: "bg-brand/10 text-brand",
  needs_attention: "bg-warning/10 text-warning",
  publishing: "bg-brand/10 text-brand",
  live: "bg-success/10 text-success",
  failed: "bg-danger/10 text-danger",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_CLASS[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
