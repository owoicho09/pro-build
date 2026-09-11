import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// icon.png / apple-icon.png / opengraph-image.png in this directory are
// Next.js's file-based metadata convention — favicon, apple touch icon, and
// social preview image are wired up automatically from those files alone,
// no manual `icons`/`openGraph.images` entries needed here.
export const metadata: Metadata = {
  // Reuses the same app-URL env var already relied on for auth redirects
  // (see signup/actions.ts, lib/actions/auth.ts) rather than hardcoding a
  // domain — resolves relative OG/twitter image URLs to absolute ones.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: "proBuild",
  description: "Describe your idea. Watch it become a real, live application.",
  openGraph: {
    title: "proBuild",
    description: "Describe your idea. Watch it become a real, live application.",
    siteName: "proBuild",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "proBuild",
    description: "Describe your idea. Watch it become a real, live application.",
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
