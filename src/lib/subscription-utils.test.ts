import { describe, it, expect } from "vitest";
import {
  PRODUCT_IDS,
  PLAN_DISPLAY_NAMES,
  getPlanDisplayName,
} from "./subscription-utils";

describe("PRODUCT_IDS", () => {
  it("exposes the three paid plan ids", () => {
    expect(PRODUCT_IDS).toEqual({
      GO_MONTHLY: "go_monthly",
      PLUS_MONTHLY: "plus_monthly",
      PRO_MONTHLY: "pro_monthly",
    });
  });
});

describe("PLAN_DISPLAY_NAMES", () => {
  it("maps every internal plan id to its display name", () => {
    expect(PLAN_DISPLAY_NAMES).toEqual({
      free: "Free",
      go_monthly: "Go",
      plus_monthly: "Plus",
      pro_monthly: "Pro",
    });
  });

  it("has an entry for every PRODUCT_ID", () => {
    for (const productId of Object.values(PRODUCT_IDS)) {
      expect(PLAN_DISPLAY_NAMES[productId], productId).toBeTruthy();
    }
  });
});

describe("getPlanDisplayName", () => {
  describe("known plan ids", () => {
    it("returns 'Free' for the free plan", () => {
      expect(getPlanDisplayName("free")).toBe("Free");
    });

    it("returns 'Go' for go_monthly", () => {
      expect(getPlanDisplayName("go_monthly")).toBe("Go");
    });

    it("returns 'Plus' for plus_monthly", () => {
      expect(getPlanDisplayName("plus_monthly")).toBe("Plus");
    });

    it("returns 'Pro' for pro_monthly", () => {
      expect(getPlanDisplayName("pro_monthly")).toBe("Pro");
    });
  });

  describe("unknown plan ids (fallback)", () => {
    it("replaces underscores with spaces for an unknown id", () => {
      expect(getPlanDisplayName("unknown_plan")).toBe("unknown plan");
    });

    it("handles multi-word unknown ids", () => {
      expect(getPlanDisplayName("go_yearly_special")).toBe("go yearly special");
    });

    it("returns the id unchanged when it has no underscores", () => {
      expect(getPlanDisplayName("mystery")).toBe("mystery");
    });

    it("falls back for the empty string", () => {
      expect(getPlanDisplayName("")).toBe("");
    });
  });
});
