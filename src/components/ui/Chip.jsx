"use client";

import React from "react";

/**
 * Static status/label chip (priority, difficulty, count, metadata). This is
 * NOT an interactive control — use SegmentedControl for toggles. Tones map to
 * status tokens; `neutral` is the default hairline chip.
 */
const TONES = {
  neutral: "border-border bg-surface-muted text-fg-muted",
  accent: "border-accent/30 bg-accent-soft text-accent",
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  error: "border-error/30 bg-error-soft text-error",
};

const SIZES = {
  sm: "px-2 py-0.5 text-2xs gap-1",
  md: "px-2.5 py-1 text-xs gap-1.5",
};

function Chip({ tone = "neutral", size = "sm", icon: Icon, className = "", children }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border font-medium ${
        TONES[tone]
      } ${SIZES[size]} ${className}`}
    >
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </span>
  );
}

export default Chip;
