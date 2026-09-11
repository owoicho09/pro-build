"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getTemplateBySlug,
  isUserEntitledToTemplate,
  cloneProjectFromTemplate,
} from "@/lib/services/templates";

export async function useTemplateAction(_prevState: unknown, formData: FormData) {
  const slug = formData.get("slug");
  if (typeof slug !== "string") {
    return { error: "Missing template." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // The template detail page re-runs this clone automatically once the
    // user comes back authenticated (see page.tsx's `use=1` handling) —
    // preserves the click through signup the same way the landing page
    // preserves a typed prompt.
    redirect(`/signup?next=${encodeURIComponent(`/templates/${slug}?use=1`)}`);
  }

  const template = await getTemplateBySlug(supabase, slug);
  if (!template) {
    return { error: "This template is no longer available." };
  }

  if (!isUserEntitledToTemplate(user.id, template)) {
    return { error: "This template isn't included in your plan yet." };
  }

  let projectId: string;
  try {
    const result = await cloneProjectFromTemplate(supabase, { userId: user.id, template });
    projectId = result.projectId;
  } catch (err) {
    console.error("Failed to clone project from template", slug, err);
    return {
      error: err instanceof Error ? err.message : "Couldn't start this project. Please try again.",
    };
  }

  redirect(`/projects/${projectId}`);
}
