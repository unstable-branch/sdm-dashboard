import type { NextConfig } from "next";

const API_URL = process.env.API_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  experimental: {
    middlewareClientMaxBodySize: "50mb",
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
