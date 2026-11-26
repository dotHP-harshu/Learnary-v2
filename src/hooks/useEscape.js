"use client";

import { useEffect } from "react";

/** Escape-to-dismiss for transient inline UI (pickers, popovers). */
export default function useEscape(handler, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") handler();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handler, active]);
}
