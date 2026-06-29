import { describe, it, expect } from "vitest";
import { resolveModelRoute, type RoutingContext } from "./router";

// All routes currently target the openrouter provider — locking that as a
// contract so an accidental provider flip in routing is caught immediately.
const OPENROUTER = "openrouter";

// DeepSeek V3.2 is the text-only fast path; Kimi K2.5 is the vision fallback.
const DEEPSEEK_V32 = "deepseek/deepseek-v3.2";
const KIMI_K25 = "moonshotai/kimi-k2.5";
const KIMI_K26 = "moonshotai/kimi-k2.6";

// `reasoning` is the only providerOption key the router emits today.
function reasoningEnabled(route: ReturnType<typeof resolveModelRoute>): boolean {
  return (
    (route.providerOptions as { openrouter?: { reasoning?: { enabled?: boolean } } })
      ?.openrouter?.reasoning?.enabled ?? false
  );
}

describe("resolveModelRoute", () => {
  describe("provider contract", () => {
    it.each([
      ["fast", undefined],
      ["thinker", undefined],
      ["pro-thinker", undefined],
      ["lumy-flash-1", undefined],
      ["lumy-itor-1", undefined],
      ["unknown-id", undefined],
      ["fast", { hasImages: true }],
    ])("always routes uiModelId=%s to the openrouter provider", (id, ctx) => {
      expect(resolveModelRoute(id, ctx).provider).toBe(OPENROUTER);
    });
  });

  describe("'fast' mode", () => {
    it("routes to DeepSeek V3.2 with reasoning disabled for plain text", () => {
      const route = resolveModelRoute("fast");
      expect(route.id).toBe(DEEPSEEK_V32);
      expect(reasoningEnabled(route)).toBe(false);
    });

    it("upgrades to Kimi K2.5 when images are attached (vision-capable)", () => {
      const route = resolveModelRoute("fast", { hasImages: true });
      expect(route.id).toBe(KIMI_K25);
      expect(reasoningEnabled(route)).toBe(false);
    });
  });

  describe("'thinker' mode", () => {
    it("routes to DeepSeek V3.2 with reasoning enabled for plain text", () => {
      const route = resolveModelRoute("thinker");
      expect(route.id).toBe(DEEPSEEK_V32);
      expect(reasoningEnabled(route)).toBe(true);
    });

    it("upgrades to Kimi K2.5 (reasoning on) when images are attached", () => {
      const route = resolveModelRoute("thinker", { hasImages: true });
      expect(route.id).toBe(KIMI_K25);
      expect(reasoningEnabled(route)).toBe(true);
    });
  });

  describe("'pro-thinker' mode", () => {
    it("routes directly to Kimi K2.6 with reasoning enabled", () => {
      const route = resolveModelRoute("pro-thinker");
      expect(route.id).toBe(KIMI_K26);
      expect(reasoningEnabled(route)).toBe(true);
    });

    it("ignores the images context (always Kimi K2.6)", () => {
      const route = resolveModelRoute("pro-thinker", { hasImages: true });
      expect(route.id).toBe(KIMI_K26);
    });
  });

  describe("'lumy-flash-1' (mirrors 'fast')", () => {
    it("routes to DeepSeek V3.2 with reasoning disabled for plain text", () => {
      const route = resolveModelRoute("lumy-flash-1");
      expect(route.id).toBe(DEEPSEEK_V32);
      expect(reasoningEnabled(route)).toBe(false);
    });

    it("upgrades to Kimi K2.5 when images are attached", () => {
      const route = resolveModelRoute("lumy-flash-1", { hasImages: true });
      expect(route.id).toBe(KIMI_K25);
      expect(reasoningEnabled(route)).toBe(false);
    });
  });

  describe("'lumy-itor-1' (mirrors 'pro-thinker')", () => {
    it("routes directly to Kimi K2.6 with reasoning enabled", () => {
      const route = resolveModelRoute("lumy-itor-1");
      expect(route.id).toBe(KIMI_K26);
      expect(reasoningEnabled(route)).toBe(true);
    });

    it("ignores the images context", () => {
      const route = resolveModelRoute("lumy-itor-1", { hasImages: true });
      expect(route.id).toBe(KIMI_K26);
    });
  });

  describe("unknown / fallback", () => {
    it("falls back to Kimi K2.5 with no providerOptions for an unknown id", () => {
      const route = resolveModelRoute("does-not-exist");
      expect(route.id).toBe(KIMI_K25);
      expect(route.providerOptions).toBeUndefined();
    });

    it("falls back identically regardless of routing context", () => {
      const ctx: RoutingContext = { hasImages: true, hasFiles: true };
      const route = resolveModelRoute("mystery", ctx);
      expect(route.id).toBe(KIMI_K25);
      expect(route.providerOptions).toBeUndefined();
    });

    it("falls back for the empty string id", () => {
      expect(resolveModelRoute("").id).toBe(KIMI_K25);
    });
  });
});
