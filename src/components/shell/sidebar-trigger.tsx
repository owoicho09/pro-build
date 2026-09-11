"use client";

import { Menu } from "lucide-react";
import { useSidebar } from "./sidebar-context";
import { cn } from "@/lib/utils";

// The hamburger that opens the mobile drawer (see sidebar.tsx). Rendered
// either by AppShell's own default mobile bar, or embedded directly inside
// a page's custom contextual header (e.g. the workspace top bar) — either
// way it opens the exact same drawer via SidebarContext, so there's only
// ever one navigation implementation, never a second mobile-only nav.
export function SidebarTrigger({ className }: { className?: string }) {
  const { setMobileOpen } = useSidebar();

  return (
    <button
      type="button"
      onClick={() => setMobileOpen(true)}
      aria-label="Open navigation menu"
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-border/40 md:hidden",
        className,
      )}
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
