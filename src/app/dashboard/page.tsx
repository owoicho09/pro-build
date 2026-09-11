import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProjectCard } from "@/components/project-card";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .order("last_activity_at", { ascending: false });

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Your projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              What you&apos;re building, and what to do next.
            </p>
          </div>
          <Link href="/projects/new">
            <Button size="lg">New project</Button>
          </Link>
        </div>

        {!projects || projects.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 px-6 py-20 text-center">
            <h2 className="text-lg font-medium">No projects yet</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Describe what you want to build and proBuild will start putting
              it together.
            </p>
            <Link href="/projects/new" className="mt-2">
              <Button>Start your first project</Button>
            </Link>
          </Card>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
