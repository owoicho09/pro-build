import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceTopBar } from "@/components/workspace-header";
import { createClient } from "@/lib/supabase/server";
import { Workspace } from "./workspace";

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // RLS scopes this to the caller's own projects — a project that exists
  // but belongs to someone else comes back as no row, same as a project
  // that doesn't exist at all, so this never leaks cross-account existence.
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  // Independent reads (none depends on another's result) — run concurrently
  // instead of one after another. Sequential round trips to Supabase on
  // every single load/refresh was pure avoidable latency with no benefit;
  // Promise.all turns "sum of them all" into "the slowest one".
  const [{ data: messages }, { data: latestBuild }, { data: attachments }, { data: deployments }, { data: integrations }, { data: domains }] =
    await Promise.all([
      supabase.from("messages").select("*").eq("project_id", project.id).order("created_at", { ascending: true }),
      supabase
        .from("builds")
        .select("*")
        .eq("project_id", project.id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("attachments").select("*").eq("project_id", project.id).order("created_at", { ascending: true }),
      supabase.from("deployments").select("*").eq("project_id", project.id).order("created_at", { ascending: false }),
      supabase
        .from("project_integrations")
        .select("*")
        .eq("project_id", project.id)
        .order("created_at", { ascending: true }),
      supabase.from("domains").select("*").eq("project_id", project.id).order("created_at", { ascending: true }),
    ]);

  // The persisted previewUrl is used immediately, unconditionally — the
  // page must never block its first paint on a live v0 call. v0's preview
  // links turned out not to survive being reused indefinitely (live-tested:
  // even a "fresh" one only reliably works once), so PreviewPane resolves a
  // genuinely fresh one itself, client-side, right after mount, and swaps
  // the iframe over once it's ready — see preview-pane.tsx's
  // auto-refresh-on-mount effect. This is the "persisted first, fresh
  // asynchronously, swap when ready" architecture; there is deliberately no
  // stale-time guess (e.g. "15 minutes") gating this anywhere.
  const previewUrl = project.preview_url;

  const canPublish =
    Boolean(project.v0_chat_id && project.v0_project_id) &&
    (project.status === "preview_ready" || project.status === "live" || project.status === "needs_attention");

  return (
    <AppShell
      workspace
      header={
        <WorkspaceTopBar
          project={project}
          deployments={deployments ?? []}
          integrations={integrations ?? []}
          domains={domains ?? []}
          canPublish={canPublish}
        />
      }
    >
      <Workspace
        project={project}
        initialMessages={messages ?? []}
        initialBuild={latestBuild ?? null}
        attachments={attachments ?? []}
        previewUrl={previewUrl}
      />
    </AppShell>
  );
}
