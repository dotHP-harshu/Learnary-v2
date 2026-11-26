"use client";

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import IconButton from "./IconButton";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Accessible centered modal: dialog semantics, focus trap, Esc/backdrop to
// close, focus restore, body scroll lock, and an internal scroll region so the
// actions stay reachable on short viewports.
function Modal({ open, onClose, title, children, closeLabel = "Close dialog" }) {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement;
    const panel = panelRef.current;

    // Prefer an explicitly marked field, then the first *enabled* control.
    // Focusing a disabled one is a no-op that would leave focus on the trigger
    // behind the dialog.
    const focusables = panel?.querySelectorAll(FOCUSABLE);
    const preferred = panel?.querySelector("[data-autofocus]:not([disabled])");
    (preferred ?? focusables?.[0] ?? panel)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Pull focus back if it escapes the dialog by any other route.
    const handleFocusIn = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        (panelRef.current.querySelector(FOCUSABLE) ?? panelRef.current)?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm max-sm:px-2"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-xl outline-none"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-4 pb-3">
          {title && (
            <h2 className="text-lg font-semibold text-fg">{title}</h2>
          )}
          <IconButton label={closeLabel} variant="ghost" size="sm" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="scrollable min-h-0 flex-1 overflow-y-auto p-4 pt-3">
          {children}
        </div>
      </div>
    </div>
  );
}

export default Modal;
