"use client";

import { useId, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv";

// A hidden native file input driven by a styled button, so the surrounding
// form stays a plain server-action `<form>` post (multipart, no client-side
// upload wiring needed) while still giving visible feedback on what's
// selected. Files aren't validated here beyond the `accept` hint — the
// server is the real gate, since `accept` is only a UI nicety.
export function AttachmentPicker({ disabled }: { disabled?: boolean }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);

  function removeAt(index: number) {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    if (inputRef.current) {
      const transfer = new DataTransfer();
      next.forEach((file) => transfer.items.add(file));
      inputRef.current.files = transfer.files;
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name="attachments"
        multiple
        accept={ACCEPT}
        disabled={disabled}
        className="hidden"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
      />
      <label
        htmlFor={inputId}
        className={
          "flex w-fit cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" +
          (disabled ? " pointer-events-none opacity-50" : "")
        }
      >
        <Paperclip className="size-4" />
        Attach files
      </label>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-1 rounded-full bg-border/60 px-2 py-0.5 text-xs"
            >
              {file.name}
              <button
                type="button"
                onClick={() => removeAt(index)}
                aria-label={`Remove ${file.name}`}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
