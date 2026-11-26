"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe online status. `navigator.onLine` must never be read during
 * render: client components still render on the server, where `navigator`
 * doesn't exist. The hook starts `true` (matching the server's only possible
 * answer, so hydration markup agrees), then syncs with real connectivity
 * after mount and on `online`/`offline` events.
 */
export default function useOnlineStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
