"use client";

import React from "react";

/**
 * Shared empty state: muted icon, title, description and an optional action,
 * replacing the bare "click the plus button" one-liners.
 */
function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
      {Icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
          <Icon size={22} className="text-accent" aria-hidden />
        </span>
      )}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description && (
        <p className="max-w-sm text-sm text-fg-muted">{description}</p>
      )}
      {action}
    </div>
  );
}

export default EmptyState;
