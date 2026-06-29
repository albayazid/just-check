import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
    // Pin the timezone to UTC for the whole suite. Several time-aware modules
    // (age-validation, web-search/time-range) read the clock via LOCAL-TZ
    // accessors (getDate/getMonth/getFullYear/setHours), and our tests pin the
    // system clock to UTC-anchored instants. Without TZ=UTC the local calendar
    // date of those instants shifts by host timezone, making time-aware tests
    // pass on CI (UTC by default) but fail on dev machines in other TZs. This
    // also makes date-only ISO strings ("2000-06-29") deterministic: they
    // parse as UTC and stay there.
    env: {
      TZ: "UTC",
    },
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**", "playwright-report/**"],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      enabled: false,
      provider: "v8",
      // `include` is set (rather than left to the default of "only files
      // covered by tests") so the reported % reflects real project coverage
      // across all source files, not just the ones tests happened to import.
      // This is the number we track batch-to-batch on the way to ~80%.
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text", "text-summary", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // Exclude code that is not meaningfully unit-testable or not ours to test.
      // See plans/testing.md for the rationale behind each exclusion.
      exclude: [
        "node_modules/**",
        ".next/**",
        "coverage/**",
        "public/**",
        "e2e/**",
        "src/test/**",
        "src/types/**",
        "src/providers/**",
        "src/stores/**",
        "src/components/ui/**",
        "src/components/icons/**",
        "src/components/theme-provider.tsx",
        "src/lib/ratelimit.ts",
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "src/app/**/error.tsx",
        "src/app/**/not-found.tsx",
        "src/app/**/global-error.tsx",
        "src/app/**/loading.tsx",
        "**/*.config.{ts,mts,mjs,js}",
        "**/next-env.d.ts",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
      ],
      // Coverage thresholds are intentionally NOT enforced yet.
      // The codebase is being brought from 0% -> ~80% coverage incrementally
      // (batches A-I, see plans/testing.md). Once overall coverage crosses the
      // target, thresholds will be added here and gated in CI.
      thresholds: undefined,
    },
  },
});
