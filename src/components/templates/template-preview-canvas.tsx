"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { PreviewSizeToggle, type PreviewSize } from "@/components/workspace/preview-size-toggle";
import { cn } from "@/lib/utils";

const DEVICE_FRAME_CLASS: Record<"tablet" | "mobile", string> = {
  tablet: "w-[500px] max-w-full",
  mobile: "w-[280px] max-w-full",
};

// There's no live preview URL for a template (see schema.ts's templates
// comment — no "golden" reference build exists yet), so this frames the
// static screenshot the same way the workspace's device toggle frames a
// live iframe, for a consistent visual language rather than a plain image.
export function TemplatePreviewCanvas({
  thumbnailUrl,
  name,
}: {
  thumbnailUrl: string | null;
  name: string;
}) {
  const [size, setSize] = useState<PreviewSize>("desktop");
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = Boolean(thumbnailUrl) && !imgFailed;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <PreviewSizeToggle value={size} onChange={setSize} />
        {showImage && (
          <a
            href={thumbnailUrl!}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-border/40 hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open preview
          </a>
        )}
      </div>
      <div className="flex aspect-video items-center justify-center bg-border/20 p-4">
        <div
          className={cn(
            "flex h-full items-center justify-center overflow-hidden rounded-lg",
            size !== "desktop" && DEVICE_FRAME_CLASS[size],
            size !== "desktop" && "border border-border bg-background shadow-sm",
          )}
        >
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- external, unknown-domain preview image; not worth a next/image remotePatterns entry for an unverified host
            <img
              src={thumbnailUrl!}
              alt=""
              className="h-full w-full object-cover"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand/15 via-border/30 to-border/10">
              <span className="text-2xl font-semibold text-brand/70">{name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
