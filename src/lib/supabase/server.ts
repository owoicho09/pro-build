import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/db/types";

// Server-side Supabase client, scoped to the current request's cookies.
// Uses the anon key + RLS — never the service-role key. This is what every
// server component / server action / route handler should use to read or
// write data as the signed-in user.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component during render — the middleware
            // is responsible for refreshing the session in that case.
          }
        },
      },
    },
  );
}
