"use client";

import React from "react";
import { LoaderCircle } from "lucide-react";

/**
 * Shared button primitive (redesign foundation).
 *
 * Variants: primary (solid accent), secondary (surface + hairline border),
 * ghost (text only), danger (destructive). `loading` disables the button and
 * swaps its label for a spinner while keeping the width stable.
 *
 * `as` allows a Link (or any component) to take button styling without nesting
 * an interactive <button> inside an <a>, e.g. <Button as={Link} href="/x">.
 */
const VARIANTS = {
  primary:
    "bg-accent-strong text-accent-fg hover:bg-accent disabled:hover:bg-accent-strong",
  secondary:
    "bg-surface text-fg border border-border hover:border-border-strong hover:bg-accent-soft",
  ghost:
    "bg-transparent text-fg-muted hover:text-fg hover:bg-accent-soft border border-transparent",
  danger: "bg-error text-error-fg hover:opacity-90",
};

const SIZES = {
  sm: "min-h-10 text-sm px-3 py-2 rounded-md gap-1.5",
  md: "min-h-10 text-sm px-4 py-2.5 rounded-lg gap-2",
  lg: "min-h-12 text-base px-6 py-3 rounded-lg gap-2",
};

function Button({
  as: Tag = "button",
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  className = "",
  children,
  type = "button",
  ...props
}) {
  const isDisabled = disabled || loading;
  return (
    <Tag
      {...(Tag === "button" ? { type, disabled: isDisabled } : {})}
      aria-disabled={Tag !== "button" && isDisabled ? true : undefined}
      className={`inline-flex select-none items-center justify-center font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
        VARIANTS[variant]
      } ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
      {children}
    </Tag>
  );
}

export default Button;
