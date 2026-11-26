"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

// Global toast notifications: success/info auto-dismiss, errors persist until
// dismissed and can carry a retry action. Announced politely to screen readers.

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const STYLES = {
  success: {
    icon: "text-success",
    border: "border-success/40",
    bar: "bg-success",
  },
  error: {
    icon: "text-error",
    border: "border-error/40",
    bar: "bg-error",
  },
  info: {
    icon: "text-accent",
    border: "border-border",
    bar: "bg-accent",
  },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idCounter = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Never leave timers behind when the provider unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const push = useCallback(
    (type, message, options = {}) => {
      const id = ++idCounter.current;
      setToasts((prev) => {
        const next = [...prev, { id, type, message, ...options }];
        // Keep the stack short, but never let a transient message evict a
        // persistent error: drop the oldest non-error first.
        while (next.length > 3) {
          const droppable = next.findIndex((t) => t.type !== "error");
          next.splice(droppable === -1 ? 0 : droppable, 1);
        }
        return next;
      });
      // Errors persist until dismissed; everything else auto-dismisses.
      if (type !== "error") {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), 4000)
        );
      }
      return id;
    },
    [dismiss]
  );

  const success = useCallback(
    (message, options) => push("success", message, options),
    [push]
  );
  const error = useCallback(
    (message, options) => push("error", message, options),
    [push]
  );
  const info = useCallback(
    (message, options) => push("info", message, options),
    [push]
  );

  // One stable object identity: callers may depend on `toast` inside
  // useCallback/useEffect without their loaders re-running every time a
  // notification is pushed or dismissed.
  const toast = useMemo(
    () => ({ success, error, info }),
    [success, error, info]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end">
        {toasts.map(({ id, type, message, action }) => {
          const Icon = ICONS[type] ?? Info;
          const style = STYLES[type] ?? STYLES.info;
          return (
            <div
              key={id}
              role={type === "error" ? "alert" : "status"}
              aria-live={type === "error" ? "assertive" : "polite"}
              className={`pointer-events-auto relative flex w-full max-w-md items-start gap-3 overflow-hidden rounded-xl border ${style.border} bg-surface-raised p-3 pl-4 shadow-lg`}
            >
              <span className={`absolute left-0 top-0 h-full w-1 ${style.bar}`} />
              <Icon size={18} className={`mt-0.5 shrink-0 ${style.icon}`} aria-hidden />
              <p className="min-w-0 flex-1 text-sm text-fg">{message}</p>
              {action && (
                <button
                  type="button"
                  onClick={() => {
                    action.onClick?.();
                    dismiss(id);
                  }}
                  className="shrink-0 text-sm font-medium text-accent hover:underline"
                >
                  {action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(id)}
                className="shrink-0 rounded-md p-0.5 text-fg-muted transition-colors hover:text-fg"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}
