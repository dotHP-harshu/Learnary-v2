"use client";

import React, { useId, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

// Expandable note showing exactly what context was used for a response; the
// list comes from the server (`data.context_used`) and renders nothing when empty.
function ContextUsed({ items, className = "" }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!items || items.length === 0) return null;

  const summary =
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded-md text-xs text-fg-muted transition-colors duration-200 hover:text-fg"
      >
        <Sparkles size={12} className="shrink-0 text-accent" aria-hidden />
        <span>Using: {summary}</span>
        <ChevronDown
          size={12}
          aria-hidden
          className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul id={listId} className="mt-1.5 flex flex-col gap-0.5 pl-5 text-xs text-fg-muted">
          {items.map((item) => (
            <li key={item} className="list-disc">
              {item.charAt(0).toUpperCase()}
              {item.slice(1)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ContextUsed;
