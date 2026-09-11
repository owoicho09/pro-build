"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";
import { expandedOnly, rowJustifyClass, type Mode } from "./sidebar";

// Avatar + name/email + account menu — spec §3/§21's "user avatar/name/
// email, account menu". "Settings" already has its own row in the Account
// nav section above this, so the menu itself stays to just Sign out rather
// than duplicating that link. The whole row is the trigger (not a separate
// small button) so it still works when collapsed to the icon rail, where
// only the avatar is visible.
export function UserMenu({
  name,
  email,
  mode,
  workspace,
}: {
  name: string | null;
  email: string;
  mode: Mode;
  workspace: boolean;
}) {
  const [open, setOpen] = useState(false);
  const initial = (name?.trim()?.[0] ?? email[0] ?? "?").toUpperCase();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-haspopup="true"
        aria-expanded={open}
        title={name || email}
        className={cn(
          "flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 hover:bg-border/30",
          rowJustifyClass(mode, workspace),
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand">
          {initial}
        </div>
        <div className={expandedOnly(mode, workspace, "min-w-0 flex-1 text-left")}>
          <p className="truncate text-sm font-medium">{name || email}</p>
          {name && <p className="truncate text-xs text-muted-foreground">{email}</p>}
        </div>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute bottom-full left-0 z-50 mb-2 w-48 rounded-xl border border-border bg-card p-1 shadow-lg"
          >
            <p className="truncate px-2.5 py-1.5 text-xs text-muted-foreground">{email}</p>
            <form action={logout}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-border/40"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
