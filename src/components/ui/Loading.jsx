"use client";

import React from "react";
import { LoaderCircle } from "lucide-react";

function Loading({ label = "Loading" }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex h-full w-full items-center justify-center py-8"
    >
      <LoaderCircle
        size={24}
        className="animate-spin text-accent"
        aria-hidden
      />
    </div>
  );
}

export default Loading;
