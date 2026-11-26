"use client";

import React from "react";

// Square icon-only button. `label` is required and becomes the accessible
// name (aria-label) plus the visible tooltip, so icon controls are never unnamed.
const VARIANTS = {
  ghost: "border border-transparent text-fg-muted hover:text-fg hover:bg-accent-soft",
  outline:
    "border border-border bg-surface text-fg-muted hover:text-fg hover:border-border-strong",
  solid: "border border-transparent bg-accent-strong text-accent-fg hover:bg-accent",
};

// Every size clears the ~40px touch-target minimum; `size` controls the icon
// padding/visual weight, not the hit area.
const SIZES = {
  sm: "min-h-10 min-w-10 p-2 rounded-md",
  md: "min-h-10 min-w-10 p-2.5 rounded-lg",
  lg: "min-h-11 min-w-11 p-3 rounded-lg",
};

function IconButton({
  label,
  variant = "ghost",
  size = "md",
  className = "",
  children,
  ...props
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default IconButton;
