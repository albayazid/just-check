import { describe, it, expect } from "vitest";
import { getModelPricing } from "./pricing";
import { allInternalModels } from "@/lib/models";

describe("getModelPricing", () => {
  describe("known models", () => {
    it("returns the pricing for DeepSeek V4 Flash on the openrouter provider", () => {
      expect(getModelPricing("openrouter", "deepseek/deepseek-v4-flash-0731")).toEqual({
        input: 0.3,
        output: 0.6,
      });
    });

    it("returns the pricing for GLM 5.3 Flash on the openrouter provider", () => {
      expect(getModelPricing("openrouter", "z-ai/glm-5.3-flash")).toEqual({
        input: 0.4,
        output: 0.8,
      });
    });

    it("returns the pricing for Qwen 3.8 Flash on the openrouter provider", () => {
      expect(getModelPricing("openrouter", "qwen/qwen3.8-flash")).toEqual({
        input: 0.3,
        output: 0.6,
      });
    });

    it("returns a plain ModelPricing object (no extra registry fields leak)", () => {
      const pricing = getModelPricing("openrouter", "z-ai/glm-5.3-flash");
      expect(pricing).toEqual({ input: 0.4, output: 0.8 });
      expect(Object.keys(pricing ?? {}).sort()).toEqual(["input", "output"]);
    });
  });

  describe("unknown models", () => {
    it("returns null for a known provider but unknown model id", () => {
      expect(getModelPricing("openrouter", "nope/does-not-exist")).toBeNull();
    });

    it("returns null for an unknown provider", () => {
      expect(getModelPricing("anthropic", "claude-3")).toBeNull();
    });

    it("returns null for an empty provider and model", () => {
      expect(getModelPricing("", "")).toBeNull();
    });
  });

  describe("lookup is case-sensitive and exact (registry contract)", () => {
    it("does not match a model id with different casing", () => {
      expect(getModelPricing("openrouter", "DeepSeek/DeepSeek-V4-Flash")).toBeNull();
    });

    it("does not match a partial / prefix id", () => {
      expect(getModelPricing("openrouter", "deepseek/deepseek-v4-flash-0731-extra")).toBeNull();
    });
  });

  describe("registry consistency", () => {
    // This guards against the registry accidentally containing two entries
    // with the same (provider, id), which would make the lookup ambiguous.
    it("has no duplicate (provider, id) pairs in allInternalModels", () => {
      const keys = allInternalModels.map((m) => `${m.provider}:${m.id}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("every entry in the registry is resolvable via getModelPricing", () => {
      for (const model of allInternalModels) {
        const pricing = getModelPricing(model.provider, model.id);
        expect(pricing, `${model.provider}:${model.id}`).not.toBeNull();
        expect(pricing?.input).toBe(model.pricing.input);
        expect(pricing?.output).toBe(model.pricing.output);
      }
    });

    it("contains exactly the models the router routes to", () => {
      expect(allInternalModels.map((m) => m.id).sort()).toEqual([
        "deepseek/deepseek-v4-flash-0731",
        "qwen/qwen3.8-flash",
        "z-ai/glm-5.3-flash",
      ]);
    });
  });
});
