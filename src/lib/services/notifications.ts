import "server-only";
import { sql, eq, and, isNull } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/db";
import { notifications, profiles } from "@/db/schema";
import type { Database, NotificationType } from "@/db/types";
import { sendEmail } from "./email";
import { welcomeEmail, buildCompletedEmail, newSignupAdminAlertEmail } from "./email-templates";
import { getAdminEmails } from "@/lib/config/admin";

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
): { subject: string; text: string; html?: string } {
  switch (type) {
    case "build_completed": {
      const previewUrl = typeof payload.previewUrl === "string" ? payload.previewUrl : undefined;
      return {
        subject: `"${projectName}" finished building`,
        ...buildCompletedEmail({ projectName, previewUrl }),
      };
    }
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
      const { subject, text, html } = describe(input.type, input.projectName, payload);
      await sendEmail({ to: email, subject, text, html });
    }
  } catch (err) {
    console.error("Failed to send notification email", input.userId, input.type, err);
  }
}

// Sends the branded welcome email (to the new user) and a new-signup alert
// (to every address in ADMIN_EMAILS) exactly once per account, regardless
// of which signup path actually completes first. Called from BOTH
// signup/actions.ts (immediate-session email/password signup) and
// auth/callback/route.ts (Google OAuth, and email-confirmation-pending
// signup once they click through) — the atomic claim below is what makes
// calling it from two places safe rather than a double-send.
export async function sendWelcomeIfNeeded(input: {
  userId: string;
  email: string;
  fullName: string | null;
}): Promise<void> {
  const claimed = await db
    .update(profiles)
    .set({ welcomedAt: new Date() })
    .where(and(eq(profiles.id, input.userId), isNull(profiles.welcomedAt)))
    .returning({ id: profiles.id });

  if (claimed.length === 0) {
    return; // already welcomed — the other signup path got there first.
  }

  const welcome = welcomeEmail({ name: input.fullName });
  await sendEmail({ to: input.email, subject: "Welcome to proBuild", ...welcome }).catch((err) =>
    console.error("Failed to send welcome email", input.userId, err),
  );

  const adminEmails = getAdminEmails();
  if (adminEmails.length > 0) {
    const alert = newSignupAdminAlertEmail({
      email: input.email,
      fullName: input.fullName,
      signedUpAt: new Date().toISOString(),
    });
    await sendEmail({
      to: adminEmails,
      subject: `New signup: ${input.email}`,
      ...alert,
    }).catch((err) => console.error("Failed to send new-signup admin alert", input.userId, err));
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
