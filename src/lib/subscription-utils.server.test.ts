import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  PLAN_ALLOWANCES,
  FOLDER_LIMITS,
  getFolderLimit,
  getDodoProductIds,
  getDodoProductId,
  getPlanIdFromDodoProductId,
} from "./subscription-utils.server";
import { PRODUCT_IDS } from "./subscription-utils";
import { stubDodoProductEnvs } from "@/test/mocks/env";

describe("PLAN_ALLOWANCES (daily allowance by plan — billing contract)", () => {
  it("pins the expected daily-allowance amounts per plan", () => {
    expect(PLAN_ALLOWANCES).toEqual({
      free: 4,
      go_monthly: 13.2,
      plus_monthly: 54,
      pro_monthly: 275,
    });
  });

  it("has an entry for every product id", () => {
    for (const productId of Object.values(PRODUCT_IDS)) {
      expect(typeof PLAN_ALLOWANCES[productId], productId).toBe("number");
    }
  });

  it("includes the free plan allowance", () => {
    expect(PLAN_ALLOWANCES.free).toBe(4);
  });
});

describe("FOLDER_LIMITS (max folders per plan)", () => {
  it("pins the expected folder caps per plan", () => {
    expect(FOLDER_LIMITS).toEqual({
      free: 2,
      go_monthly: 10,
      plus_monthly: 50,
      pro_monthly: 200,
    });
  });
});

describe("getFolderLimit", () => {
  it("returns the limit for each known plan", () => {
    expect(getFolderLimit("free")).toBe(2);
    expect(getFolderLimit("go_monthly")).toBe(10);
    expect(getFolderLimit("plus_monthly")).toBe(50);
    expect(getFolderLimit("pro_monthly")).toBe(200);
  });

  it("falls back to the free limit for an unknown plan id", () => {
    expect(getFolderLimit("nonexistent_plan")).toBe(FOLDER_LIMITS.free);
    expect(getFolderLimit("nonexistent_plan")).toBe(2);
  });

  it("falls back for the empty string", () => {
    expect(getFolderLimit("")).toBe(2);
  });
});

describe("Dodo product-id ↔ plan-id mappers", () => {
  beforeEach(() => {
    // Stub the Dodo product-id env vars (return value not needed here).
    stubDodoProductEnvs(vi);
  });

  describe("getDodoProductIds", () => {
    it("returns the three product ids with their Dodo env values", () => {
      expect(getDodoProductIds()).toEqual({
        [PRODUCT_IDS.GO_MONTHLY]: "dodo_go_test",
        [PRODUCT_IDS.PLUS_MONTHLY]: "dodo_plus_test",
        [PRODUCT_IDS.PRO_MONTHLY]: "dodo_pro_test",
      });
    });
  });

  describe("getDodoProductId (internal plan id → Dodo product id)", () => {
    it("returns the mapped Dodo id for each known product id", () => {
      expect(getDodoProductId(PRODUCT_IDS.GO_MONTHLY)).toBe("dodo_go_test");
      expect(getDodoProductId(PRODUCT_IDS.PLUS_MONTHLY)).toBe("dodo_plus_test");
      expect(getDodoProductId(PRODUCT_IDS.PRO_MONTHLY)).toBe("dodo_pro_test");
    });

    it("returns null for an unknown product id", () => {
      expect(getDodoProductId("not_a_real_product")).toBeNull();
    });

    it("returns null for the empty string", () => {
      expect(getDodoProductId("")).toBeNull();
    });
  });

  describe("getPlanIdFromDodoProductId (Dodo product id → internal plan id)", () => {
    it("returns the internal plan id for each known Dodo product id", () => {
      expect(getPlanIdFromDodoProductId("dodo_go_test")).toBe(PRODUCT_IDS.GO_MONTHLY);
      expect(getPlanIdFromDodoProductId("dodo_plus_test")).toBe(PRODUCT_IDS.PLUS_MONTHLY);
      expect(getPlanIdFromDodoProductId("dodo_pro_test")).toBe(PRODUCT_IDS.PRO_MONTHLY);
    });

    it("returns null for an unknown Dodo product id", () => {
      expect(getPlanIdFromDodoProductId("dodo_unknown")).toBeNull();
    });
  });

  describe("round-trip consistency", () => {
    it("getPlanIdFromDodoProductId ∘ getDodoProductId is the identity on known ids", () => {
      for (const productId of Object.values(PRODUCT_IDS)) {
        const dodoId = getDodoProductId(productId);
        expect(dodoId, productId).not.toBeNull();
        const roundTripped = getPlanIdFromDodoProductId(dodoId as string);
        expect(roundTripped, productId).toBe(productId);
      }
    });

    it("maps each Dodo id back to a unique plan id (no two product ids share a Dodo id)", () => {
      const internalIds = Object.values(PRODUCT_IDS);
      const dodoIdPerPlan = internalIds.map((id) => getDodoProductId(id));
      expect(new Set(dodoIdPerPlan).size).toBe(internalIds.length);
    });
  });
});
