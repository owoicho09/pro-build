import { defineConfig } from "drizzle-kit";

// `db:generate` only diffs schema.ts against migration history and doesn't
// need a live connection, so DATABASE_URL is optional for that command. It
// is required (and validated separately) for `db:migrate`, which does.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder",
  },
  strict: true,
  verbose: true,
});
