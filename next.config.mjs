import withSerwistInit from "@serwist/next";

/** @type {import("@serwist/next").SerwistOptions} */
const serwistOptions = {
  swSrc: "src/sw/sw.js",
  swDest: "public/sw.js",
  // The service worker is registered only in production builds.
  disable: process.env.NODE_ENV === "development",
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Double-renders components in development to surface unsafe effects;
  // production is unaffected.
  reactStrictMode: true,
  // Don't advertise the framework in every response's X-Powered-By header.
  poweredByHeader: false,
  // Security headers on every response. CSP keeps 'unsafe-inline' for
  // script TAGS because Next.js ships inline bootstrap/flight scripts and
  // src/app/layout.jsx uses an inline pre-paint theme script — a nonce would
  // force every page into dynamic rendering and drop the static PWA shells.
  // `script-src-attr 'none'` closes the more common sink (inline event
  // handlers and `javascript:` URLs) without that trade-off. 'self' +
  // supabase covers auth/storage fetches and the realtime websocket; the assistant
  // provider is called server-side only.
  async headers() {
    // In development, script-src must also allow 'unsafe-eval': Next.js dev
    // (React Refresh / webpack runtime) evaluates strings as JS, and without
    // it every page renders server HTML but fails to hydrate. Production
    // keeps the strict script-src.
    const isDev = process.env.NODE_ENV === "development";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              isDev
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
                : "script-src 'self' 'unsafe-inline'",
              // Inline event handlers / javascript: URLs: the most common
              // reflected-XSS payloads, blocked even though inline <script>
              // tags remain allowed above.
              "script-src-attr 'none'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co",
              "font-src 'self'",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "worker-src 'self' blob:",
              "manifest-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
        ],
      },
    ];
  },
  // /dashboard was merged into /today and /settings into /profile.
  // Server-level redirects give document requests a real 307;
  // the page files still carry redirect() for client-side RSC navigations.
  async redirects() {
    return [
      { source: "/dashboard", destination: "/today", permanent: false },
      { source: "/settings", destination: "/profile", permanent: false },
    ];
  },
};

export default withSerwistInit(serwistOptions)(nextConfig);
