"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
  next: z.string().optional(),
});

export async function login(_prevState: unknown, formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Distinguish "account exists but hasn't confirmed their email yet" from
    // a genuinely wrong password — error.code is a stable, documented value
    // (@supabase/auth-js's ErrorCode union), not a fragile string match on
    // error.message. Telling the user the real reason (and letting them
    // resend the email from right here) avoids the confusing bounce between
    // Sign In and Sign Up that happens when this just says "wrong password".
    if (error.code === "email_not_confirmed") {
      return {
        error: "Confirm your email to finish signing in — check your inbox for the link we sent.",
        unconfirmedEmail: parsed.data.email,
      };
    }
    return { error: "That email or password doesn't look right." };
  }

  redirect(parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : "/dashboard");
}
