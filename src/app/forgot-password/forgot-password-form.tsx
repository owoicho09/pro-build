"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "./actions";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(requestPasswordReset, null);

  if (state?.success) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-foreground">{state.message}</p>
        <Button className="w-full" onClick={() => router.push(`/reset-password?email=${encodeURIComponent(state.email)}`)}>
          Enter code
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state?.error && (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending..." : "Send code"}
      </Button>
    </form>
  );
}
