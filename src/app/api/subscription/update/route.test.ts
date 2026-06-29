import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  subscriptionRatelimit: { limit: vi.fn() },
}));
vi.mock("@/lib/dodo-utils.server", () => ({
  DODO_API_KEY: "dodo_test_key",
  DODO_API_URL: "https://test.dodo.test",
  DODO_RETURN_URL: "https://app.test/checkout/return",
  DODO_ENVIRONMENT: "test_mode" as const,
}));
vi.mock("@/lib/supabase-client.server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { auth } from "@clerk/nextjs/server";
import { subscriptionRatelimit } from "@/lib/ratelimit";
import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { createMockSupabaseClient } from "@/test/mocks/supabase";
import { setAuthenticated, setUnauthenticated } from "@/test/mocks/clerk";
import { dodoResponse } from "@/test/mocks/dodo";
import { stubDodoProductEnvs } from "@/test/mocks/env";
import { rateLimitAllowed, rateLimitBlocked } from "@/test/mocks/ratelimit";
import { POST } from "./route";
import { PRODUCT_IDS } from "@/lib/subscription-utils";

function installSubscription(row: object | null) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({
      rpc: { get_user_subscription: { data: row === null ? [] : [row], error: null } },
    }) as never,
  );
}

const FULL_SUB = {
  dodo_subscription_id: "dodo_sub_1",
  dodo_customer_id: "dodo_cust_1",
  currency: "USD",
};

function updateRequest(productId: string): Request {
  return new Request("https://app.test/api/subscription/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId }),
  });
}

describe("POST /api/subscription/update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setAuthenticated(auth as never, "user_1");
    vi.mocked(subscriptionRatelimit.limit).mockResolvedValue(rateLimitAllowed());
    installSubscription(FULL_SUB);
    stubDodoProductEnvs(vi);
  });

  it("returns 401 when unauthenticated", async () => {
    setUnauthenticated(auth as never);
    const res = await POST(updateRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect(res.status).toBe(401);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    vi.mocked(subscriptionRatelimit.limit).mockResolvedValue(rateLimitBlocked());
    const res = await POST(updateRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect(res.status).toBe(429);
  });

  it("returns 400 when productId is missing", async () => {
    const res = await POST(
      new Request("https://app.test/api/subscription/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }) as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("productId is required");
  });

  it("returns 400 when productId does not map to a known Dodo product", async () => {
    const res = await POST(updateRequest("not_a_real_product") as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid product ID");
  });

  it("returns 403 when the user has no active subscription", async () => {
    installSubscription(null);
    const res = await POST(updateRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("No active subscription");
  });

  it("returns 400 when the subscription has no dodo_subscription_id", async () => {
    installSubscription({ ...FULL_SUB, dodo_subscription_id: null });
    const res = await POST(updateRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Subscription ID not found");
  });

  it("returns 400 when the subscription has no dodo_customer_id", async () => {
    installSubscription({ ...FULL_SUB, dodo_customer_id: null });
    const res = await POST(updateRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Customer ID not found");
  });

  it("forwards the Dodo error status when the change-plan call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse("payment required", { status: 402 })),
    );

    const res = await POST(updateRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);

    expect(res.status).toBe(402);
  });

  it("returns success with the new subscription and currency on a successful change", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        dodoResponse({ subscription: { id: "dodo_sub_1", status: "active" } }),
      ),
    );

    const res = await POST(updateRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.subscription).toEqual({ id: "dodo_sub_1", status: "active" });
    expect(body.currency).toBe("USD"); // echoed from the stored subscription
  });

  it("falls back to USD currency when the stored subscription has none", async () => {
    installSubscription({ ...FULL_SUB, currency: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse({ subscription: { id: "dodo_sub_1" } })),
    );

    const res = await POST(updateRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect((await res.json()).currency).toBe("USD");
  });

  it("targets the Dodo change-plan endpoint with the mapped product_id and prorated billing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dodoResponse({ subscription: {} })));

    await POST(updateRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.dodo.test/subscriptions/dodo_sub_1/change-plan");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    // The internal PLUS_MONTHLY id maps to the env-stubbed Dodo product id.
    expect(body.product_id).toBe("dodo_plus_test");
    expect(body.proration_billing_mode).toBe("prorated_immediately");
    expect(body.on_payment_failure).toBe("prevent_change");
  });
});
