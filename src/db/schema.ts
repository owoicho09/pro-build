import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const projectStatusEnum = pgEnum("project_status", [
  "draft",
  "planning",
  "building",
  "preview_ready",
  "needs_attention",
  "publishing",
  "live",
  "failed",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

export const buildStateEnum = pgEnum("build_state", [
  "queued",
  "streaming",
  "succeeded",
  "failed",
  "stopped",
]);

export const deploymentTargetEnum = pgEnum("deployment_target", [
  "preview",
  "production",
]);

export const deploymentReadyStateEnum = pgEnum("deployment_ready_state", [
  "queued",
  "initializing",
  "building",
  "ready",
  "error",
  "canceled",
]);

export const domainStatusEnum = pgEnum("domain_status", [
  "pending_verification",
  "verified",
  "failed",
  "removed",
]);

export const domainSourceEnum = pgEnum("domain_source", [
  "connected",
  "purchased",
]);

export const integrationStatusEnum = pgEnum("integration_status", [
  "not_configured",
  "configured",
  "verified",
]);

export const usageEventTypeEnum = pgEnum("usage_event_type", [
  "build_generation",
  "manual_adjustment",
]);

export const ledgerReasonEnum = pgEnum("ledger_reason", [
  "monthly_grant",
  "build_debit",
  "purchase_credit",
  "admin_adjustment",
  "refund",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "subscription",
  "credit_purchase",
]);

export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "succeeded",
  "failed",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "canceled",
  "incomplete",
]);

export const attachmentKindEnum = pgEnum("attachment_kind", [
  "image",
  "document",
  "other",
]);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

// Mirrors a row in Supabase's auth.users — created via a DB trigger on
// signup. This table only holds platform-specific profile data.
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // == auth.users.id
  fullName: text("full_name"),
  planId: text("plan_id")
    .references(() => plans.id)
    .default("free"),
  paystackCustomerCode: text("paystack_customer_code"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// A known, reusable project starting state — not just a prompt suggestion.
// "Use Template" clones this into a real user-owned project by replaying
// buildPrompt through the normal build pipeline (see
// src/lib/services/templates.ts for why: the installed v0-sdk does expose
// chats.fork(), but its exact fidelity/billing/cross-account behavior is
// unverified without a live-key spike, so cloning goes through the same
// startOrContinueBuild() every other build uses rather than a new,
// unverified code path). category is plain text, not an enum, so adding a
// category later never requires a migration.
export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    description: text("description"),
    category: text("category").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    isPremium: boolean("is_premium").notNull().default(false),
    isPublished: boolean("is_published").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    usesCount: integer("uses_count").notNull().default(0),
    buildPrompt: text("build_prompt").notNull(),
    systemInstructions: text("system_instructions"),
    // Reference to the "golden" build this template's copy was authored
    // against — for admin inspection and as the fork() source if/when
    // Option B (see templates.ts) is adopted later.
    sourceV0ProjectId: text("source_v0_project_id"),
    sourceV0ChatId: text("source_v0_chat_id"),
    sourceVersionId: text("source_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("templates_slug_idx").on(table.slug)],
);

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("draft"),
    // Set only when this project was created via "Use Template" — later
    // edits to the template must never mutate projects already cloned from
    // it, so this is just a provenance pointer, not a live link.
    templateId: uuid("template_id").references(() => templates.id, {
      onDelete: "set null",
    }),

    // External resource mapping — the whole point of Check 3. v0 models a
    // "Project" as a container above "chat" (shared env vars + the Vercel
    // project link), so both ids are tracked, not just the chat.
    v0ProjectId: text("v0_project_id"),
    v0ChatId: text("v0_chat_id"),
    vercelProjectId: text("vercel_project_id"),
    productionDeploymentId: uuid("production_deployment_id"),
    productionUrl: text("production_url"),

    thumbnailUrl: text("thumbnail_url"),
    // The durable, current preview (iframe/demo) URL — written whenever a
    // build succeeds (see build-orchestrator.ts's advanceBuild). Before
    // this column existed, the workspace re-fetched this live from v0 on
    // every single page load with no fallback, so any transient hiccup (or
    // the call simply returning nothing for a moment) showed "No preview
    // yet" for a project that had a perfectly good preview — this is the
    // fix for that launch-critical bug.
    previewUrl: text("preview_url"),
    // v0's preview URLs carry a signed, time-limited token — the URL itself
    // can go stale (v0's demo host serves its own "loading" shell forever
    // instead of the real app) well before proBuild would otherwise refetch
    // it. This timestamp is when previewUrl was last confirmed fresh
    // against v0, so page loads can cheaply decide "still good" vs. "worth
    // a live re-check" instead of either trusting it forever or re-checking
    // on every single load (see PREVIEW_STALE_MS in projects/[id]/page.tsx).
    previewUrlCheckedAt: timestamp("preview_url_checked_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("projects_owner_id_idx").on(table.ownerId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    v0MessageId: text("v0_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("messages_project_id_idx").on(table.projectId)],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type").notNull(),
    originalFilename: text("original_filename").notNull(),
    kind: attachmentKindEnum("kind").notNull(),
    extractedText: text("extracted_text"),
    includedInBuilder: boolean("included_in_builder").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("attachments_project_id_idx").on(table.projectId)],
);

