/**
 * Global Vitest setup — runs once before every test file.
 *
 * Responsibilities:
 *  1. Register @testing-library/jest-dom DOM matchers.
 *  2. Polyfill browser APIs that jsdom does not implement but that Radix /
 *     Next.js / framer-motion depend on (ResizeObserver, IntersectionObserver,
 *     matchMedia, scrollIntoView, PointerEvent, etc.). Without these, component
 *     tests render but interactions throw.
 *  3. Reset DOM + mocks between tests so suites stay hermetic.
 *
 * Mock factories for external services (Clerk, Supabase, Dodo, OpenRouter) and
 * the msw request handlers are added per-batch in the batch that first needs
 * them. See plans/testing.md.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// ---- 1. jsdom polyfills ---------------------------------------------------

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    readonly root: Element | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }

  if (!window.scrollTo) {
    window.scrollTo = () => {};
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // Radix UI relies on pointer events; jsdom does not implement PointerEvent.
  if (typeof window.PointerEvent === "undefined") {
    class PointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? "";
        this.isPrimary = init.isPrimary ?? false;
      }
    }
    (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent =
      PointerEvent;
    (globalThis as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent =
      PointerEvent;
  }
}

// ---- 2. Per-test isolation ------------------------------------------------

afterEach(() => {
  cleanup();
});
