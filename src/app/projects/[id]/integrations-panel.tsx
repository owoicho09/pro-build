"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getProvider } from "@/lib/config/providers";
import type { Database } from "@/db/types";
import { configureIntegrationAction } from "./actions";

type Integration = Database["public"]["Tables"]["project_integrations"]["Row"];

function ConnectForm({
  projectId,
  provider,
  onDone,
}: {
  projectId: string;
  provider: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(configureIntegrationAction, null);
  const providerDef = getProvider(provider);

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  if (!providerDef) return null;

  return (
    <form action={action} className="mt-3 space-y-3 border-t border-border pt-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="provider" value={provider} />
      {providerDef.envVars.map((envVar) => (
        <div key={envVar.key} className="space-y-1">
          <label htmlFor={`env-${envVar.key}`} className="text-xs font-medium">
            {envVar.label}
          </label>
          <Input
            id={`env-${envVar.key}`}
            name={`env:${envVar.key}`}
            type={envVar.secret ? "password" : "text"}
            required
            autoComplete="off"
          />
        </div>
      ))}
      <a
        href={providerDef.whereToGetUrl}
        target="_blank"
        rel="noreferrer"
        className="block text-xs text-brand hover:underline"
      >
        Where do I find these?
      </a>
      {state?.error && (
        <p className="text-xs text-danger" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving..." : "Save & continue building"}
      </Button>
    </form>
  );
}

export function IntegrationsPanel({
  projectId,
  integrations,
}: {
  projectId: string;
  integrations: Integration[];
}) {
  const router = useRouter();
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const pending = integrations.filter((i) => i.status === "not_configured");

  if (pending.length === 0) return null;

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-warning">
        {pending.length} feature{pending.length > 1 ? "s" : ""} need{pending.length === 1 ? "s" : ""} activation
      </p>
      <div className="mt-2 space-y-3">
        {pending.map((integration) => {
          const providerDef = getProvider(integration.provider);
          if (!providerDef) return null;
          return (
            <div key={integration.id} className="max-w-md">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{providerDef.label}</p>
                  <p className="text-xs text-muted-foreground">{providerDef.description}</p>
                </div>
                {openProvider !== integration.provider && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setOpenProvider(integration.provider)}
                  >
                    Connect
                  </Button>
                )}
              </div>
              {openProvider === integration.provider && (
                <ConnectForm
                  projectId={projectId}
                  provider={integration.provider}
                  onDone={() => {
                    setOpenProvider(null);
                    router.refresh();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
