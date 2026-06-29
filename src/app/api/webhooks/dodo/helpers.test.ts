import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  addDays,
  getPlanIdFromProductId,
  buildSubscriptionData,
  type DodoSubscriptionEventData,
} from "./helpers";
import { stubDodoProductEnvs } from "@/test/mocks/env";
import { PRODUCT_IDS } from "@/lib/subscription-utils";

const BASE_DATA: DodoSubscriptionEventData = {
  status: "active",
  created_at: "2026-06-01T00:00:00Z",
  next_billing_date: "2026-07-01T00:00:00Z",
  payment_frequency_interval: "MONTHLY",
  trial_period_days: 0,
  recurring_pre_tax_amount: 20,
  currency: "USD",
  cancel_at_next_billing_date: false,
  customer: { customer_id: "dodo_cust_1" },
  canceled_at: undefined,
};

describe("addDays", () => {
  it("adds days within the same month", () => {
    expect(addDays("2026-06-10T00:00:00Z", 5)).toBe("2026-06-15T00:00:00.000Z");
  });

  it("rolls over to the next month", () => {
    expect(addDays("2026-06-28T00:00:00Z", 7)).toBe("2026-07-05T00:00:00.000Z");
  });

  it("rolls over to the next year", () => {
    expect(addDays("2026-12-30T00:00:00Z", 3)).toBe("2027-01-02T00:00:00.000Z");
  });

  it("handles a leap day (2028 is a leap year)", () => {
    expect(addDays("2028-02-28T00:00:00Z", 1)).toBe("2028-02-29T00:00:00.000Z");
    expect(addDays("2026-02-28T00:00:00Z", 1)).toBe("2026-03-01T00:00:00.000Z");
  });

  it("returns an ISO string with milliseconds", () => {
    expect(addDays("2026-06-01T00:00:00Z", 1)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("accepts a zero offset (returns the same instant)", () => {
    expect(addDays("2026-06-15T12:30:00Z", 0)).toBe("2026-06-15T12:30:00.000Z");
  });
});

describe("getPlanIdFromProductId", () => {
  beforeEach(() => {
    stubDodoProductEnvs(vi);
  });

  it("returns the internal plan id for a known Dodo product id", () => {
    expect(getPlanIdFromProductId("dodo_go_test")).toBe(PRODUCT_IDS.GO_MONTHLY);
    expect(getPlanIdFromProductId("dodo_plus_test")).toBe(PRODUCT_IDS.PLUS_MONTHLY);
    expect(getPlanIdFromProductId("dodo_pro_test")).toBe(PRODUCT_IDS.PRO_MONTHLY);
  });

  it("returns null for an unknown Dodo product id", () => {
    expect(getPlanIdFromProductId("dodo_unknown")).toBeNull();
  });
});

describe("buildSubscriptionData", () => {
  beforeEach(() => {
    stubDodoProductEnvs(vi);
  });

  function build(overrides: Partial<Parameters<typeof buildSubscriptionData>[0]> = {}) {
    return buildSubscriptionData({
      clerkUserId: "user_1",
      subscriptionId: "dodo_sub_1",
      // productId is the DODO product id (what Dodo sends), not the internal
      // plan id. "dodo_plus_test" is the env-stubbed Dodo id that maps to PLUS_MONTHLY.
      productId: "dodo_plus_test",
      existingMetadata: {},
      data: BASE_DATA,
      dodoEventTimestamp: undefined,
      ...overrides,
    });
  }

  describe("plan resolution", () => {
    it("resolves the planId from the Dodo product id", () => {
      const { planId } = build({ productId: "dodo_plus_test" });
      expect(planId).toBe(PRODUCT_IDS.PLUS_MONTHLY);
    });

    it("throws when the product id is not mapped to a plan", () => {
      expect(() => build({ productId: "dodo_unknown" })).toThrowError(
        /Unknown product_id: dodo_unknown/,
      );
    });
  });

  describe("field mappings", () => {
    it("maps every Dodo field to the user_subscriptions row", () => {
      const { subscriptionData: row } = build();

      expect(row).toMatchObject({
        clerk_user_id: "user_1",
        dodo_subscription_id: "dodo_sub_1",
        status: "active",
        plan_id: PRODUCT_IDS.PLUS_MONTHLY,
        current_period_start: "2026-06-01T00:00:00Z",
        current_period_end: "2026-07-01T00:00:00Z",
        amount: 20,
        currency: "USD",
        dodo_customer_id: "dodo_cust_1",
      });
    });

    it("lowercases the billing_period from payment_frequency_interval", () => {
      const { subscriptionData: row } = build({
        data: { ...BASE_DATA, payment_frequency_interval: "YEARLY" },
      });
      expect(row.billing_period).toBe("yearly");
    });

    it("leaves billing_period undefined when payment_frequency_interval is absent", () => {
      const { subscriptionData: row } = build({
        data: { ...BASE_DATA, payment_frequency_interval: undefined },
      });
      expect(row.billing_period).toBeUndefined();
    });

    it("passes canceled_at through, defaulting falsy to null", () => {
      expect(build({ data: { ...BASE_DATA, canceled_at: "2026-06-20T00:00:00Z" } })
        .subscriptionData.canceled_at).toBe("2026-06-20T00:00:00Z");
      expect(build({ data: { ...BASE_DATA, canceled_at: undefined } })
        .subscriptionData.canceled_at).toBeNull();
    });

    it("extracts dodo_customer_id from data.customer.customer_id", () => {
      const { subscriptionData: row } = build({
        data: { ...BASE_DATA, customer: { customer_id: "cust_abc" } },
      });
      expect(row.dodo_customer_id).toBe("cust_abc");
    });
  });

  describe("trial period math", () => {
    it("sets trial_start/trial_end when trial_period_days > 0", () => {
      const { subscriptionData: row } = build({
        data: { ...BASE_DATA, trial_period_days: 14 },
      });
      expect(row.trial_start).toBe("2026-06-01T00:00:00Z");
      // 14 days after 2026-06-01.
      expect(row.trial_end).toBe(addDays("2026-06-01T00:00:00Z", 14));
    });

    it("nulls trial_start/trial_end when trial_period_days is 0", () => {
      const { subscriptionData: row } = build({
        data: { ...BASE_DATA, trial_period_days: 0 },
      });
      expect(row.trial_start).toBeNull();
      expect(row.trial_end).toBeNull();
    });

    it("nulls trial_start/trial_end when trial_period_days is undefined", () => {
      const { subscriptionData: row } = build({
        data: { ...BASE_DATA, trial_period_days: undefined },
      });
      expect(row.trial_start).toBeNull();
      expect(row.trial_end).toBeNull();
    });
  });

  describe("metadata merge", () => {
    it("stamps product_id and cancel_at_next_billing_date onto the metadata", () => {
      const { subscriptionData: row } = build({
        data: { ...BASE_DATA, cancel_at_next_billing_date: true },
      });
      // metadata.product_id stores the INPUT Dodo product id, not the internal plan id.
      expect(row.metadata).toMatchObject({
        product_id: "dodo_plus_test",
        cancel_at_next_billing_date: true,
      });
    });

    it("preserves existing metadata fields (does not overwrite)", () => {
      const { subscriptionData: row } = build({
        existingMetadata: { old_field: "keep_me", product_id: "old_value" },
      });
      // existing old_field survives; product_id is overwritten by the new Dodo id.
      expect(row.metadata.old_field).toBe("keep_me");
      expect(row.metadata.product_id).toBe("dodo_plus_test");
    });

    it("does NOT add provider_updated_at when dodoEventTimestamp is absent", () => {
      const { subscriptionData: row } = build({ dodoEventTimestamp: undefined });
      expect(row.metadata).not.toHaveProperty("provider_updated_at");
    });

    it("adds provider_updated_at only when dodoEventTimestamp is provided", () => {
      const { subscriptionData: row } = build({
        dodoEventTimestamp: "2026-06-28T00:00:00Z",
      });
      expect(row.metadata.provider_updated_at).toBe("2026-06-28T00:00:00Z");
    });

    it("treats an empty-string timestamp as absent (conditional uses truthiness)", () => {
      const { subscriptionData: row } = build({ dodoEventTimestamp: "" });
      expect(row.metadata).not.toHaveProperty("provider_updated_at");
    });
  });
});
