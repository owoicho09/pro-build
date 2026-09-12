"use server";

import { randomInt, createHash } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetOtps } from "@/db/schema";
import { sendEmail } from "@/lib/services/email";
import { passwordResetOtpEmail } from "@/lib/services/email-templates";

const schema = z.object({ email: z.string().email() });

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_HOUR = 3;

// Identical regardless of whether the email exists, is rate-limited, or a
// code was genuinely sent — never give an attacker a way to enumerate
// which emails have accounts, or to distinguish "rate limited" from "sent".
const GENERIC_MESSAGE = "If an account exists for that email, we've sent a 4-digit code to it.";

export async function requestPasswordReset(_prevState: unknown, formData: FormData) {
  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: "Enter a valid email address." };
  }
  const email = parsed.data.email.toLowerCase();

  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const countResult = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from password_reset_otps where email = ${email} and created_at >= ${windowStart}`,
  );
  const recentCount = countResult.rows[0]?.count ?? 0;

  if (recentCount < MAX_REQUESTS_PER_HOUR) {
    const userResult = await db.execute<{ id: string }>(
      sql`select id from auth.users where lower(email) = ${email} limit 1`,
    );
    const userId = userResult.rows[0]?.id;

    // Only issue a code for an email that's actually registered — but this
    // branch is the ONLY difference in behavior, and it's invisible to the
    // caller either way (same return value below).
    if (userId) {
      const code = randomInt(1000, 10000).toString();
      const codeHash = createHash("sha256").update(code).digest("hex");
      await db.insert(passwordResetOtps).values({
        email,
        codeHash,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      });

      const template = passwordResetOtpEmail({ code });
      await sendEmail({
        to: email,
        subject: "Your proBuild password reset code",
        ...template,
      }).catch((err) => console.error("Failed to send password reset email", err));
    }
  }

  return { success: true as const, message: GENERIC_MESSAGE, email };
}
