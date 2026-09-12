// Hand-written Supabase `Database` type covering the tables the Supabase
// JS client (not Drizzle) actually queries at runtime — i.e. user-facing
// reads/writes that must go through RLS. Drizzle's schema.ts remains the
// source of truth for table shape; once a live Supabase project exists,
// replace this file with the output of:
//
//   supabase gen types typescript --project-id <id> > src/db/types.ts
//
// and keep it in sync with schema.ts from then on.

export type ProjectStatus =
  | "draft"
  | "planning"
  | "building"
  | "preview_ready"
  | "needs_attention"
  | "publishing"
  | "live"
  | "failed";

export type MessageRole = "user" | "assistant" | "system";

export type BuildState = "queued" | "streaming" | "succeeded" | "failed" | "stopped";

export type AttachmentKind = "image" | "document" | "other";

export type DeploymentTarget = "preview" | "production";

export type DeploymentReadyState =
  | "queued"
  | "initializing"
  | "building"
  | "ready"
  | "error"
  | "canceled";

export type IntegrationStatus = "not_configured" | "configured" | "verified";

export type LedgerReason =
  | "monthly_grant"
  | "build_debit"
  | "purchase_credit"
  | "admin_adjustment"
  | "refund";

export type SubscriptionStatus = "active" | "past_due" | "canceled" | "incomplete";

export type TransactionType = "subscription" | "credit_purchase";

export type TransactionStatus = "pending" | "succeeded" | "failed";

export type DomainStatus = "pending_verification" | "verified" | "failed" | "removed";

export type DomainSource = "connected" | "purchased";

export type NotificationType =
  | "build_completed"
  | "build_failed"
  | "deployment_completed"
  | "deployment_failed"
  | "integration_attention";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          plan_id: string | null;
          paystack_customer_code: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      templates: {
        Row: {
          id: string;
          slug: string;
          name: string;
          tagline: string | null;
          description: string | null;
          category: string;
          thumbnail_url: string | null;
          is_premium: boolean;
          is_published: boolean;
          sort_order: number;
          uses_count: number;
          build_prompt: string;
          system_instructions: string | null;
          source_v0_project_id: string | null;
          source_v0_chat_id: string | null;
          source_version_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["templates"]["Row"]> & {
          slug: string;
          name: string;
          category: string;
          build_prompt: string;
        };
        Update: Partial<Database["public"]["Tables"]["templates"]["Row"]>;
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          description: string | null;
          status: ProjectStatus;
          template_id: string | null;
          v0_project_id: string | null;
          v0_chat_id: string | null;
          vercel_project_id: string | null;
          production_deployment_id: string | null;
          production_url: string | null;
          thumbnail_url: string | null;
          preview_url: string | null;
          preview_url_checked_at: string | null;
          last_activity_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["projects"]["Row"]> & {
          owner_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Row"]>;
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          project_id: string;
          role: MessageRole;
          content: string;
          v0_message_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["messages"]["Row"]> & {
          project_id: string;
          role: MessageRole;
          content: string;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Row"]>;
        Relationships: [];
      };
      builds: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          trigger_message_id: string | null;
          v0_message_id: string | null;
          state: BuildState;
          error_code: string | null;
          error_message: string | null;
          tokens_used: number | null;
          credits_cost: number | null;
          started_at: string;
          dispatched_at: string | null;
          dispatch_attempts: number;
          last_dispatch_attempt_at: string | null;
          repair_attempts: number;
          validation_error: string | null;
          finished_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["builds"]["Row"]> & {
          project_id: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["builds"]["Row"]>;
        Relationships: [];
      };
      attachments: {
        Row: {
          id: string;
          project_id: string;
          message_id: string | null;
          owner_id: string;
          storage_path: string;
          mime_type: string;
          original_filename: string;
          kind: AttachmentKind;
          extracted_text: string | null;
          included_in_builder: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["attachments"]["Row"]> & {
          project_id: string;
          owner_id: string;
          storage_path: string;
          mime_type: string;
          original_filename: string;
          kind: AttachmentKind;
        };
        Update: Partial<Database["public"]["Tables"]["attachments"]["Row"]>;
        Relationships: [];
      };
      deployments: {
        Row: {
          id: string;
          project_id: string;
          vercel_deployment_id: string;
          target: DeploymentTarget;
          ready_state: DeploymentReadyState;
          url: string | null;
          is_current_production: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["deployments"]["Row"]> & {
          project_id: string;
          vercel_deployment_id: string;
          target: DeploymentTarget;
        };
        Update: Partial<Database["public"]["Tables"]["deployments"]["Row"]>;
        Relationships: [];
      };
      project_integrations: {
        Row: {
          id: string;
          project_id: string;
          provider: string;
          status: IntegrationStatus;
          required_env_vars: unknown;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["project_integrations"]["Row"]> & {
          project_id: string;
          provider: string;
        };
        Update: Partial<Database["public"]["Tables"]["project_integrations"]["Row"]>;
        Relationships: [];
      };
      // project_secrets is intentionally NOT exposed here — RLS denies the
      // client (even an authenticated one) all access to it unconditionally
      // (see rls.sql: "project_secrets_no_client_access"). Every read/write
      // goes through the service-role admin client in
      // src/lib/services/integrations.ts, never through createClient().
      plans: {
        Row: {
          id: string;
          name: string;
          price_cents: number;
          monthly_credits: number;
          project_limit: number;
          rate_limits: { builds_per_hour?: number } | null;
          features: unknown;
          active: boolean;
          paystack_plan_code: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["plans"]["Row"]> & {
          id: string;
          name: string;
          monthly_credits: number;
          project_limit: number;
        };
        Update: Partial<Database["public"]["Tables"]["plans"]["Row"]>;
        Relationships: [];
      };
      credit_ledger: {
        Row: {
          id: string;
          user_id: string;
          project_id: string | null;
          delta: number;
          balance_after: number;
          reason: LedgerReason;
          reference_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["credit_ledger"]["Row"]> & {
          user_id: string;
          delta: number;
          balance_after: number;
          reason: LedgerReason;
        };
        Update: Partial<Database["public"]["Tables"]["credit_ledger"]["Row"]>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan_id: string;
          status: SubscriptionStatus;
          paystack_subscription_code: string | null;
          paystack_email_token: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["subscriptions"]["Row"]> & {
          user_id: string;
          plan_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscriptions"]["Row"]>;
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          user_id: string;
          type: TransactionType;
          amount_cents: number;
          provider: string;
          provider_reference: string;
          status: TransactionStatus;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["transactions"]["Row"]> & {
          user_id: string;
          type: TransactionType;
          amount_cents: number;
          provider_reference: string;
        };
        Update: Partial<Database["public"]["Tables"]["transactions"]["Row"]>;
        Relationships: [];
      };
      domains: {
        Row: {
          id: string;
          owner_id: string;
          project_id: string | null;
          domain_name: string;
          status: DomainStatus;
          verification_json: unknown;
          dns_instructions: string | null;
          ssl_status: string | null;
          source: DomainSource;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["domains"]["Row"]> & {
          owner_id: string;
          domain_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["domains"]["Row"]>;
        Relationships: [];
      };
      rate_limit_events: {
        Row: {
          id: string;
          user_id: string;
          action: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["rate_limit_events"]["Row"]> & {
          user_id: string;
          action: string;
        };
        Update: Partial<Database["public"]["Tables"]["rate_limit_events"]["Row"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: NotificationType;
          project_id: string | null;
          payload: unknown;
          read_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["notifications"]["Row"]> & {
          user_id: string;
          type: NotificationType;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
