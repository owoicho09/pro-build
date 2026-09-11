import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Direct Postgres connection, using the service-role/postgres URL — this
// connection does NOT go through PostgREST, so it does NOT automatically
// carry a user's JWT claims and RLS is effectively bypassed here.
//
// Only use this client from trusted, request-independent server contexts:
// cron jobs advancing builds, webhook handlers, admin scripts. Any code
// path that acts on behalf of a specific signed-in user (server actions,
// route handlers reachable from the browser) must go through the
// Supabase server client (lib/supabase/server.ts) instead, so RLS is
// enforced by Postgres itself rather than by application code remembering
// to check ownership every time.
declare global {
  var __pgPool: Pool | undefined;
}

const pool =
  globalThis.__pgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalThis.__pgPool = pool;
}

export const db = drizzle(pool, { schema });
