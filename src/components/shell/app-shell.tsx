import type { ReactNode } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { getCreditBalance, getActiveBuildCount } from "@/lib/services/usage";
import { getRecentNotifications } from "@/lib/services/notifications";
import { SidebarProvider } from "./sidebar-context";
import { Sidebar, type SidebarData } from "./sidebar";
import { SidebarTrigger } from "./sidebar-trigger";

// The one reusable application shell — every authenticated-app route
// (dashboard, create, templates, billing, settings, the project workspace)
// renders this instead of assembling its own header/nav, so there is
// exactly one sidebar implementation, not one per page.
//
// `header`: when provided, replaces the default mobile-only hamburger bar
// and is shown at EVERY breakpoint instead — for pages with real contextual
// content (currently just the project workspace's back/name/status/publish
// bar). When omitted, a minimal bar with just the hamburger + wordmark
// shows on mobile only, since the persistent sidebar covers desktop/tablet.
//
// `workspace`: sidebar defaults to the collapsed icon rail (its own,
// separate persisted preference — see lib/sidebar-prefs.ts) and `<main>`
// gets `overflow-hidden` instead of `overflow-y-auto` so the workspace's
// own two-pane layout can manage its own internal scroll regions.
export async function AppShell({
  children,
  header,
  workspace = false,
}: {
  children: ReactNode;
  header?: ReactNode;
  workspace?: boolean;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [balance, notifications, activeBuildCount, profile] = user
    ? await Promise.all([
        getCreditBalance(supabase, user.id),
        getRecentNotifications(supabase, user.id),
        getActiveBuildCount(supabase),
        supabase.from("profiles").select("full_name, plan_id").eq("id", user.id).single(),
      ])
    : [null, [], 0, null];

  const sidebarData: SidebarData = {
    authenticated: !!user,
    balance,
    notifications,
    activeBuildCount,
    userEmail: user?.email ?? null,
    userName: (profile && "data" in profile ? profile.data?.full_name : null) ?? null,
    // Restrained "optional upgrade card" (spec §21) — only for the free
    // plan; anyone already on a paid plan never sees it.
    showUpgradeCard: (profile && "data" in profile ? profile.data?.plan_id : null) === "free",
  };

  return (
    <SidebarProvider workspace={workspace}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar data={sidebarData} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {header ?? (
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 md:hidden">
              <SidebarTrigger />
              <Image src="/logo.png" alt="proBuild" width={2172} height={724} className="h-6 w-auto" />
            </div>
          )}
          <main className={workspace ? "flex min-h-0 flex-1 flex-col" : "flex-1 overflow-y-auto"}>
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
