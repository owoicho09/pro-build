import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { TemplateCard } from "@/components/templates/template-card";
import { ProjectCard } from "@/components/project-card";
import { createClient } from "@/lib/supabase/server";
import { listPublishedTemplates } from "@/lib/services/templates";
import { NewProjectForm } from "./new-project-form";

export default async function NewProjectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defense in depth, matching every other private page (dashboard, billing,
  // projects/[id]) — proxy.ts (src/proxy.ts) also gates this route, but each
  // page checks for itself too rather than depending on that alone.
  if (!user) {
    redirect("/login?next=/projects/new");
  }

  const templates = (await listPublishedTemplates(supabase)).slice(0, 3);

  const { data: recentProjects } = await supabase
    .from("projects")
    .select("*")
    .order("last_activity_at", { ascending: false })
    .limit(3);

  return (
    <AppShell>
      <div className="mx-auto flex max-w-[1080px] flex-col items-center px-6 py-16 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Build without limits
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Create something <span className="text-brand">amazing</span>
        </h1>
        <p className="mt-3 max-w-lg text-base text-muted-foreground">
          Describe what you want to build. You can add images, files, or
          documents.
        </p>
        <div className="mt-8 w-full max-w-2xl">
          <NewProjectForm />
        </div>

        {templates.length > 0 && (
          <div className="mt-20 w-full text-left">
            <div className="mb-4 flex items-end justify-between">
              <h2 className="text-lg font-semibold">Start with a template</h2>
              <Link
                href="/templates"
                className="text-sm font-medium text-brand hover:underline"
              >
                Browse all →
              </Link>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              {templates.map((template) => (
                <TemplateCard key={template.id} template={template} />
              ))}
            </div>
          </div>
        )}

        {recentProjects && recentProjects.length > 0 && (
          <div className="mt-14 w-full text-left">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h2 className="text-lg font-semibold">Your projects</h2>
                <p className="text-sm text-muted-foreground">Pick up where you left off.</p>
              </div>
              <Link href="/dashboard" className="text-sm font-medium text-brand hover:underline">
                View all →
              </Link>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              {recentProjects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
