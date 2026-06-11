import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const API_URL = process.env.API_URL || "http://localhost:4000";
const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CONFIG_DIR, "..");

const analyze = process.env.ANALYZE === "true";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: REPO_ROOT,
  turbopack: {
    root: REPO_ROOT,
  },

  allowedDevOrigins: ['100.84.70.113', '*.tailscale.com', '*.tailscale.net'],
  experimental: {
    proxyClientMaxBodySize: "50mb",
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${API_URL}/health`,
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
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
};

export default analyze ? withBundleAnalyzer()(nextConfig) : nextConfig;
