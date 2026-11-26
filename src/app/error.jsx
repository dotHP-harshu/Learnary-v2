"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Button from "../components/ui/Button";

export default function ErrorPage({ error, reset }) {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-bg px-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-error-soft">
        <TriangleAlert size={22} className="text-error" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold text-fg">Something went wrong</h1>
      <p role="alert" className="max-w-sm text-sm text-fg-muted">
        An unexpected error occurred.
        {error?.digest ? ` (Ref: ${error.digest})` : ""}
      </p>
      <Button onClick={reset}>
        <RotateCcw size={16} aria-hidden />
        Try again
      </Button>
    </div>
  );
}
