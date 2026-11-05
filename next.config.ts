import type { NextConfig } from "next";
import { API_CSP } from "./src/lib/csp";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  ...(process.env.NODE_ENV !== "production" && {
    experimental: {
      mcpServer: true,
    },
  }),
  headers: async () => [
    {
      source: "/(.*)",
      headers: securityHeaders,
    },
    // La de las páginas lleva nonce: sale de middleware.ts.
    {
      source: "/api/:path*",
      headers: [{ key: "Content-Security-Policy", value: API_CSP }],
    },
  ],
  // Serve the app icon for legacy /favicon.ico probes (avoids a 404).
  rewrites: async () => [{ source: "/favicon.ico", destination: "/icon.svg" }],
};

export default nextConfig;
