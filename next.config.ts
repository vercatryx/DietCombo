import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    serverActions: {
      // Aggregate vendor + large order payloads exceed 4MB; keep bounded but usable (default is 1MB).
      bodySizeLimit: '32mb',
    },
  },
  /**
   * Proof-of-delivery stamps read `lib/fonts/*.woff2` at runtime (Sharp SVG). Without this,
   * Vercel's serverless trace can omit that folder so @font-face is empty and glyphs show as boxes.
   */
  outputFileTracingIncludes: {
    "/**": ["./lib/fonts/**/*"],
  },
};

export default nextConfig;
