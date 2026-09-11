"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import type { Database } from "@/db/types";
import { markNotificationsRead } from "@/lib/actions/notifications";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time-ago";
import { collapsedOnly, expandedOnly, rowJustifyClass, type Mode } from "@/components/shell/sidebar";

type Notification = Database["public"]["Tables"]["notifications"]["Row"];

// Client-safe mirror of the copy in src/lib/services/notifications.ts
// (that file is server-only — it also sends email — so a short duplicate
// here is simpler than splitting copy out into a third shared module for
// one line of text per type).
const LABEL: Record<Notification["type"], string> = {
  build_completed: "finished building",
  build_failed: "build failed",
  deployment_completed: "is live",
  deployment_failed: "publish failed",
  integration_attention: "needs a quick setup step",
};

// `label`/`mode`/`workspace` are only passed from the sidebar (see
// shell/sidebar.tsx) — they make this render as a full nav-row (icon,
// label, unread count) matching the other sidebar items instead of a bare
// icon button. The dropdown opens to the right (`left-full`) rather than
// the old header's `right-0`, since this now lives at the screen's left
// edge — anchoring right would push the panel off-screen.
export function NotificationsBell({
  initial,
  label,
  mode = "expanded",
  workspace = false,
}: {
  initial: Notification[];
  label?: string;
  mode?: Mode;
  workspace?: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.read_at);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && unread.length > 0) {
      const ids = unread.map((n) => n.id);
      setItems((prev) =>
        prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      await markNotificationsRead(ids);
    }
  }

  const asRow = label !== undefined;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        aria-label="Notifications"
        aria-haspopup="true"
        aria-expanded={open}
        title={asRow ? label : "Notifications"}
        className={
          asRow
            ? cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-border/30 hover:text-foreground",
                rowJustifyClass(mode, workspace),
              )
            : "relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-border/40"
        }
      >
        <span className="relative shrink-0">
          <Bell className="h-4 w-4" />
          {unread.length > 0 && !asRow && (
            <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-danger" />
          )}
          {/* Collapsed rail: same small overlay-dot treatment as the other
              sidebar count badges, since the full pill below only fits the
              expanded row. */}
          {asRow && unread.length > 0 && (
            <span
              className={collapsedOnly(
                mode,
                workspace,
                "absolute -right-1.5 -top-1.5 h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-0.5 text-[9px] font-semibold leading-none text-brand-foreground",
                "flex",
              )}
            >
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </span>
        {asRow && <span className={expandedOnly(mode, workspace, "min-w-0 flex-1 truncate text-left")}>{label}</span>}
        {asRow && unread.length > 0 && (
          <span
            className={expandedOnly(
              mode,
              workspace,
              "h-5 min-w-5 items-center justify-center rounded-full bg-brand/10 px-1 text-xs font-medium text-brand",
              "flex",
            )}
          >
            {unread.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[45]" onClick={() => setOpen(false)} />
          <div
            className={cn(
              "absolute z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-2 shadow-lg",
              asRow ? "left-0 top-full sm:left-full sm:top-0 sm:mt-0 sm:ml-2" : "right-0",
            )}
          >
          {items.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No notifications yet.</p>
          ) : (
            <ul className="max-h-96 space-y-1 overflow-y-auto">
              {items.map((notification) => {
                const payload = (notification.payload ?? {}) as { url?: string };
                const content = (
                  <div
                    className={
                      "rounded-md p-2 text-xs " +
                      (notification.read_at ? "text-muted-foreground" : "bg-brand/5 text-foreground")
                    }
                  >
                    <p>
                      Project {LABEL[notification.type] ?? notification.type}
                      {notification.type === "deployment_completed" && payload.url ? (
                        <> — {payload.url}</>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      {timeAgo(notification.created_at)}
                    </p>
                  </div>
                );
                return (
                  <li key={notification.id}>
                    {notification.project_id ? (
                      <Link href={`/projects/${notification.project_id}`} onClick={() => setOpen(false)}>
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          </div>
        </>
      )}
    </div>
  );
}
