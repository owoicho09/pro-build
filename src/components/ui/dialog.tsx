"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Minimal, reusable accessible dialog — backdrop click, Escape, and initial
// focus all handled once here instead of per-modal (Publish, Integrations,
// Domains all use this).
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 motion-safe:animate-[dialog-backdrop-in_150ms_ease-out]"
        onClick={onClose}
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl outline-none motion-safe:animate-[dialog-panel-in_150ms_ease-out]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
