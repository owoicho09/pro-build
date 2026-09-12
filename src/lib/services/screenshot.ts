import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "project-thumbnails";
const NAV_TIMEOUT_MS = 45_000;
const VIEWPORT = { width: 1280, height: 800 };

// Root cause of the recurring blank-thumbnail bug: `projects.thumbnail_url`
// was being set to v0's OWN `screenshotUrl` (see build-orchestrator.ts's
// old advanceBuild) — a signed, short-lived link from the same family as
// v0's previewUrl, which turned out not to be durable across time or
// reopens either. Project cards must never depend on v0 at render time at
// all; this module is the only thing that writes a real, owned copy of the
// image into our own Storage, decoupled entirely from v0's URL lifecycle.
//
// v0's preview is cross-origin, so there is no client-side way to capture
// it (canvas/html2canvas can't read cross-origin pixels) — this has to run
// server-side against a real browser.
async function launchBrowser() {
  // Vercel's production runtime is Linux; @sparticuz/chromium ships a
  // Chromium build compiled for that environment and is the standard,
  // well-supported way to run headless Chrome inside a Vercel serverless
  // function (see next.config.ts's serverExternalPackages comment). This
  // codebase's dev machines are Windows, where that Linux binary can't run
  // at all, so local dev falls back to the full `puppeteer` package, which
  // bundles a real, cross-platform Chromium — same Puppeteer API either
  // way, only the launch path differs.
  if (process.env.VERCEL) {
    const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ]);
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const { default: puppeteer } = await import("puppeteer");
  return puppeteer.launch({ headless: true });
}

// Captures a real, server-side screenshot of a live (already-resolved)
// preview URL and uploads it to our own Storage bucket, returning a stable
// public URL. Throws on any failure — callers must decide for themselves
// to keep the previous thumbnail rather than overwrite it with nothing;
// this function never silently returns a partial/placeholder result.
export async function captureAndStoreScreenshot(input: {
  previewUrl: string;
  projectId: string;
}): Promise<string> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    // "networkidle0" (no more than 0 in-flight requests for 500ms) is a
    // real readiness signal for "has this actually finished loading" —
    // exactly the "wait until the generated site is actually renderable"
    // step that was missing before, rather than a fixed guessed delay.
    await page.goto(input.previewUrl, {
      waitUntil: "networkidle0",
      timeout: NAV_TIMEOUT_MS,
    });

    const screenshot = await page.screenshot({ type: "jpeg", quality: 80 });

    const supabase = createAdminClient();
    // Content-addressed-ish path (timestamped, not random) so old
    // screenshots for the same project don't accumulate forever in
    // Storage — each new capture overwrites the last.
    const storagePath = `${input.projectId}/thumbnail.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, Buffer.from(screenshot), {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload screenshot: ${uploadError.message}`);
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    // Cache-bust: the path is stable (always overwritten in place), so
    // without a changing query param, browsers/CDNs would keep showing a
    // previous capture after an update.
    return `${data.publicUrl}?v=${Date.now()}`;
  } finally {
    await browser.close();
  }
}
