import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceTopBar } from "@/components/workspace-header";
import { createClient } from "@/lib/supabase/server";
import { refreshProjectPreview } from "@/lib/services/build-orchestrator";
import { Workspace } from "./workspace";

// v0's preview URL embeds a signed, time-limited token — once it expires,
// v0's demo host serves its own "loading" shell forever instead of the real
// app, which looks identical to "no preview" but never self-corrects. A
// project reopened after sitting idle is exactly the common case this hits,
// so a stale-but-present previewUrl gets one live re-check here, same as a
// genuinely missing one always has. preview_url_checked_at (set by
// refreshProjectPreview) makes this cheap on every load in between: only
// the first load past this threshold pays for the live v0 call.
const PREVIEW_STALE_MS = 15 * 60 * 1000;

// Pulled out of the component body (rather than an inline `Date.now()`
// call) since this is a Server Component render function and the
// react-hooks/purity lint rule flags impure calls there regardless of the
// fact this only ever runs once per request, not a re-render.
function isPreviewStale(checkedAt: string | null): boolean {
  if (!checkedAt) return true;
  return Date.now() - new Date(checkedAt).getTime() > PREVIEW_STALE_MS;
}

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

  // The durable, DB-stored preview is the fast-path source for render — no
  // live v0 call on every page load. That live call was both the launch-
  // critical "No preview yet after reopening" bug (any transient hiccup, or
  // it simply returning nothing for a moment, blanked a project that had a
  // perfectly good preview) AND pure avoidable per-load latency. previewUrl
  // is written durably by build-orchestrator.ts's advanceBuild() the moment
  // a build actually succeeds, so it never regresses to null just because
  // one live read happened to fail.
  let previewUrl = project.preview_url;

  // Self-heal: missing entirely (project built before previewUrl existed,
  // or the durable write above genuinely never happened) or stale (the
  // signed token in an old previewUrl has likely expired — see
  // PREVIEW_STALE_MS). Either way this is a best-effort live re-check, and
  // preview_url_checked_at makes it a one-time cost per staleness window,
  // not a live call on every load. A project that has never actually had a
  // successful build still correctly shows the building/empty state, since
  // there's nothing to check yet.
  if ((!previewUrl || isPreviewStale(project.preview_url_checked_at)) && project.v0_chat_id && project.v0_project_id) {
    try {
      const result = await refreshProjectPreview(supabase, { projectId: project.id });
      if (result.previewUrl) {
        previewUrl = result.previewUrl;
      }
    } catch (err) {
      console.error("Preview self-heal failed for project", project.id, err);
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
