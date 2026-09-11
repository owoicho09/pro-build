import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LandingCreateBox } from "@/components/landing-create-box";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Image src="/logo.png" alt="proBuild" width={2172} height={724} priority className="h-7 w-auto" />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          What do you want to create?
        </h1>
        <p className="mt-4 max-w-xl text-balance text-muted-foreground">
          Describe your idea in plain language. No terminal, no Git, no
          deployment settings — proBuild builds it and keeps working on it
          with you.
        </p>
        <div className="mt-8 flex w-full flex-col items-center">
          <LandingCreateBox />
        </div>
        <Link href="/templates" className="mt-6 text-sm text-muted-foreground hover:text-foreground hover:underline">
          Or start with a template
        </Link>
      </main>
    </div>
  );
}
