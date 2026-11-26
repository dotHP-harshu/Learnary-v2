"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * Shared dropdown menu primitive: trigger button + popup list, closing on
 * outside click and Escape. `trigger` is a render function receiving
 * { open, toggle, close, menuProps } so callers keep full control of the
 * trigger's look (IconButton, Button, etc.).
 *
 * This is a *disclosure* pattern (aria-expanded + a labelled group of ordinary
 * buttons), not an ARIA `menu`: the latter demands arrow-key navigation and
 * roving tabindex that a plain list of actions does not need. Tab moves
 * through the items naturally, which is honest and fully keyboard accessible.
 */
function Menu({
  label,
  trigger,
  items,
  align = "left",
  panelClassName = "",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleOuterClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus?.();
      }
    };
    document.addEventListener("mousedown", handleOuterClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOuterClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      {trigger?.({
        open,
        toggle: () => setOpen((prev) => !prev),
        close: () => setOpen(false),
        menuProps: {
          "aria-expanded": open,
          ref: triggerRef,
        },
      })}
      {open && (
        <div
          role="group"
          aria-label={label}
          className={`absolute top-full z-50 mt-1.5 min-w-40 overflow-hidden rounded-lg border border-border bg-surface-raised p-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          } ${panelClassName}`}
        >
          {items.map(
            (item) =>
              item && (
                <button
                  key={item.id ?? item.key ?? item.label}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                    item.onSelect?.();
                  }}
                  className={`flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
                    item.danger ? "text-error" : "text-fg"
                  }`}
                >
                  {item.icon && <item.icon size={16} aria-hidden />}
                  {item.label}
                </button>
              )
          )}
        </div>
      )}
    </div>
  );
}

export default Menu;
