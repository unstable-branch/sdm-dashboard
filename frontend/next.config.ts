import type { NextConfig } from "next";

const API_URL = process.env.API_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  modularizeImports: {
    "lucide-react": {
      transform: "lucide-react/dist/esm/icons/{{kebabCase member}}",
    },
  },
  experimental: {
    proxyClientMaxBodySize: "100mb",
    optimizePackageImports: ["lucide-react", "@tanstack/react-table", "recharts"],
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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
