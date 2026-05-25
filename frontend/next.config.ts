import type { NextConfig } from "next";

const API_URL = process.env.API_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  experimental: {
    middlewareClientMaxBodySize: "50mb",
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "4000",
        pathname: "/api/**",
      },
      {
        protocol: "https",
        hostname: "a.basemaps.cartocdn.com",
      },
      {
        protocol: "https",
        hostname: "b.basemaps.cartocdn.com",
      },
      {
        protocol: "https",
        hostname: "c.basemaps.cartocdn.com",
      },
      {
        protocol: "https",
        hostname: "d.basemaps.cartocdn.com",
      },
    ],
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
