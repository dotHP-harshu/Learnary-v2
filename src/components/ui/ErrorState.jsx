"use client";

import React from "react";
import { AlertCircle } from "lucide-react";
import Button from "./Button";

/**
 * Unified inline error panel — one severity system replacing the ~10
 * hand-rolled `border-error/40 bg-error/10`-style variants. Use for failed
 * data loads inside a page section; for one-off action failures keep using
 * the toast. `onRetry` renders the standard retry affordance.
 */
function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
  retryDisabled = false,
  className = "",
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col gap-3 rounded-lg border border-error/40 bg-error-soft px-4 py-3.5 sm:flex-row sm:items-center ${className}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0 text-error" />
        <div className="min-w-0">
          {title && <p className="text-sm font-medium text-fg">{title}</p>}
          {message && <p className="text-sm text-fg-muted">{message}</p>}
        </div>
      </div>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          disabled={retryDisabled}
          className="shrink-0"
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export default ErrorState;
