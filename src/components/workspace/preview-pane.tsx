"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, RefreshCw } from "lucide-react";
import { PreviewSkeleton } from "@/components/workspace/preview-skeleton";
import { PreviewSizeToggle, type PreviewSize } from "@/components/workspace/preview-size-toggle";
import { cn } from "@/lib/utils";
import { refreshPreviewAction } from "@/app/projects/[id]/actions";

// v0's demo host is a real (often cold-starting) app on the other end of
// that URL — live-tested this can take up to several seconds past the HTTP
// response before it actually paints, and it's cross-origin, so there's no
// reliable "content painted" signal to wait for instead (onLoad fires once
// the shell document loads, well before streamed content is visible). This
// is a heuristic window, not a guarantee — it just replaces a silent blank
// void with an honest "this is loading" during the common case.
const PREVIEW_BOOT_MS = 6000;

// A generous ceiling past PREVIEW_BOOT_MS for the iframe's own `load` event
// to fire at all — that event is a weak "did it render anything useful"
// signal (see PREVIEW_BOOT_MS's comment) but a solid "did navigation even
// complete" one. Never firing this long past the boot window is the
// distinguishing case the spec calls "Preview is taking longer than
// expected": a real stuck/broken load, not just v0's normal cold start.
const PREVIEW_STUCK_MS = 20000;

// Simulated viewport widths — the generated project itself is responsive;
// this just lets the user check how it looks at each size without leaving
// proBuild. Device controls resize the viewport INSIDE this canvas, not the
// canvas itself: "desktop" renders the iframe directly at the canvas's full
// size (no extra wrapper — seaparate from the flex/align interaction that
// previously left it ambiguous whether it actually filled available
// space); tablet/mobile center a fixed-size device frame within the same,
// still-full-width canvas.
const DEVICE_FRAME_CLASS: Record<"tablet" | "mobile", string> = {
  tablet: "w-[768px] max-w-full h-[1024px] max-h-full border-x border-border",
  mobile: "w-[390px] max-w-full h-[844px] max-h-full border-x border-border",
};

