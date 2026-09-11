"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@/db/types";
import { connectDomainAction, verifyDomainAction, removeDomainAction } from "./actions";

type Domain = Database["public"]["Tables"]["domains"]["Row"];

const STATUS_LABEL: Record<Domain["status"], string> = {
  pending_verification: "Needs setup",
  verified: "Connected",
  failed: "Issue detected",
  removed: "Removed",
};

function DomainRow({ domain, canManage }: { domain: Domain; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"verify" | "remove" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleVerify() {
    setBusy("verify");
    setMessage(null);
    const result = await verifyDomainAction(domain.id);
    setBusy(null);
    if (result.error) {
      setMessage(result.error);
    } else if (result.reason) {
      setMessage(`Not verified yet: ${result.reason}`);
    } else {
      router.refresh();
    }
  }

  async function handleRemove() {
    setBusy("remove");
    setMessage(null);
    const result = await removeDomainAction(domain.id);
    setBusy(null);
    if (result.error) {
      setMessage(result.error);
    } else {
      router.refresh();
    }
  }

  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium" title={domain.domain_name}>
            {domain.domain_name}
          </p>
          <p
            className={
              domain.status === "verified"
                ? "text-xs text-brand"
                : "text-xs text-muted-foreground"
            }
          >
            {STATUS_LABEL[domain.status]}
            {domain.status === "verified" && domain.ssl_status
              ? ` — SSL ${domain.ssl_status}`
              : ""}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            {domain.status !== "verified" && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={handleVerify}
              >
                {busy === "verify" ? "Checking..." : "Check verification"}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={handleRemove}
            >
              {busy === "remove" ? "Removing..." : "Remove"}
            </Button>
          </div>
        )}
      </div>
      {domain.status !== "verified" && domain.dns_instructions && (
        <pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-2 text-xs text-muted-foreground">
          {domain.dns_instructions}
        </pre>
      )}
      {message && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {message}
        </p>
      )}
    </li>
  );
}

export function DomainsPanel({
  projectId,
  domains,
  canConnect,
}: {
  projectId: string;
  domains: Domain[];
  canConnect: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(connectDomainAction, null);
  // Render-time sync (not a setState-in-effect) so a successful connect
  // closes the form without an extra cascading render.
  const [syncedState, setSyncedState] = useState(state);
  if (state !== syncedState) {
    setSyncedState(state);
    if (state?.success) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Custom domains
        </p>
        {canConnect && !open && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Connect a domain
          </Button>
        )}
      </div>

      {!canConnect && domains.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Publish this project before connecting a custom domain.
        </p>
      )}

      {domains.length > 0 && (
        <ul className="mt-2 space-y-2">
          {domains.map((domain) => (
            <DomainRow key={domain.id} domain={domain} canManage={canConnect} />
          ))}
        </ul>
      )}

      {open && (
        <form action={action} className="mt-3 flex max-w-md items-start gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <div className="flex-1">
            <Input name="domainName" placeholder="www.example.com" required autoComplete="off" />
            {state?.error && (
              <p className="mt-1 text-xs text-danger" role="alert">
                {state.error}
              </p>
            )}
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Connecting..." : "Connect"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  );
}
