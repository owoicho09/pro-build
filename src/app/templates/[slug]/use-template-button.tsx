"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { useTemplateAction } from "./actions";

export function UseTemplateButton({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(useTemplateAction, null);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="slug" value={slug} />
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Starting your project..." : "Use this template"}
      </Button>
      <p className="text-xs text-muted-foreground">
        proBuild builds this into your own project — usually ready in a minute or two.
      </p>
      {state?.error && (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
