"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PenSquare,
  LayoutGrid,
  LayoutTemplate,
  Coins,
  Settings as SettingsIcon,
  ChevronsLeft,
  ChevronsRight,
  LogIn,
  UserPlus,
  Sparkles,
  X,
  Loader2,
} from "lucide-react";
import { useSidebar } from "./sidebar-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationsBell } from "@/components/notifications-bell";
import { UserMenu } from "./user-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Database } from "@/db/types";

type Notification = Database["public"]["Tables"]["notifications"]["Row"];

const PRIMARY_ITEMS = [
  { href: "/projects/new", label: "Create", icon: PenSquare },
  { href: "/dashboard", label: "Projects", icon: LayoutGrid },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
] as const;

export type Mode = "auto" | "expanded" | "collapsed";

export interface SidebarData {
  authenticated: boolean;
  balance: number | null;
  notifications: Notification[];
  activeBuildCount: number;
  userEmail: string | null;
  userName: string | null;
  showUpgradeCard: boolean;
}

// Every className below is a single flat string per branch, never a
// composed "base + responsive variant" string for the explicit-override
// case — Tailwind's generated stylesheet order would otherwise let a
// breakpoint-scoped utility (e.g. lg:w-60) beat a plain override (w-16)
// regardless of source order in the className, silently breaking "the
// user's explicit choice wins at any width".
export function widthClass(mode: Mode, workspace: boolean) {
  if (mode === "collapsed") return "w-16";
  if (mode === "expanded") return "w-60";
  return workspace ? "w-16" : "w-16 lg:w-60";
}

// Visible when NOT collapsed. `display` must match whatever display value
// `extra` relies on (e.g. pass "flex"/"block" for an element whose extra
// classes include layout like "flex items-center ..."). Getting this wrong
// isn't just cosmetic: cn()/twMerge dedupes conflicting display utilities
// (hidden/inline/block/flex all belong to the same CSS-property group) and
// keeps only the LAST one in source order — so `extra` is placed first and
// the mode-driven visibility class placed last, guaranteeing the intended
// visibility always wins instead of being silently clobbered by whatever
// display utility `extra` happens to also declare.
export function expandedOnly(
  mode: Mode,
  workspace: boolean,
  extra?: string,
  display: "inline" | "block" | "flex" = "inline",
) {
  const visibility =
    mode === "collapsed" ? "hidden" : mode === "expanded" ? display : workspace ? "hidden" : `hidden lg:${display}`;
  return cn(extra, visibility);
}

// Visible only when collapsed — the inverse of expandedOnly, used for the
// icon-mark logo shown in the icon rail. Same display-param/ordering
// requirement as expandedOnly above.
export function collapsedOnly(
  mode: Mode,
  workspace: boolean,
  extra?: string,
  display: "inline" | "block" | "flex" = "inline",
) {
  const visibility =
    mode === "collapsed" ? display : mode === "expanded" ? "hidden" : workspace ? display : `${display} lg:hidden`;
  return cn(extra, visibility);
}

export function rowJustifyClass(mode: Mode, workspace: boolean) {
  if (mode === "collapsed") return "justify-center";
  if (mode === "expanded") return "justify-start";
  return workspace ? "justify-center" : "justify-center lg:justify-start";
}

function SectionLabel({
  mode,
  workspace,
  first,
  children,
}: {
  mode: Mode;
  workspace: boolean;
  first?: boolean;
  children: string;
}) {
  return (
    <>
      {/* Collapsed rail hides the text label entirely, so a thin divider
          takes over as the "new group" signal instead (skipped before the
          very first group, right under the logo, where it'd be redundant). */}
      {!first && <div className={collapsedOnly(mode, workspace, "mx-2 my-1.5 h-px bg-border", "block")} />}
      <p
        className={expandedOnly(
          mode,
          workspace,
          "px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
          "block",
        )}
      >
        {children}
      </p>
    </>
  );
}

