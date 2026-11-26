"use client";

import React, { Suspense, lazy } from "react";

// react-markdown and its remark plugins are a large dependency that only assistant
// output needs, but the tasks/tutor route bundles import this component
// eagerly. Split the renderer into its own chunk and load it on first use;
// until it arrives, the raw text (still readable, line breaks preserved) is
// shown instead of a blank box.
const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));

/**
 * Shared markdown renderer for generated content (tutor replies, task
 * assist outputs). The heavy parser is loaded lazily — see MarkdownRenderer.
 */
function Markdown({ children, className = "" }) {
  return (
    <div className={`markdown ${className}`}>
      <Suspense fallback={<div className="whitespace-pre-line">{children}</div>}>
        <MarkdownRenderer>{children}</MarkdownRenderer>
      </Suspense>
    </div>
  );
}

export default Markdown;
