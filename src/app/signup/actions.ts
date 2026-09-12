"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendWelcomeIfNeeded } from "@/lib/services/notifications";

const signupSchema = z.object({
  fullName: z.string().min(1, "Name is required"),
  email: z.string().email(),
  password: z.string().min(8, "Use at least 8 characters"),
  next: z.string().optional(),
});

export async function signup(_prevState: unknown, formData: FormData) {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details and try again." };
  }

  const safeNext = parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : undefined;
  // Threaded through so the confirmation email lands the user back where
  // they started (e.g. /projects/new) instead of the default /dashboard —
  // requires "/auth/callback" to be allow-listed as a Supabase redirect URL
  // with query strings permitted (a wildcard entry covers this).
  const emailRedirectTo = safeNext
    ? `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(safeNext)}`
    : `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo,
    },
  });

  if (error) {
    // "Sign up again with an email that already has a confirmed account"
    // shouldn't dead-end on a generic Supabase message — point them at
    // Sign In directly instead of bouncing between the two pages.
    if (error.code === "user_already_exists") {
      return {
        error: "You already have an account with that email.",
        alreadyRegistered: true,
      };
    }
    return { error: error.message };
  }

  // Fired at account-creation time, not confirmation time — "when sign up"
  // — regardless of which branch below actually runs. Also called from
  // auth/callback/route.ts for the other signup paths (Google OAuth, and
  // this same email-confirmation-pending case once they click through);
  // sendWelcomeIfNeeded's atomic claim makes calling it from both places
  // safe, never a double-send.
  if (data.user) {
    await sendWelcomeIfNeeded({
      userId: data.user.id,
      email: parsed.data.email,
      fullName: parsed.data.fullName,
    }).catch((err) => console.error("Failed to send welcome email", data.user?.id, err));
  }

  // With Supabase's "Confirm email" setting off, signUp() returns an active
  // session immediately — no email step at all. Only show the "check your
  // email" state when that's actually true (session is null), so this
  // doesn't show a stale/wrong message the moment that setting changes.
  if (data.session) {
    redirect(safeNext ?? "/dashboard");
  }

  return { success: true };
}
