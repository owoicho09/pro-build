import "server-only";
import { withTimeout } from "@/lib/utils/timeout";

const RESEND_API_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 15_000;

// Confirmed against Resend's API reference: POST /emails, bearer auth,
// {from, to, subject, text}. Best-effort only, per spec ("do not block the
// entire V1 on an elaborate notification system") — the in-app notification
// row (see notifications.ts) is the guaranteed delivery path; this is a
// bonus if RESEND_API_KEY happens to be configured.
export async function sendEmail(input: {
  to: string | string[];
  subject: string;
  text: string;
  /** Optional branded HTML body — see email-templates.ts. Sent alongside `text` (Resend accepts both in one call); plain-text-only callers are unaffected. */
  html?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const from = process.env.RESEND_FROM_EMAIL || "proBuild <onboarding@resend.dev>";

  try {
    const response = await withTimeout(
      fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        }),
      }),
      REQUEST_TIMEOUT_MS,
      "Timed out sending notification email.",
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("Resend email send failed", response.status, body.slice(0, 300));
    }
  } catch (err) {
    console.error("Resend email send errored", err);
  }
}
