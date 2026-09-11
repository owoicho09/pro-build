"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { signup } from "./actions";

export function SignupForm({ next, googleEnabled }: { next?: string; googleEnabled: boolean }) {
  const [state, formAction, pending] = useActionState(signup, null);

  if (state?.success) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        Check your email for a confirmation link to finish creating your
        account.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {googleEnabled && (
        <>
          <GoogleAuthButton next={next} />
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-2 text-xs uppercase text-muted-foreground">or</span>
            </div>
          </div>
        </>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="space-y-1.5">
          <label htmlFor="fullName" className="text-sm font-medium">
            Name
          </label>
          <Input id="fullName" name="fullName" autoComplete="name" required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        {state?.error && (
          <div role="alert" className="space-y-1">
            <p className="text-sm text-danger">{state.error}</p>
            {state.alreadyRegistered && (
              <Link
                href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
                className="text-sm font-medium text-brand hover:underline"
              >
                Sign in instead
              </Link>
            )}
          </div>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating account..." : "Create account"}
        </Button>
      </form>
    </div>
  );
}
