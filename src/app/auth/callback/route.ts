import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWelcomeIfNeeded } from "@/lib/services/notifications";

// Handles the Supabase email-confirmation / magic-link redirect: exchanges
// the one-time code in the URL for a session cookie, then sends the user
// into the app. This is also the universal landing point for Google OAuth
// and for email/password signup when "Confirm email" is on — the other
// signup path (immediate-session email/password) never reaches this route
// at all, so it sends its own welcome email directly in
// signup/actions.ts. sendWelcomeIfNeeded's atomic claim makes it safe to
// call from both places.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (data.user) {
        await sendWelcomeIfNeeded({
          userId: data.user.id,
          email: data.user.email ?? "",
          fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null,
        }).catch((err) => console.error("Failed to send welcome email", data.user?.id, err));
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
