import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";

// Service-role client. Bypasses RLS entirely — only for trusted server-side
// contexts with no request-scoped user (webhooks, cron/background jobs).
// Never import this into anything reachable from a request made on behalf
// of a specific user; use lib/supabase/server.ts for that.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
