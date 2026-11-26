import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Plain Node environment: the modules under test are pure (scoring, parsing,
// scheduling, date bucketing, metrics). React components are not exercised here.
export default defineConfig({
  resolve: {
    alias: [
      {
        // See tests/stubs/server-only.js — the real package throws outside the
        // React Server bundler.
        find: /^server-only$/,
        replacement: fileURLToPath(
          new URL("./tests/stubs/server-only.js", import.meta.url)
        ),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
  },
});
