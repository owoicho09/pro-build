import { AppShell } from "@/components/shell/app-shell";
import { TemplateBrowser } from "@/components/templates/template-browser";
import { createClient } from "@/lib/supabase/server";
import { listPublishedTemplates } from "@/lib/services/templates";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const templates = await listPublishedTemplates(supabase);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start with a professionally built project and make it yours.
          </p>
        </div>
        <TemplateBrowser templates={templates} />
      </div>
    </AppShell>
  );
}
