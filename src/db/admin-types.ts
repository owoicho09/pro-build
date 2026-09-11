// Extends the client-facing Database type with `project_secrets` — the one
// table RLS denies to every client context unconditionally (see rls.sql),
// so it's deliberately excluded from src/db/types.ts as a safety net. This
// file exists so the one legitimate caller (src/lib/services/integrations.ts,
// via the service-role admin client) still gets typed access, without
// making that table visible/queryable through the regular Database type
// that createClient() and every RLS-scoped call site uses.
import type { Database } from "./types";

export interface AdminDatabase extends Database {
  public: Database["public"] & {
    Tables: Database["public"]["Tables"] & {
      project_secrets: {
        Row: {
          id: string;
          project_integration_id: string;
          env_key: string;
          encrypted_value: string;
          vercel_env_id: string | null;
          created_at: string;
        };
        Insert: Partial<AdminDatabase["public"]["Tables"]["project_secrets"]["Row"]> & {
          project_integration_id: string;
          env_key: string;
          encrypted_value: string;
        };
        Update: Partial<AdminDatabase["public"]["Tables"]["project_secrets"]["Row"]>;
        Relationships: [];
      };
    };
  };
}
