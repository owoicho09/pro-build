import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the Supabase email-confirmation / magic-link redirect: exchanges
// the one-time code in the URL for a session cookie, then sends the user
// into the app.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
