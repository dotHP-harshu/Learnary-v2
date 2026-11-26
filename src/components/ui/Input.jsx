"use client";

import React, { useId } from "react";

// Shared text input with label, hint and accessible error wiring; generates
// an id when none is passed so label/input stay associated.
export const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-muted/70 transition-colors duration-200 outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60";

function Input({ label, error, hint, className = "", id, inputRef, required, ...props }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint && !error ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-fg">
          {label}
          {required && (
            <>
              <span aria-hidden="true" className="ml-0.5 text-error">*</span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </label>
      )}
      <input
        id={inputId}
        ref={inputRef}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${INPUT_CLASS} ${error ? "border-error" : ""} ${className}`}
        {...props}
      />
      {hint && !error && <p id={hintId} className="text-xs text-fg-muted">{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export default Input;
