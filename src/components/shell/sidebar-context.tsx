"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { readSidebarCollapsed, writeSidebarCollapsed } from "@/lib/sidebar-prefs";

interface SidebarContextValue {
  /** Explicit collapse override once known client-side; null = "use the CSS default for this breakpoint" (see sidebar.tsx). */
  collapsedOverride: boolean | null;
  setCollapsed: (value: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (value: boolean) => void;
  workspace: boolean;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({
  children,
  workspace = false,
}: {
  children: ReactNode;
  workspace?: boolean;
}) {
  // Starts null (no override — CSS default applies, matching SSR) and is
  // corrected once from localStorage after mount. Same trade-off as
  // theme-toggle.tsx's mounted flag: a saved non-default preference can
  // cause one brief layout adjustment on a hard reload, never on
  // client-side navigation (this provider stays mounted across those).
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a persisted preference that's inherently unknowable during render/SSR
    setCollapsedOverride(readSidebarCollapsed(workspace));
  }, [workspace]);

  function setCollapsed(value: boolean) {
    setCollapsedOverride(value);
    writeSidebarCollapsed(workspace, value);
  }

  return (
    <SidebarContext.Provider
      value={{ collapsedOverride, setCollapsed, mobileOpen, setMobileOpen, workspace }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
}
