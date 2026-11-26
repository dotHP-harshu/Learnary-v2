import { defaultCache } from "@serwist/next/worker";
import { NetworkOnly, Serwist } from "serwist";

// Never cache authenticated data. The default policy stores cross-origin
// responses (including Supabase REST/auth calls) and same-origin `/api/*` GETs
// in Cache Storage keyed by URL only — not by user. On a shared device that
// would let one account be served another account's cached rows. These rules
// run first, so they win over the broader default matchers.
const noStoreRules = [
  {
    matcher: ({ url }) =>
      url.hostname.endsWith(".supabase.co") ||
      // Custom-domain / self-hosted Supabase: the API surfaces are fixed.
      url.pathname.startsWith("/rest/v1") ||
      url.pathname.startsWith("/auth/v1") ||
      url.pathname.startsWith("/storage/v1") ||
      url.pathname.startsWith("/realtime/v1"),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ url, sameOrigin }) =>
      sameOrigin && url.pathname.startsWith("/api/"),
    handler: new NetworkOnly(),
  },
];

// Serwist replaces `self.__SW_MANIFEST` with the precache manifest at build time.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Matches vite-plugin-pwa `registerType: "autoUpdate"`.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [...noStoreRules, ...defaultCache],
  fallbacks: {
    denylist: [/^\/api/, /^\/_next\/static\/webpack/],
  },
});

serwist.addEventListeners();
