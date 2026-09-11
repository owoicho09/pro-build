import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import type { Database } from "@/db/types";

type Template = Database["public"]["Tables"]["templates"]["Row"];

// Spec: "template cards should be a strong visual feature... do not use
// blank gray cards... if image unavailable, use an intentional skeleton/
// fallback, never broken-image UI." The fallback below is a deliberate
// gradient + name mark, not a plain gray box.
export function TemplateCard({ template }: { template: Template }) {
  return (
    <Link href={`/templates/${template.slug}`} className="group block">
      <Card className="flex h-full flex-col overflow-hidden transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-brand/40 group-hover:shadow-md">
        <div className="relative aspect-video overflow-hidden">
          <ImageWithFallback
            key={template.thumbnail_url}
            src={template.thumbnail_url}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            fallback={
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand/15 via-border/30 to-border/10">
                <span className="text-xl font-semibold text-brand/70">{template.name}</span>
              </div>
            }
          />
          {template.is_premium && (
            <span className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-xs font-medium text-brand shadow-sm backdrop-blur-sm">
              <Sparkles className="size-3" />
              Premium
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-medium">{template.name}</h3>
              <p className="text-xs font-medium uppercase tracking-wide text-brand/80">{template.category}</p>
            </div>
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors group-hover:border-brand/40 group-hover:text-brand">
              <ArrowUpRight className="size-3.5" />
            </span>
          </div>
          {template.tagline && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{template.tagline}</p>
          )}
        </div>
      </Card>
    </Link>
  );
}
