import type { MetadataRoute } from "next";

// Lets Installous be added to a phone's home screen and open full-screen like
// an app. Paths include the base path so it also works for the demo under /Installous.
export const dynamic = "force-static";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Installous",
    short_name: "Installous",
    description: "Stock research with live prices, a five-factor score, an AI Fund and an AI analyst.",
    id: `${base}/`,
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    background_color: "#111110",
    theme_color: "#111110",
    categories: ["finance"],
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "AI Fund", url: `${base}/fund/` },
      { name: "Top Picks", url: `${base}/picks/` },
      { name: "Compare", url: `${base}/compare/` },
    ],
  };
}
