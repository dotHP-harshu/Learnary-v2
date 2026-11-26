"use client";

import { useEffect, useRef } from "react";

/**
 * `true` until the component unmounts. Async assistant handlers use it before
 * acknowledging a result: a component that unmounted mid-request must leave
 * the persisted handle in place so the next mount can recover the result.
 */
export default function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    // Re-arm on mount: React's development StrictMode runs effects twice
    // (mount → cleanup → mount), and the ref must not stay `false` afterwards.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
