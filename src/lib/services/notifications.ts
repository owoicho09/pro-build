import "server-only";
import { sql } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import type { Database, NotificationType } from "@/db/types";
import { sendEmail } from "./email";

type Payload = Record<string, unknown>;

// Spec §25 lists these five as the minimum notification set. "integration
// requires attention" is folded into the post-build notification rather
// than fired separately when the integration is first detected — nothing
// exists to look at yet at detection time, so notifying then would just be
// noise ahead of a build that hasn't run.
function describe(
  type: NotificationType,
  projectName: string,
  payload: Payload,
): { subject: string; text: string } {
  switch (type) {
    case "build_completed":
      return {
        subject: `"${projectName}" finished building`,
        text: `Your changes to "${projectName}" are ready to preview.`,
      };
    case "build_failed":
      return {
        subject: `"${projectName}" build failed`,
        text: `The last build for "${projectName}" failed. Its previous working version, if any, is unaffected — open the project to see what happened and try again.`,
      };
    case "deployment_completed":
      return {
        subject: `"${projectName}" is live`,
        text: `"${projectName}" was published${payload.url ? ` at ${payload.url}` : ""}.`,
      };
    case "deployment_failed":
      return {
        subject: `Publishing "${projectName}" failed`,
        text: `We couldn't publish "${projectName}". Its existing live version, if any, is unaffected.`,
      };
    case "integration_attention":
      return {
        subject: `"${projectName}" needs a quick setup step`,
        text: `"${projectName}" is ready to preview, but ${payload.provider ?? "a feature"} needs to be connected to fully work. Open the project to finish setting it up.`,
      };
  }
}

// Writes the in-app row via the trusted direct-Postgres connection (see
// src/db/index.ts) so this works both from request-scoped server actions
// and from the cron/build-advance path, which has no signed-in Supabase
// session to act through. Deliberately called AFTER the state-changing
// transaction it reports on (not inside it) — a missed notification isn't
// a correctness bug the way a missed credit debit would be, so it doesn't
// need the same atomicity guarantee.
export async function notifyUser(input: {
  userId: string;
  projectId: string;
  projectName: string;
  type: NotificationType;
  payload?: Payload;
}): Promise<void> {
  const payload = input.payload ?? {};
  await db.insert(notifications).values({
    userId: input.userId,
    type: input.type,
    projectId: input.projectId,
    payload,
  });

  try {
    const result = await db.execute<{ email: string }>(
      sql`select email from auth.users where id = ${input.userId}`,
    );
    const email = result.rows[0]?.email;
    if (email) {
      const { subject, text } = describe(input.type, input.projectName, payload);
      await sendEmail({ to: email, subject, text });
    }
  } catch (err) {
    console.error("Failed to send notification email", input.userId, input.type, err);
  }
}

export async function getRecentNotifications(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Database["public"]["Tables"]["notifications"]["Row"][]> {
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  return data ?? [];
}
