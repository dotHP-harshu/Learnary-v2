"use client";

import React from "react";

/**
 * Shared page header — one heading rhythm for every app page (fixes the
 * text-xl vs text-2xl drift between pages). Slot composition: optional
 * breadcrumb row above the title, description under it, right-side actions.
 */
function PageHeader({ breadcrumb, title, description, actions, titleClassName = "", className = "" }) {
  return (
    <header
      className={`flex flex-wrap items-start justify-between gap-x-6 gap-y-3 ${className}`}
    >
      <div className="min-w-0">
        {breadcrumb && (
          <div className="mb-1.5 flex items-center gap-1 text-sm text-fg-muted">
            {breadcrumb}
          </div>
        )}
        <h1
          className={`truncate text-2xl font-semibold tracking-tight text-fg ${titleClassName}`}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

export default PageHeader;
