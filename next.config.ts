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
};

export default nextConfig;
