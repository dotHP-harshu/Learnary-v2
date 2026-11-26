"use client";

import { useEffect } from "react";

const RELOAD_KEY = "learnary:chunk-reload-at";

/**
 * A deploy replaces every hashed chunk. A tab opened before the deploy (or an
 * aggressively cached HTML shell) can still request the old URLs, which now
 * 404 — Next surfaces that as `ChunkLoadError` / "Failed to fetch dynamically
 * imported module". Reload once to pick up the new build, with a short guard so
 * a genuinely broken deployment cannot reload-loop.
 */
function isChunkError(value) {
  if (!value) return false;
  const name = value.name ?? "";
  const message =
    typeof value === "string" ? value : value.message ?? String(value);
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

export default function ChunkErrorHandler() {
  useEffect(() => {
    const reloadOnce = () => {
      const now = Date.now();
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
        if (now - last < 30_000) return;
        sessionStorage.setItem(RELOAD_KEY, String(now));
      } catch {
        return; // storage unavailable — do not risk a reload loop
      }
      window.location.reload();
    };

    const onError = (event) => {
      if (isChunkError(event.error) || isChunkError(event.message)) {
        reloadOnce();
      }
    };
    const onRejection = (event) => {
      if (isChunkError(event.reason)) reloadOnce();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
