"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/**
 * The actual markdown renderer, split into its own module so `Markdown.jsx`
 * can load react-markdown + the remark plugins on demand. Element styles live
 * in the `.markdown` scope in globals.css; font size and color inherit from
 * the parent surface.
 *
 * Safety: Model output is untrusted — react-markdown renders text nodes and
 * escapes raw HTML by default (no dangerouslySetInnerHTML), and links get
 * target=_blank + rel=noopener noreferrer.
 */
function MarkdownRenderer({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        a: ({ children, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

export default MarkdownRenderer;
