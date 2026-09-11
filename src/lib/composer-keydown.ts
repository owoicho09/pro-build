import type { KeyboardEvent } from "react";

// Enter sends, Shift+Enter inserts a newline — the composer pattern users
// already know from every chat app, instead of a bare <textarea>'s native
// "Enter always inserts a newline" with no way to submit from the
// keyboard at all. Ctrl/Cmd+Enter also sends: it isn't special-cased out,
// so it falls through the same "not Shift" branch as plain Enter.
// isComposing guards IME input (e.g. typing Japanese/Chinese via a
// composition-based method) — Enter there confirms the candidate, not
// the form.
export function handleComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
  if (e.shiftKey) return;

  e.preventDefault();
  if (!e.currentTarget.value.trim()) return;
  e.currentTarget.form?.requestSubmit();
}
