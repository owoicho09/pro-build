"use client";

import { Monitor, Tablet, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

export type PreviewSize = "desktop" | "tablet" | "mobile";

const OPTIONS: { value: PreviewSize; label: string; icon: typeof Monitor }[] = [
  { value: "desktop", label: "Desktop", icon: Monitor },
  { value: "tablet", label: "Tablet", icon: Tablet },
  { value: "mobile", label: "Mobile", icon: Smartphone },
];

export function PreviewSizeToggle({
  value,
  onChange,
}: {
  value: PreviewSize;
  onChange: (size: PreviewSize) => void;
}) {
  return (
    <div role="group" aria-label="Preview size" className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.label}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md",
            value === option.value
              ? "bg-border/60 text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <option.icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
