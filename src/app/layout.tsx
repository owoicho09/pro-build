import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const TITLE = "proBuild — Build software with AI";
const DESCRIPTION =
  "Describe what you want to build. proBuild turns your idea into working software you can preview, edit, publish and manage with AI.";

// icon.png / apple-icon.png / opengraph-image.png in this directory are
// Next.js's file-based metadata convention — favicon, apple touch icon, and
// social preview image are wired up automatically from those files alone,
// resolved to absolute URLs via metadataBase below (confirmed: the built
// /opengraph-image.png route is a real, publicly reachable static asset,
// not a placeholder). No separate twitter-image file is needed either:
// Next.js auto-fills twitter.images from openGraph.images whenever
// `twitter` doesn't explicitly set its own `images` — confirmed in
// next's own resolve-metadata source, not assumed.
export const metadata: Metadata = {
  // Reuses the same app-URL env var already relied on for auth redirects
  // (see signup/actions.ts, lib/actions/auth.ts) rather than hardcoding a
  // domain — resolves relative OG/twitter image URLs, and the canonical
  // link below, to absolute ones.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "proBuild",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
