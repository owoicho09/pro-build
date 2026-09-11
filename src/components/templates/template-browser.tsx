"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TemplateCard } from "@/components/templates/template-card";
import { cn } from "@/lib/utils";
import type { Database } from "@/db/types";

type Template = Database["public"]["Tables"]["templates"]["Row"];

export function TemplateBrowser({ templates }: { templates: Template[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  const categories = useMemo(() => {
    const unique = Array.from(new Set(templates.map((t) => t.category)));
    return ["All", ...unique];
  }, [templates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesCategory = category === "All" || template.category === category;
      const matchesQuery =
        !q ||
        template.name.toLowerCase().includes(q) ||
        (template.tagline ?? "").toLowerCase().includes(q) ||
        (template.description ?? "").toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [templates, query, category]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates..."
            className="pl-9"
            aria-label="Search templates"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                category === c
                  ? "bg-brand text-brand-foreground"
                  : "bg-border/40 text-muted-foreground hover:bg-brand/10 hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-20 text-center">
          <p className="text-sm font-medium">No templates match this search.</p>
          <p className="text-sm text-muted-foreground">
            <Link href="/projects/new" className="text-brand hover:underline">
              Start from scratch instead.
            </Link>
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      )}
    </div>
  );
}
