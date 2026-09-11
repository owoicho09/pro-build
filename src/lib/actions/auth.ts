"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// Same PKCE code-exchange path as email confirmation — /auth/callback
// already handles this correctly for any provider, no changes needed there.
export async function signInWithGoogle(next?: string) {
  const supabase = await createClient();
  const safeNext = next && next.startsWith("/") ? next : "/dashboard";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(safeNext)}`,
    },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth_failed");
  }
  redirect(data.url);
}

// Lets a signed-out user with an unconfirmed account get a fresh
// confirmation email without retyping their signup — surfaced from the
// login form when signInWithPassword fails with error.code ===
// "email_not_confirmed" (see login/actions.ts).
export async function resendConfirmationEmail(email: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
  });

  if (error) {
    return { error: "Couldn't resend that email right now. Please try again shortly." };
  }
  return { success: true as const };
}
