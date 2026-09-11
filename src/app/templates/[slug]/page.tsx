import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { TemplatePreviewCanvas } from "@/components/templates/template-preview-canvas";
import { createClient } from "@/lib/supabase/server";
import { getTemplateBySlug, cloneProjectFromTemplate } from "@/lib/services/templates";
import { UseTemplateButton } from "./use-template-button";

export default async function TemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ use?: string }>;
}) {
  const { slug } = await params;
  const { use } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const template = await getTemplateBySlug(supabase, slug);
  if (!template) {
    notFound();
  }

  // Picks the "Use Template" click back up once the user returns from
  // signup (see actions.ts's redirect into ?use=1) — same intent-handoff
  // pattern as the landing page's draft prompt, just server-side since the
  // template is already identified by the URL.
  let redirectTo: string | null = null;
  if (use === "1" && user) {
    try {
      const result = await cloneProjectFromTemplate(supabase, { userId: user.id, template });
      redirectTo = `/projects/${result.projectId}`;
    } catch (err) {
      console.error("Auto-clone from template failed after signup", slug, err);
    }
  }
  if (redirectTo) {
    redirect(redirectTo);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/templates"
              aria-label="Back to templates"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-border/40 hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-xl font-semibold">{template.name}</h1>
                {template.is_premium && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                    <Sparkles className="size-3" />
                    Premium
                  </span>
                )}
              </div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand/80">{template.category}</p>
            </div>
          </div>
          <UseTemplateButton slug={template.slug} />
        </div>

        <TemplatePreviewCanvas thumbnailUrl={template.thumbnail_url} name={template.name} />

        <div className="mt-8 max-w-2xl">
          {template.tagline && (
            <p className="text-base text-foreground">{template.tagline}</p>
          )}
          {template.description && (
            <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">
              {template.description}
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