export const builds = pgTable(
  "builds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    triggerMessageId: uuid("trigger_message_id").references(() => messages.id),
    v0MessageId: text("v0_message_id"),
    state: buildStateEnum("state").notNull().default("queued"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    tokensUsed: integer("tokens_used"),
    creditsCost: integer("credits_cost"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("builds_project_id_idx").on(table.projectId),
    // Live-testing discovery: the app-level "is a build already running"
    // check and the build-row insert aren't atomic, so two near-simultaneous
    // requests (e.g. two open tabs) can both pass the check. This partial
    // unique index makes "one active build per project" a real DB
    // constraint instead of just an app-level race — the second insert
    // fails with a unique violation, which the orchestrator catches and
    // turns into the same friendly "already in progress" error.
    uniqueIndex("builds_one_active_per_project")
      .on(table.projectId)
      .where(sql`${table.state} in ('queued', 'streaming')`),
  ],
);

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    vercelDeploymentId: text("vercel_deployment_id").notNull(),
    target: deploymentTargetEnum("target").notNull(),
    readyState: deploymentReadyStateEnum("ready_state").notNull().default("queued"),
    url: text("url"),
    isCurrentProduction: boolean("is_current_production").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("deployments_project_id_idx").on(table.projectId)],
);

export const domains = pgTable(
  "domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    domainName: text("domain_name").notNull(),
    status: domainStatusEnum("status").notNull().default("pending_verification"),
    verificationJson: jsonb("verification_json"),
    dnsInstructions: text("dns_instructions"),
    sslStatus: text("ssl_status"),
    source: domainSourceEnum("source").notNull().default("connected"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("domains_domain_name_idx").on(table.domainName)],
);

export const projectIntegrations = pgTable(
  "project_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: integrationStatusEnum("status").notNull().default("not_configured"),
    requiredEnvVars: jsonb("required_env_vars").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("project_integrations_project_provider_idx").on(
      table.projectId,
      table.provider,
    ),
  ],
);

export const projectSecrets = pgTable("project_secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectIntegrationId: uuid("project_integration_id")
    .notNull()
    .references(() => projectIntegrations.id, { onDelete: "cascade" }),
  envKey: text("env_key").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  vercelEnvId: text("vercel_env_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Usage / credits
// ---------------------------------------------------------------------------

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    buildId: uuid("build_id").references(() => builds.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull().default("v0"),
    tokensInput: integer("tokens_input"),
    tokensOutput: integer("tokens_output"),
    creditsCost: integer("credits_cost").notNull(),
    eventType: usageEventTypeEnum("event_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("usage_events_user_id_idx").on(table.userId)],
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: ledgerReasonEnum("reason").notNull(),
    referenceId: text("reference_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("credit_ledger_user_id_idx").on(table.userId)],
);

// ---------------------------------------------------------------------------
// Plans / billing
// ---------------------------------------------------------------------------

export const plans = pgTable("plans", {
  id: text("id").primaryKey(), // e.g. "free" | "builder" | "pro"
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  monthlyCredits: integer("monthly_credits").notNull(),
  projectLimit: integer("project_limit").notNull(),
  rateLimits: jsonb("rate_limits").notNull().default({}),
  features: jsonb("features").notNull().default({}),
  active: boolean("active").notNull().default(true),
  // Null for the free plan — nothing to subscribe to on Paystack's side.
  // Set once per paid plan via a one-time admin setup step (see
  // src/db/seed-paystack-plans.md), not created dynamically at runtime.
  paystackPlanCode: text("paystack_plan_code"),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  paystackSubscriptionCode: text("paystack_subscription_code"),
  // Required by Paystack's disable-subscription call alongside the
  // subscription code — captured from the `subscription.create` webhook,
  // there is no other way to fetch it after the fact.
  paystackEmailToken: text("paystack_email_token"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    type: transactionTypeEnum("type").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    provider: text("provider").notNull().default("paystack"),
    providerReference: text("provider_reference").notNull(),
    status: transactionStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("transactions_provider_reference_idx").on(
      table.providerReference,
    ),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload").notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("notifications_user_id_idx").on(table.userId)],
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle's relational query API)
// ---------------------------------------------------------------------------

export const profilesRelations = relations(profiles, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(profiles, {
    fields: [projects.ownerId],
    references: [profiles.id],
  }),
  template: one(templates, {
    fields: [projects.templateId],
    references: [templates.id],
  }),
  messages: many(messages),
  attachments: many(attachments),
  builds: many(builds),
  deployments: many(deployments),
  integrations: many(projectIntegrations),
}));

export const templatesRelations = relations(templates, ({ many }) => ({
  projects: many(projects),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  project: one(projects, {
    fields: [messages.projectId],
    references: [projects.id],
  }),
  attachments: many(attachments),
}));

export const projectIntegrationsRelations = relations(
  projectIntegrations,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [projectIntegrations.projectId],
      references: [projects.id],
    }),
    secrets: many(projectSecrets),
  }),
);
