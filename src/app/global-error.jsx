"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Button from "../components/ui/Button";

// Root-level boundary: catches errors thrown by the root layout itself
// (src/app/error.jsx only covers page/render errors). It must render its own
// <html>/<body> — the layout that normally provides them has failed — and
// re-applies the dark theme class since the pre-paint script in the layout
// never ran. Intentionally does not use providers/Toast (none exist here).
export default function GlobalError({ error, reset }) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body>
        <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-bg px-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-error-soft">
            <TriangleAlert size={22} className="text-error" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold text-fg">Something went wrong</h1>
          <p role="alert" className="max-w-sm text-sm text-fg-muted">
            Learnary couldn&apos;t load.
            {error?.digest ? ` (Ref: ${error.digest})` : ""}
          </p>
          <Button onClick={reset}>
            <RotateCcw size={16} aria-hidden />
            Try again
          </Button>
        </div>
      </body>
    </html>
  );
}
