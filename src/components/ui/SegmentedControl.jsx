"use client";

import React from "react";

/**
 * Segmented control for mutually exclusive filters/toggles (status filter,
 * tutor mode pills). Single-tab-stop toggle-button pattern: the group is
 * role="group" with a label, each segment is a button with aria-pressed.
 * Options may carry an optional `Icon` component.
 */
function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className = "",
}) {
  const isSm = size === "sm";
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex shrink-0 items-center rounded-lg border border-border bg-surface p-0.5 ${className}`}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange?.(opt.value)}
            className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-md font-medium transition-colors duration-200 ${
              isSm ? "gap-1 px-2.5 py-1.5 text-xs" : "gap-1.5 px-3 py-2 text-sm"
            } ${
              selected
                ? "bg-accent-soft text-accent"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {opt.Icon && <opt.Icon size={14} aria-hidden />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
