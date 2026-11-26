"use client";

import React from "react";

/**
 * Shared card surface: hairline border, token-driven colors (light/dark
 * automatic), consistent radius. Optional `interactive` styles for clickable
 * cards.
 */
function Card({ as: Tag = "div", interactive = false, className = "", children, ...props }) {
  return (
    <Tag
      className={`rounded-xl border border-border bg-surface ${
        interactive
          ? "cursor-pointer transition-colors duration-200 hover:border-border-strong hover:shadow-sm"
          : ""
      } ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}

export default Card;
