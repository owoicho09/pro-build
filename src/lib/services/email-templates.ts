// Shared branded HTML layout for every transactional email proBuild sends
// (see email.ts's sendEmail). Colors are the literal hex values from
// src/app/globals.css's @theme block (brand #4f46e5, foreground #18181b,
// border #e4e4e7, muted #71717a) — inlined because email clients don't
// support CSS custom properties, so this can't just reference the app's
// own stylesheet.
const BRAND = "#4f46e5";
const TEXT = "#18181b";
const MUTED = "#71717a";
const BORDER = "#e4e4e7";

function appUrl(path = ""): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${path}`;
}

// Escapes user-controlled text (names, project names) dropped into HTML —
// none of this content should ever be trusted as markup.
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLayout(input: { previewText: string; bodyHtml: string }): string {
  return `<!doctype html>
<html>
  <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width" /></head>
  <body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <span style="display:none;font-size:1px;color:#fafafa;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(input.previewText)}</span>
    <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style="background:#fafafa;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellPadding="0" cellSpacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 0;">
                <img src="${appUrl("/logo.png")}" alt="proBuild" height="28" style="height:28px;display:block;" />
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px;color:${TEXT};font-size:15px;line-height:1.6;">
                ${input.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">
                proBuild — build software without writing code.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(label: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:20px;padding:12px 20px;background:${BRAND};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">${esc(label)}</a>`;
}

export function welcomeEmail(input: { name: string | null }): { html: string; text: string } {
  const greeting = input.name ? `Hi ${esc(input.name)},` : "Hi there,";
  const html = renderLayout({
    previewText: "Welcome to proBuild — let's build something.",
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:18px;font-weight:600;">Welcome to proBuild</p>
      <p style="margin:0 0 4px;">${greeting}</p>
      <p style="margin:0;">Describe what you want to build in plain language, and proBuild takes it from idea to a live, working website — no code required.</p>
      ${button("Start building", appUrl("/projects/new"))}
    `,
  });
  return {
    html,
    text: `${greeting}\n\nWelcome to proBuild. Describe what you want to build in plain language, and we'll take it from idea to a live website — no code required.\n\nStart building: ${appUrl("/projects/new")}`,
  };
}

export function buildCompletedEmail(input: {
  projectName: string;
  previewUrl?: string;
}): { html: string; text: string } {
  const name = esc(input.projectName);
  const html = renderLayout({
    previewText: `"${input.projectName}" finished building`,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:18px;font-weight:600;">Your changes are ready</p>
      <p style="margin:0;">"${name}" finished building and is ready to preview.</p>
      ${input.previewUrl ? button("Open preview", input.previewUrl) : ""}
    `,
  });
  return {
    html,
    text: `"${input.projectName}" finished building and is ready to preview.${input.previewUrl ? `\n\n${input.previewUrl}` : ""}`,
  };
}

export function passwordResetOtpEmail(input: { code: string }): { html: string; text: string } {
  const html = renderLayout({
    previewText: `Your proBuild password reset code: ${input.code}`,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:18px;font-weight:600;">Reset your password</p>
      <p style="margin:0 0 20px;">Use this code to finish resetting your password. It expires in 10 minutes.</p>
      <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:8px;color:${BRAND};">${esc(input.code)}</p>
      <p style="margin:20px 0 0;color:${MUTED};font-size:13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
    `,
  });
  return {
    html,
    text: `Your proBuild password reset code is ${input.code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
  };
}

export function newSignupAdminAlertEmail(input: {
  email: string;
  fullName: string | null;
  signedUpAt: string;
}): { html: string; text: string } {
  const html = renderLayout({
    previewText: `New signup: ${input.email}`,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:18px;font-weight:600;">New user signed up</p>
      <table role="presentation" cellPadding="0" cellSpacing="0" style="font-size:14px;">
        <tr><td style="padding:4px 12px 4px 0;color:${MUTED};">Email</td><td>${esc(input.email)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:${MUTED};">Name</td><td>${esc(input.fullName ?? "—")}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:${MUTED};">Signed up</td><td>${esc(input.signedUpAt)}</td></tr>
      </table>
    `,
  });
  return {
    html,
    text: `New signup — email: ${input.email}, name: ${input.fullName ?? "—"}, signed up: ${input.signedUpAt}`,
  };
}
