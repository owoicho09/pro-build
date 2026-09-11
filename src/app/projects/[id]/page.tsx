import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceTopBar } from "@/components/workspace-header";
import { createClient } from "@/lib/supabase/server";
import { getBuilderEngine } from "@/lib/services";
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
  // instead of one after another. Six sequential round trips to Supabase on
  // every single load/refresh was pure avoidable latency with no benefit;
  // Promise.all turns "sum of all six" into "the slowest one".
  const [
    { data: messages },
    { data: latestBuild },
    { data: attachments },
    { data: deployments },
    { data: integrations },
    { data: domains },
  ] = await Promise.all([
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

  // The durable, DB-stored preview is now the sole source for render — no
  // live v0 call on every page load. That live call was both the launch-
  // critical "No preview yet after reopening" bug (any transient hiccup, or
  // it simply returning nothing for a moment, blanked a project that had a
  // perfectly good preview) AND pure avoidable per-load latency. previewUrl
  // is written durably by build-orchestrator.ts's advanceBuild() the moment
  // a build actually succeeds, so it never regresses to null just because
  // one live read happened to fail.
  let previewUrl = project.preview_url;

  // Legacy self-heal: a project built before previewUrl existed (or the
  // rare case the durable write above genuinely never happened) would
  // otherwise show "No preview yet" forever despite having a real, working
  // v0 chat. One best-effort live fallback, and — if it succeeds — persist
  // it, so this only ever runs once per such project, not on every future
  // load. A project that has never actually had a successful build still
  // correctly shows the building/empty state, since there's nothing to fall
  // back to.
  if (!previewUrl && project.v0_chat_id && project.v0_project_id) {
    try {
      const preview = await getBuilderEngine().getPreview({
        externalProjectId: project.v0_project_id,
        externalChatId: project.v0_chat_id,
      });
      if (preview?.url) {
        previewUrl = preview.url;
        await supabase.from("projects").update({ preview_url: preview.url }).eq("id", project.id);
      }
    } catch (err) {
      console.error("Legacy preview backfill failed for project", project.id, err);
    }
  }

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
