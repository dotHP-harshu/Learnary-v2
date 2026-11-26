"use client";

import React from "react";

/**
 * Loading placeholder block for skeleton screens — keeps layout stable while
 * data resolves instead of blanking then popping (CLS).
 */
function Skeleton({ className = "" }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-lg bg-border/60 ${className}`}
    />
  );
}

export default Skeleton;
