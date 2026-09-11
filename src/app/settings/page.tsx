import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/lib/actions/auth";

// Deliberately minimal — a real destination for the sidebar's "Settings"
// item, distinct from "Credits & usage" (/billing), rather than a second
// place to configure things that already have a home. Reuses ThemeToggle
// and the existing logout action; doesn't duplicate either.
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/settings");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your account and preferences.</p>

        <Card className="mt-8 space-y-4 p-5">
          <h2 className="text-sm font-semibold">Profile</h2>
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">Name</p>
            <p>{profile?.full_name ?? "—"}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">Email</p>
            <p>{user.email}</p>
          </div>
        </Card>

        <Card className="mt-4 flex items-center justify-between p-5">
          <div>
            <h2 className="text-sm font-semibold">Appearance</h2>
            <p className="mt-1 text-sm text-muted-foreground">Light, dark, or match your system.</p>
          </div>
          <ThemeToggle />
        </Card>

        <Card className="mt-4 flex items-center justify-between p-5">
          <div>
            <h2 className="text-sm font-semibold">Credits & billing</h2>
            <p className="mt-1 text-sm text-muted-foreground">Plan, usage, and payment.</p>
          </div>
          <Link href="/billing">
            <Button variant="secondary" size="sm">
              Open
            </Button>
          </Link>
        </Card>

        <Card className="mt-4 flex items-center justify-between p-5">
          <div>
            <h2 className="text-sm font-semibold">Sign out</h2>
            <p className="mt-1 text-sm text-muted-foreground">End your session on this device.</p>
          </div>
          <form action={logout}>
            <Button variant="ghost" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
