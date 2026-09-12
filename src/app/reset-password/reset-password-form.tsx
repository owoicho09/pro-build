"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmPasswordReset } from "./actions";

export function ResetPasswordForm({ initialEmail }: { initialEmail: string }) {
  const [state, formAction, pending] = useActionState(confirmPasswordReset, null);

  if (state?.success) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-foreground">Your password has been reset.</p>
        <Link href="/login">
          <Button className="w-full">Sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input id="email" name="email" type="email" autoComplete="email" defaultValue={initialEmail} required />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="code" className="text-sm font-medium">
          4-digit code
        </label>
        <Input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          autoComplete="one-time-code"
          required
          className="text-center text-lg tracking-[0.5em]"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="newPassword" className="text-sm font-medium">
          New password
        </label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      {state?.error && (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Resetting..." : "Reset password"}
      </Button>
    </form>
  );
}
