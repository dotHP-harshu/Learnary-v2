// Runtime-cache hygiene for the service worker's Cache Storage.
//
// The Serwist default policy keeps page/RSC/API responses in Cache Storage so
// the PWA works offline. Those caches are keyed by URL, not by user, so they
// must be cleared whenever the signed-in account changes — otherwise a shared
// device could be served the previous account's cached page or API payload.
//
// Only data caches are deleted. Precache and static asset caches stay, so the
// offline shell keeps working.

const DATA_CACHES = new Set([
  "pages",
  "pages-rsc",
  "pages-rsc-prefetch",
  "apis",
  "cross-origin",
  "others",
  "next-data",
  "static-data-assets",
]);

/**
 * Delete the service worker's per-user data caches. Best-effort: a browser
 * without Cache Storage (or a privacy mode that blocks it) must never break
 * sign-out or auth bootstrap.
 */
export async function clearDataCaches() {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => DATA_CACHES.has(key)).map((key) => caches.delete(key))
    );
  } catch {
    /* cache storage unavailable — nothing to clear */
  }
}
