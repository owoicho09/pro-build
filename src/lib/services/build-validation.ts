import "server-only";
import { launchBrowser } from "@/lib/services/screenshot";

const NAV_TIMEOUT_MS = 45_000;
const SETTLE_MS = 1500;

// A real Tailwind v4 + shadcn build (this platform's standard generated
// scaffold — see globals.css's `@theme inline` block) produces hundreds of
// CSS rules just from theme custom properties and the base layer, before a
// single generated component class is counted. A near-empty stylesheet is a
// strong, generic "nothing actually compiled" signal that doesn't depend on
// knowing any project-specific class names — unlike checking for a specific
// selector, which would only catch failures on that one selector.
const MIN_EXPECTED_CSS_RULES = 30;

export interface StyleValidationResult {
  passed: boolean;
  /** Safe, human-readable summary — safe to put in a user-facing error_message. */
  reason?: string;
  /** Raw captured detail (console error text, failed URL, etc.) — feeds the repair prompt and the admin-only validationError column, never shown to the end user directly. */
  diagnosticDetail?: string;
}

// Opens the ACTUAL rendered preview in a real headless browser and checks
// whether the page's styling system genuinely loaded — this is the gate
// that a compiled-but-unstyled build must pass before being marked
// "succeeded" (see build-orchestrator.ts's advanceBuild). Modeled directly
// on a real, confirmed-live failure: v0's own preview-time Tailwind engine
// threw `Cannot apply unknown utility class` for a project whose source CSS
// was correctly formed — i.e. this class of failure only shows up once the
// page is actually rendered, never from inspecting source files alone.
export async function validateRenderedStyling(previewUrl: string): Promise<StyleValidationResult> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();

    let firstFailure: StyleValidationResult | null = null;
    const noteFailure = (result: StyleValidationResult) => {
      if (!firstFailure) firstFailure = result;
    };

    page.on("pageerror", (err) => {
      noteFailure({
        passed: false,
        reason: "The generated page threw a runtime error while loading.",
        diagnosticDetail: String(err),
      });
    });

    page.on("requestfailed", (req) => {
      const url = req.url();
      noteFailure({
        passed: false,
        reason: "A resource this page needs (script, stylesheet, or font) failed to load.",
        diagnosticDetail: `Failed to load ${url}: ${req.failure()?.errorText ?? "unknown error"}`,
      });
    });

    page.on("response", (res) => {
      const url = res.url();
      const contentType = res.headers()["content-type"] ?? "";
      const looksLikeStylesheet = url.includes(".css") || contentType.includes("css");
      if (looksLikeStylesheet && !res.ok()) {
        noteFailure({
          passed: false,
          reason: "A stylesheet this page needs didn't load successfully.",
          diagnosticDetail: `Stylesheet request to ${url} returned HTTP ${res.status()}.`,
        });
      }
    });

    try {
      await page.goto(previewUrl, { waitUntil: "networkidle0", timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      return {
        passed: false,
        reason: "The preview didn't finish loading in time.",
        diagnosticDetail: String(err),
      };
    }

    // Give any late console/pageerror events (common right after a
    // client-side Tailwind engine finishes parsing) a moment to surface
    // before deciding this passed.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    if (firstFailure) {
      return firstFailure;
    }

    const ruleCount = await page.evaluate(() => {
      let total = 0;
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          total += sheet.cssRules.length;
        } catch {
          // Cross-origin stylesheets throw reading cssRules — none expected
          // here since the preview serves its own CSS same-origin, but
          // never let that crash validation itself.
        }
      }
      return total;
    });

    if (ruleCount < MIN_EXPECTED_CSS_RULES) {
      return {
        passed: false,
        reason: "The page loaded, but almost no CSS actually applied — the styling system likely didn't compile.",
        diagnosticDetail: `Only ${ruleCount} CSS rules were found across all loaded stylesheets (expected at least ${MIN_EXPECTED_CSS_RULES} for a normally-styled page).`,
      };
    }

    return { passed: true };
  } finally {
    await browser.close();
  }
}