function NavRow({
  href,
  label,
  icon: Icon,
  active,
  mode,
  workspace,
  badge,
}: {
  href: string;
  label: string;
  icon: typeof PenSquare;
  active: boolean;
  mode: Mode;
  workspace: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors",
        rowJustifyClass(mode, workspace),
        active ? "bg-brand/10 text-brand" : "text-muted-foreground hover:bg-border/30 hover:text-foreground",
      )}
    >
      <span className="relative shrink-0">
        <Icon className="h-4 w-4" />
        {/* Collapsed rail is only 64px wide — a full pill badge next to the
            icon would overflow it, so collapsed gets a small overlay dot
            with the count instead of the expanded row's inline pill. */}
        {!!badge && (
          <span
            className={collapsedOnly(
              mode,
              workspace,
              "absolute -right-1.5 -top-1.5 h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-0.5 text-[9px] font-semibold leading-none text-brand-foreground",
              "flex",
            )}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      <span className={expandedOnly(mode, workspace, "min-w-0 flex-1 truncate")}>{label}</span>
      {!!badge && (
        <span
          className={expandedOnly(
            mode,
            workspace,
            "h-5 min-w-5 items-center justify-center rounded-full bg-brand/10 px-1 text-xs font-medium text-brand",
            "flex",
          )}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

function SidebarContents({
  data,
  mode,
  workspace,
}: {
  data: SidebarData;
  mode: Mode;
  workspace: boolean;
}) {
  const pathname = usePathname();
  const { authenticated, balance, notifications, activeBuildCount, userEmail, userName, showUpgradeCard } = data;

  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      {/*
        Deliberately no overflow-y-auto here: per the CSS spec, setting only
        overflow-y on an element implicitly computes its overflow-x as
        "auto" too (a visible value on one axis becomes auto once the other
        axis is non-visible) — which would clip the notifications flyout
        below, since it's an absolutely-positioned child that opens
        sideways (left-full) out of this container's bounds. The nav item
        count here is small enough to just fit without its own scroll
        region; only the flyout's own notification list scrolls internally.
      */}
      <div className="flex-1 space-y-1">
        <SectionLabel mode={mode} workspace={workspace} first>
          Primary
        </SectionLabel>
        {PRIMARY_ITEMS.map((item) => (
          <NavRow key={item.href} {...item} active={pathname === item.href} mode={mode} workspace={workspace} />
        ))}

        {authenticated && (
          <>
            <SectionLabel mode={mode} workspace={workspace}>
              Activity
            </SectionLabel>
            {activeBuildCount > 0 && (
              <NavRow
                href="/dashboard"
                label="Active builds"
                icon={Loader2}
                active={false}
                mode={mode}
                workspace={workspace}
                badge={activeBuildCount}
              />
            )}
            <NotificationsBell initial={notifications} label="Notifications" mode={mode} workspace={workspace} />

            <SectionLabel mode={mode} workspace={workspace}>
              Account
            </SectionLabel>
            <NavRow
              href="/billing"
              label={balance !== null ? `${balance.toLocaleString()} credits` : "Credits & usage"}
              icon={Coins}
              active={pathname === "/billing"}
              mode={mode}
              workspace={workspace}
            />
            <NavRow
              href="/settings"
              label="Settings"
              icon={SettingsIcon}
              active={pathname === "/settings"}
              mode={mode}
              workspace={workspace}
            />
          </>
        )}
      </div>

      <div className="mt-2 space-y-2 border-t border-border pt-2">
        {authenticated ? (
          <>
            {showUpgradeCard && (
              <Link
                href="/billing"
                className={expandedOnly(
                  mode,
                  workspace,
                  "items-center gap-2 rounded-xl bg-brand/10 px-3 py-2.5 text-xs font-medium text-brand hover:bg-brand/15",
                  "flex",
                )}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span>Upgrade for more credits</span>
              </Link>
            )}
            <UserMenu name={userName} email={userEmail ?? ""} mode={mode} workspace={workspace} />
            <div className={cn("flex", rowJustifyClass(mode, workspace))}>
              <ThemeToggle />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-stretch gap-2 px-1">
            <div className={cn("flex", rowJustifyClass(mode, workspace))}>
              <ThemeToggle />
            </div>
            <Link href="/login" title="Sign in">
              <Button variant="ghost" size="sm" className="w-full">
                <LogIn className={collapsedOnly(mode, workspace, "h-4 w-4")} />
                <span className={expandedOnly(mode, workspace)}>Sign in</span>
              </Button>
            </Link>
            <Link href="/signup" title="Get started">
              <Button size="sm" className="w-full">
                <UserPlus className={collapsedOnly(mode, workspace, "h-4 w-4")} />
                <span className={expandedOnly(mode, workspace)}>Get started</span>
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export function Sidebar({ data }: { data: SidebarData }) {
  const { collapsedOverride, workspace, setCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const mode: Mode = collapsedOverride === null ? "auto" : collapsedOverride ? "collapsed" : "expanded";
  const drawerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // In "auto" mode the visually-collapsed state depends on the current
  // breakpoint (CSS alone decides it — see widthClass), which JS can't
  // know during render without risking a hydration mismatch. It's safe to
  // check here, though: this only runs inside a user-initiated click, never
  // during render/SSR, so the very first explicit choice correctly flips
  // from whatever is actually showing instead of guessing.
  function handleToggle() {
    if (collapsedOverride !== null) {
      setCollapsed(!collapsedOverride);
      return;
    }
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    const currentlyCollapsed = workspace || !isDesktop;
    setCollapsed(!currentlyCollapsed);
  }

  // Render-time sync (same idiom used across this app) — close the drawer
  // as soon as the route changes, without a setState-in-effect.
  const [syncedPathname, setSyncedPathname] = useState(pathname);
  if (pathname !== syncedPathname) {
    setSyncedPathname(pathname);
    setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen) return;
    drawerRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, setMobileOpen]);

  return (
    <>
      {/* Persistent desktop/tablet sidebar — subtle-tint canvas background
          (not a white card) so it reads as part of the shell, with white
          content cards elevated a step above it. */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 ease-in-out md:flex",
          widthClass(mode, workspace),
        )}
      >
        <div className={cn("flex items-center gap-1 px-2.5 pb-3 pt-4", rowJustifyClass(mode, workspace))}>
          <Link
            href="/dashboard"
            aria-label="proBuild"
            className={expandedOnly(mode, workspace, "flex-1 items-center overflow-hidden", "flex")}
          >
            <Image src="/logo.png" alt="proBuild" width={2172} height={724} priority className="h-6 w-auto" />
          </Link>
          <Link
            href="/dashboard"
            aria-label="proBuild"
            title="proBuild"
            className={collapsedOnly(mode, workspace, "h-8 w-8 items-center justify-center", "flex")}
          >
            <Image src="/icon-mark.png" alt="" width={512} height={512} priority className="h-8 w-8" />
          </Link>
          <button
            type="button"
            onClick={handleToggle}
            aria-label="Toggle sidebar"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-border/40"
          >
            <ChevronsLeft className={expandedOnly(mode, workspace, "h-4 w-4")} />
            <ChevronsRight className={collapsedOnly(mode, workspace, "h-4 w-4")} />
          </button>
        </div>
        <SidebarContents data={data} mode={mode} workspace={workspace} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <div
            ref={drawerRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col bg-background shadow-lg outline-none"
          >
            <div className="flex items-center justify-between px-3 pb-3 pt-4">
              <Image src="/logo.png" alt="proBuild" width={2172} height={724} className="h-6 w-auto" />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-border/40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContents data={data} mode="expanded" workspace={false} />
          </div>
        </div>
      )}
    </>
  );
}
