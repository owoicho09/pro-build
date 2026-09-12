import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Forgot your password?</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send you a code to reset it.
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
