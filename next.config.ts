import type { NextConfig } from "next";

// `npm run build:demo` sets NEXT_PUBLIC_DEMO=1 to produce the static GitHub
// Pages demo (see scripts/build-demo.mjs); otherwise this is the full app.
const demo = process.env.NEXT_PUBLIC_DEMO === "1";

const nextConfig: NextConfig = demo
  ? {
      output: "export",
      basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {};

export default nextConfig;
