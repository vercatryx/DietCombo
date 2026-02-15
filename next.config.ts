import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb', // Vendor page can return many orders with items; default 1MB was truncating
    },
  },
};

export default nextConfig;
