"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetOtps } from "@/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{4}$/, "Enter the 4-digit code."),
  newPassword: z.string().min(8, "Use at least 8 characters"),
});

// Caps guesses against a single issued code — combined with its 10-minute
// expiry (see forgot-password/actions.ts) and the 3-requests/hour cap on
// issuing new ones, this bounds how many codes an attacker can ever try
// against one email in a given window.
const MAX_OTP_ATTEMPTS = 5;

const GENERIC_INVALID = "That code is invalid or expired. Request a new one.";

export async function confirmPasswordReset(_prevState: unknown, formData: FormData) {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    code: formData.get("code"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details and try again." };
  }
  const email = parsed.data.email.toLowerCase();

  const otpRow = await db.query.passwordResetOtps.findFirst({
    where: (fields, { and, isNull }) => and(eq(fields.email, email), isNull(fields.consumedAt)),
    orderBy: (fields, { desc }) => desc(fields.createdAt),
  });

  if (!otpRow || otpRow.expiresAt.getTime() < Date.now() || otpRow.attempts >= MAX_OTP_ATTEMPTS) {
    return { error: GENERIC_INVALID };
  }

  const submittedHash = createHash("sha256").update(parsed.data.code).digest("hex");
  if (submittedHash !== otpRow.codeHash) {
    await db
      .update(passwordResetOtps)
      .set({ attempts: otpRow.attempts + 1 })
      .where(eq(passwordResetOtps.id, otpRow.id));
    return { error: GENERIC_INVALID };
  }

  // Mark consumed (single-use) before touching the actual password — if
  // the update below fails, the user just requests a fresh code rather
  // than being able to replay this one indefinitely.
  await db
    .update(passwordResetOtps)
    .set({ consumedAt: new Date() })
    .where(eq(passwordResetOtps.id, otpRow.id));

  const userResult = await db.execute<{ id: string }>(
    sql`select id from auth.users where lower(email) = ${email} limit 1`,
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) {
    // Shouldn't happen — a code was only ever issued for a real account
    // (see forgot-password/actions.ts) — but never leak account existence.
    return { error: GENERIC_INVALID };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: parsed.data.newPassword,
  });
  if (error) {
    console.error("Failed to update password via admin API", userId, error);
    return { error: "Couldn't reset your password right now. Please try again." };
  }

  return { success: true as const };
}
