"use client";

import React, { useId } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Shared select primitive — the single replacement for the hand-rolled
 * `selectClass` strings. Same label/error/hint wiring as Input; options are
 * passed through as children so callers keep full control of <option> content.
 */
export const SELECT_CLASS =
  "w-full appearance-none rounded-lg border border-border bg-surface py-2 pl-3 pr-9 text-sm text-fg outline-none transition-colors duration-200 focus:border-accent disabled:cursor-not-allowed disabled:opacity-60";

function Select({
  label,
  error,
  hint,
  id,
  className = "",
  inputRef,
  required,
  children,
  ...props
}) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;
  const describedBy = [hint && !error ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-fg">
          {label}
          {required && (
            <>
              <span aria-hidden="true" className="ml-0.5 text-error">*</span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          ref={inputRef}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${SELECT_CLASS} ${error ? "border-error" : ""} ${className}`}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          size={14}
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted"
        />
      </div>
      {hint && !error && <p id={hintId} className="text-xs text-fg-muted">{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export default Select;
