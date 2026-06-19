import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/income", destination: "/entry?tab=income", permanent: false },
      { source: "/expense", destination: "/entry?tab=expense", permanent: false },
      {
        source: "/booth/:id/income",
        destination: "/booth/:id/entry?tab=income",
        permanent: false,
      },
      {
        source: "/booth/:id/expense",
        destination: "/booth/:id/entry?tab=expense",
        permanent: false,
      },
      {
        source: "/projects/:id/income",
        destination: "/projects/:id/entry?tab=income",
        permanent: false,
      },
      {
        source: "/projects/:id/expense",
        destination: "/projects/:id/entry?tab=expense",
        permanent: false,
      },
    ];
  },
  async headers() {
    // HSTS and hardening headers only in production (not local dev).
    // Vercel serves HTTPS only; skip HSTS on local dev / `next start` over HTTP.
    if (process.env.VERCEL !== "1") {
      return [];
    }
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
