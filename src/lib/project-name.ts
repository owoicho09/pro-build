const LEADING_ARTICLE = /^(a|an|the)\s+/i;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const MAX_WORDS = 6;
const MAX_CHARS = 48;

// Initial project names come from a free-form build prompt, not a title the
// user actually typed — the prompt itself stays intact as the first message
// in the conversation. This only picks a short label to display, so it
// trims to the first sentence/line, drops a leading article, and caps
// length; it is NOT meant to produce a perfect name (users can rename via
// the workspace header — see project-name-editor.tsx).
export function deriveProjectName(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0] ?? "";
  const firstSentence = firstLine.split(/(?<=[.!?])\s/, 1)[0] ?? firstLine;
  const stripped = firstSentence.replace(LEADING_ARTICLE, "").trim();
  if (!stripped) return "Untitled project";

  let name = stripped.split(/\s+/).slice(0, MAX_WORDS).join(" ");
  if (name.length > MAX_CHARS) {
    name = name.slice(0, MAX_CHARS).trim();
  }
  name = name.replace(TRAILING_PUNCTUATION, "").trim();
  if (!name) return "Untitled project";

  return name.charAt(0).toUpperCase() + name.slice(1);
}
