"use client";

import React from "react";
import Image from "next/image";

// Source artwork is 500×135; callers drive the rendered height through
// `className` (e.g. h-9 w-auto), so the intrinsic size only needs to keep the
// aspect ratio. next/image serves an optimised, correctly sized variant.
const LOGO_WIDTH = 500;
const LOGO_HEIGHT = 135;

// Brand logo. `size` sets the intrinsic width; `className` lets callers match
// the surrounding layout (e.g. h-9 w-auto). The logo always appears in the
// first viewport (site header, auth card), so it loads eagerly.
function Logo({ size = LOGO_WIDTH, className = "", alt = "Learnary" }) {
  const width = size;
  const height = Math.round((size / LOGO_WIDTH) * LOGO_HEIGHT);
  return (
    <Image
      src="/logo.png"
      alt={alt}
      width={width}
      height={height}
      priority
      className={`select-none ${className}`}
    />
  );
}

export default Logo;
