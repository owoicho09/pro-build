// Intentional loading state for the first build of a project (spec: never
// leave a dead blank panel). Purely decorative — no real progress data is
// available yet, so this stays a generic page-shape pulse rather than
// inventing fake percentages or steps.
export function PreviewSkeleton() {
  return (
    <div
      role="status"
      aria-label="Building your site"
      className="flex h-full flex-col items-center justify-center gap-6 p-8"
    >
      <div className="w-full max-w-md space-y-3 motion-safe:animate-pulse">
        <div className="h-3 w-1/3 rounded-full bg-border/60" />
        <div className="h-24 w-full rounded-lg bg-border/50" />
        <div className="h-3 w-full rounded-full bg-border/40" />
        <div className="h-3 w-5/6 rounded-full bg-border/40" />
        <div className="h-3 w-2/3 rounded-full bg-border/40" />
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Building your site
        <br />
        Your preview will appear here as soon as it&apos;s ready.
      </p>
    </div>
  );
}
