"use client";

// Persisted width of the Build/conversation pane, as a percent of the
// workspace's two-pane row (spec target: ~32-38%, default 35). Same
// localStorage pattern as sidebar-prefs.ts.
const KEY = "probuild:workspace-build-width-pct";

export const DEFAULT_BUILD_WIDTH_PCT = 35;
export const MIN_BUILD_WIDTH_PCT = 22;
export const MAX_BUILD_WIDTH_PCT = 45;

export function readBuildWidthPct(): number | null {
  try {
    const value = window.localStorage.getItem(KEY);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBuildWidthPct(pct: number) {
  try {
    window.localStorage.setItem(KEY, String(pct));
  } catch {
    // Best-effort only.
  }
}
