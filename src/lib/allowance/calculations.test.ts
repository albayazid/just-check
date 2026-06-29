import { describe, it, expect } from "vitest";
import { calculateCost, type ModelPricing } from "./calculations";

// `calculateCost` returns cost in CENTS (USD × 100) with sub-cent precision,
// per the formula in calculations.ts. Hand-verified expectations below.
//
//   cost_cents = (inputTokens × pricing.input + outputTokens × pricing.output) / 10_000

const FREE: ModelPricing = { input: 0, output: 0 };
const ONE_DOLLAR_PER_M: ModelPricing = { input: 1, output: 1 };

describe("calculateCost", () => {
  describe("zero / free inputs", () => {
    it("returns exactly 0 when both token counts are 0", () => {
      expect(calculateCost(0, 0, ONE_DOLLAR_PER_M)).toBe(0);
    });

    it("returns exactly 0 when pricing is zero even with tokens", () => {
      expect(calculateCost(1_000_000, 1_000_000, FREE)).toBe(0);
    });

    it("returns 0 when only input tokens are used and input is free", () => {
      expect(calculateCost(500, 0, { input: 0, output: 5 })).toBe(0);
    });

    it("returns 0 when only output tokens are used and output is free", () => {
      expect(calculateCost(0, 500, { input: 5, output: 0 })).toBe(0);
    });
  });

  describe("whole-cent amounts (regression-safe)", () => {
    it("charges 100 cents ($1) for 1M input tokens at $1/M", () => {
      expect(calculateCost(1_000_000, 0, ONE_DOLLAR_PER_M)).toBe(100);
    });

    it("charges 200 cents ($2) for 1M input + 1M output at $1/M each", () => {
      expect(calculateCost(1_000_000, 1_000_000, ONE_DOLLAR_PER_M)).toBe(200);
    });

    it("handles asymmetric input/output pricing", () => {
      // Kimi K2.6 pricing from the registry: $1/M in, $5/M out.
      const kimi: ModelPricing = { input: 1, output: 5 };
      // 2M in + 1M out → (2M×1 + 1M×5)/10000 = 7M/10000 = 700 cents ($7).
      expect(calculateCost(2_000_000, 1_000_000, kimi)).toBe(700);
    });

    it("matches real DeepSeek V3.2 pricing for a 1M+1M run", () => {
      // $0.40/M in, $0.70/M out → (1M×0.4 + 1M×0.7)/10000 = 110 cents ($1.10).
      const deepseek: ModelPricing = { input: 0.4, output: 0.7 };
      expect(calculateCost(1_000_000, 1_000_000, deepseek)).toBe(110);
    });
  });

  describe("sub-cent precision (no rounding)", () => {
    it("preserves fractional cent values for small token counts", () => {
      // 1000 tokens at $0.50/M → (1000×0.5)/10000 = 500/10000 = 0.05 cents.
      expect(calculateCost(1000, 0, { input: 0.5, output: 0 })).toBe(0.05);
    });

    it("does not round to the nearest cent on tiny runs", () => {
      // 1 token at $1/M → 1/10000 = 0.0001 cents.
      expect(calculateCost(1, 0, ONE_DOLLAR_PER_M)).toBe(0.0001);
    });

    it("preserves precision deep into the decimals", () => {
      // 1 token at $0.001/M → 0.001/10000 = 0.0000001 cents.
      expect(calculateCost(1, 0, { input: 0.001, output: 0 })).toBe(0.0000001);
    });
  });

  describe("scaling sanity", () => {
    it("scales linearly with token count (doubling tokens doubles cost)", () => {
      const pricing: ModelPricing = { input: 0.4, output: 0.7 };
      const single = calculateCost(123_456, 65_432, pricing);
      const doubled = calculateCost(123_456 * 2, 65_432 * 2, pricing);
      expect(doubled).toBeCloseTo(single * 2, 10);
    });

    it("handles a large production-sized run without overflow", () => {
      // 50M in + 10M out at Kimi K2.6 rates → (50M×1 + 10M×5)/10000 = 100M/10000 = 10000 cents ($100).
      const kimi: ModelPricing = { input: 1, output: 5 };
      expect(calculateCost(50_000_000, 10_000_000, kimi)).toBe(10000);
    });
  });
});