export function PreviewPane({
  projectId,
  previewUrl: initialPreviewUrl,
  inProgress,
  title,
}: {
  projectId: string;
  previewUrl: string | null;
  inProgress: boolean;
  title: string;
}) {
  const router = useRouter();
  const [size, setSize] = useState<PreviewSize>("desktop");
  // Forces a genuine iframe reload (changing `src` to the same value does
  // NOT reload it) — the recoverable action for "preview looks stale/broken"
  // without pretending we can reliably detect a cross-origin load failure,
  // which browsers don't expose in a trustworthy way.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isRefreshing, startRefresh] = useTransition();
  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl);

  // Render-time sync (same idiom used elsewhere in this app) — a fresh
  // server-rendered previewUrl (from a newer build finishing, picked up via
  // router.refresh()) takes over without a setState-in-effect.
  const [syncedInitialPreviewUrl, setSyncedInitialPreviewUrl] = useState(initialPreviewUrl);
  if (initialPreviewUrl !== syncedInitialPreviewUrl) {
    setSyncedInitialPreviewUrl(initialPreviewUrl);
    setPreviewUrl(initialPreviewUrl);
  }

  // v0's preview URL carries a signed token — remounting the SAME url (the
  // old behavior) does nothing once it's been used. Refresh does a live
  // re-check against v0 first and, if it gets a fresh URL, uses that
  // instead; if the check fails, it still falls back to the old
  // remount-only behavior rather than doing nothing.
  function handleRefresh() {
    startRefresh(async () => {
      const result = await refreshPreviewAction(projectId);
      if (result.success && result.previewUrl) {
        setPreviewUrl(result.previewUrl);
      }
      setRefreshNonce((n) => n + 1);
      router.refresh();
    });
  }

  // Auto-refresh once per workspace visit, right after mount — the
  // persisted previewUrl from the server (page.tsx) renders immediately so
  // opening the workspace is never blocked on a live v0 call, but that
  // persisted URL's token may already be spent (see handleRefresh's
  // comment). This resolves a genuinely fresh one in the background and
  // swaps the iframe over once it arrives — it only ever sets a new,
  // truthy previewUrl, so a working preview is never cleared just because
  // this hasn't resolved yet.
  useEffect(() => {
    let cancelled = false;
    refreshPreviewAction(projectId).then((result) => {
      if (!cancelled && result.success && result.previewUrl) {
        setPreviewUrl(result.previewUrl);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Every time the iframe actually gets a new src, give it a window to boot
  // before treating a blank canvas as just "how it looks" — see
  // PREVIEW_BOOT_MS above. Entering the boot state is derived during render
  // (same render-time-sync idiom used elsewhere in this app) rather than
  // set from inside the effect; the effect's only job is scheduling the
  // later, deferred clear.
  const mountKey = `${previewUrl}-${refreshNonce}`;
  const [isBooting, setIsBooting] = useState(true);
  const [syncedMountKey, setSyncedMountKey] = useState(mountKey);
  if (mountKey !== syncedMountKey) {
    setSyncedMountKey(mountKey);
    setIsBooting(true);
  }

  useEffect(() => {
    if (!isBooting) return;
    const timer = setTimeout(() => setIsBooting(false), PREVIEW_BOOT_MS);
    return () => clearTimeout(timer);
  }, [isBooting, mountKey]);

  // Tracks whether THIS mount's iframe has ever fired `load` — reset
  // (render-time sync, same idiom as isBooting above) whenever the src
  // actually changes, so a stale "loaded" from a previous URL never masks
  // a genuinely stuck new one.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [syncedLoadKey, setSyncedLoadKey] = useState(mountKey);
  if (mountKey !== syncedLoadKey) {
    setSyncedLoadKey(mountKey);
    setHasLoaded(false);
  }

  // Distinct from isBooting: this only flips on if the iframe STILL hasn't
  // loaded at all after a much longer window, which is what actually means
  // "stuck" rather than "still in v0's normal cold-start window." Gated on
  // `!hasLoaded` at the render site below rather than reset from inside
  // this effect, so the effect only ever sets state on its own timer, never
  // synchronously in response to `hasLoaded` changing.
  const [isStuck, setIsStuck] = useState(false);
  useEffect(() => {
    if (hasLoaded) return;
    const timer = setTimeout(() => setIsStuck(true), PREVIEW_STUCK_MS);
    return () => clearTimeout(timer);
  }, [hasLoaded, mountKey]);

  function handleIframeLoad() {
    setHasLoaded(true);
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {previewUrl && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-1.5">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Reload the preview"
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-border/40 hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
          <PreviewSizeToggle value={size} onChange={setSize} />
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-border/40 hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open preview
          </a>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-auto bg-border/20">
        {previewUrl ? (
          size === "desktop" ? (
            <iframe
              key={`${previewUrl}-${refreshNonce}`}
              src={previewUrl}
              title={`${title} preview`}
              onLoad={handleIframeLoad}
              className="h-full w-full border-0 bg-background"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4">
              <iframe
                key={`${previewUrl}-${refreshNonce}`}
                src={previewUrl}
                title={`${title} preview`}
                onLoad={handleIframeLoad}
                className={cn("border-0 bg-background", DEVICE_FRAME_CLASS[size])}
              />
            </div>
          )
        ) : inProgress ? (
          <PreviewSkeleton />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
            No preview yet.
          </div>
        )}
        {/* A rebuild starting while an existing preview is still showing keeps
            that preview visible (spec: never blank a known-good preview) but
            needs to say something is happening — a silent no-op would read as
            proBuild ignoring the new message. */}
        {previewUrl && inProgress && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-md">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              Updating preview...
            </div>
          </div>
        )}
        {/* The demo itself can take a few real seconds to render past its
            own loading shell — without this, that window just looks like a
            blank, broken preview instead of one that's still coming up. */}
        {previewUrl && !inProgress && isBooting && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70">
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-md">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              Loading preview...
            </div>
          </div>
        )}
        {/* Distinct from the boot overlay above: this only shows once the
            iframe has genuinely failed to load at all for a long time, not
            just during v0's normal cold-start window — build success and
            iframe rendering are deliberately kept separate (spec: never
            turn an iframe problem into a build failure), so this offers a
            way forward without touching build/project status at all. */}
        {previewUrl && !inProgress && !isBooting && isStuck && !hasLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/90 p-8">
            <div className="flex max-w-xs flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-4 text-center shadow-md">
              <p className="text-sm font-medium">Preview is taking longer than expected</p>
              <p className="text-xs text-muted-foreground">
                Your site is published and working — the embedded preview here is just slow to load.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-border/40 disabled:opacity-60"
                >
                  {isRefreshing ? "Retrying..." : "Retry preview"}
                </button>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                >
                  Open preview
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
