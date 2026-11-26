"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import IconButton from "./IconButton";

/**
 * Accessible back navigation as a real button (was an unlabeled icon div).
 */
function BackButton({ path, label = "Go back" }) {
  const router = useRouter();
  return (
    <IconButton
      label={label}
      variant="outline"
      size="md"
      onClick={() => router.push(path)}
    >
      <ArrowLeft size={18} />
    </IconButton>
  );
}

export default BackButton;
