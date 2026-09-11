import Link from "next/link";
import { LoginForm } from "./login-form";
import { isGoogleOAuthEnabled } from "@/lib/supabase/oauth-providers";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const googleEnabled = await isGoogleOAuthEnabled();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to keep building your project.
          </p>
        </div>
        <LoginForm next={next} googleEnabled={googleEnabled} />
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
            className="font-medium text-brand hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
