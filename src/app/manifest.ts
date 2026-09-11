import type { MetadataRoute } from "next";

// Next.js file-convention manifest — auto-served at /manifest.webmanifest
// with the <link rel="manifest"> tag wired into <head> automatically, no
// manual layout.tsx changes needed. Reuses the same icon.png/apple-icon.png
// assets already generated for favicon/apple-touch-icon (see layout.tsx's
// comment) rather than exporting new image sizes.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "proBuild",
    short_name: "proBuild",
    description: "Describe your idea. Watch it become a real, live application.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
