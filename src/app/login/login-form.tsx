"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { resendConfirmationEmail } from "@/lib/actions/auth";
import { login } from "./actions";

export function LoginForm({ next, googleEnabled }: { next?: string; googleEnabled: boolean }) {
  const [state, formAction, pending] = useActionState(login, null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleResend() {
    if (!state?.unconfirmedEmail) return;
    setResendState("sending");
    const result = await resendConfirmationEmail(state.unconfirmedEmail);
    setResendState(result.error ? "error" : "sent");
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
            autoComplete="current-password"
            required
          />
        </div>
        {state?.error && (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-danger">{state.error}</p>
            {state.unconfirmedEmail && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={resendState === "sending" || resendState === "sent"}
                onClick={handleResend}
              >
                {resendState === "sending"
                  ? "Sending..."
                  : resendState === "sent"
                    ? "Email sent — check your inbox"
                    : "Resend confirmation email"}
              </Button>
            )}
            {resendState === "error" && (
              <p className="text-xs text-danger">Couldn&apos;t resend that email. Please try again shortly.</p>
            )}
          </div>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
