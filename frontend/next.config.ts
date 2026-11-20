import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  outputFileTracingIncludes: {
    "/api/cron/**": ["./data/career_pages.txt"],
  },
};

export default nextConfig;