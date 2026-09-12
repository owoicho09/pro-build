import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  // puppeteer-core / @sparticuz/chromium (production) and puppeteer (local
  // dev fallback — see src/lib/services/screenshot.ts) load native
  // binaries and their own dynamic requires; bundling them through
  // webpack/Turbopack breaks that. Keeping them external means Next just
  // copies the packages as-is instead of trying to bundle them.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "puppeteer"],
};

export default nextConfig;
