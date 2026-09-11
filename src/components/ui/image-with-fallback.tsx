"use client";

import { useState, type ReactNode } from "react";

// A stored thumbnail/screenshot URL being non-null doesn't mean it still
// loads (v0-hosted screenshots can 404/expire, network can fail) — without
// this, a broken URL rendered a bare browser broken-image icon instead of
// the intended fallback. `key`d by src at the call site so a later
// successful URL (e.g. after a rebuild) gets a fresh attempt instead of
// being stuck on a previous failure.
export function ImageWithFallback({
  src,
  alt,
  className,
  fallback,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <>{fallback}</>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external, unknown-domain preview image; not worth a next/image remotePatterns entry for an unverified host
    <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />
  );
}
