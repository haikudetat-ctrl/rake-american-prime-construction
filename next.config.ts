import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Scale-ticket photos are shrunk on the phone before upload (to well
      // under 1 MB); this is headroom for a phone where that step fails.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
