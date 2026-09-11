"use client";

// Two independent keys, not one: regular app pages default expanded, the
// project workspace defaults to the collapsed icon rail (spec: "retain
// maximum space for Build + Preview") — a user collapsing the sidebar on
// /dashboard shouldn't force it collapsed inside a workspace too, and vice
// versa. Each remembers its own last explicit choice; absent one, the
// per-context default (and, for regular pages, the CSS-only tablet-width
// preference — see sidebar.tsx) applies.
const REGULAR_KEY = "probuild:sidebar-collapsed";
const WORKSPACE_KEY = "probuild:sidebar-collapsed-workspace";

function readBoolean(key: string): boolean | null {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
}

function writeBoolean(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Best-effort only — private browsing / storage-disabled shouldn't crash the toggle.
  }
}

export function readSidebarCollapsed(workspace: boolean): boolean | null {
  return readBoolean(workspace ? WORKSPACE_KEY : REGULAR_KEY);
}

export function writeSidebarCollapsed(workspace: boolean, value: boolean) {
  writeBoolean(workspace ? WORKSPACE_KEY : REGULAR_KEY, value);
}
