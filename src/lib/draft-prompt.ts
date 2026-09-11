// Preserves an anonymous user's typed idea across the signup/login detour
// (spec: don't force auth -> dashboard -> new project -> retype prompt).
// localStorage, not sessionStorage: email confirmation links commonly open
// in a new tab (or a different app entirely), which sessionStorage would
// not survive — localStorage does, as long as it's the same browser.
export const DRAFT_PROMPT_KEY = "probuild:draft-prompt";

export function saveDraftPrompt(prompt: string) {
  try {
    window.localStorage.setItem(DRAFT_PROMPT_KEY, prompt);
  } catch {
    // Best-effort only — private browsing / storage-disabled shouldn't block submission.
  }
}

// Reads and clears in one step: the draft is meant to be consumed exactly
// once, on the create page the user lands on after authenticating.
export function consumeDraftPrompt(): string | null {
  try {
    const value = window.localStorage.getItem(DRAFT_PROMPT_KEY);
    if (value) window.localStorage.removeItem(DRAFT_PROMPT_KEY);
    return value;
  } catch {
    return null;
  }
}
