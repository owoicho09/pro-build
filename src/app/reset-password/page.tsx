import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Enter your code</h1>
          <p className="text-sm text-muted-foreground">
            Check your email for the 4-digit code and choose a new password.
          </p>
        </div>
        <ResetPasswordForm initialEmail={email ?? ""} />
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/forgot-password" className="font-medium text-brand hover:underline">
            Didn&apos;t get a code? Request another
          </Link>
        </p>
      </div>
    </div>
  );
}
