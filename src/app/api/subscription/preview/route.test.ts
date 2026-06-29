import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  subscriptionPreviewRatelimit: { limit: vi.fn() },
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
import { subscriptionPreviewRatelimit } from "@/lib/ratelimit";
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

const SUB = { dodo_subscription_id: "dodo_sub_1", currency: "EUR" };

function previewRequest(productId: string): Request {
  return new Request("https://app.test/api/subscription/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId }),
  });
}

describe("POST /api/subscription/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setAuthenticated(auth as never, "user_1");
    vi.mocked(subscriptionPreviewRatelimit.limit).mockResolvedValue(rateLimitAllowed());
    installSubscription(SUB);
    stubDodoProductEnvs(vi);
  });

  it("returns 401 when unauthenticated", async () => {
    setUnauthenticated(auth as never);
    const res = await POST(previewRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect(res.status).toBe(401);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    vi.mocked(subscriptionPreviewRatelimit.limit).mockResolvedValue(rateLimitBlocked());
    const res = await POST(previewRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect(res.status).toBe(429);
  });

  it("returns 400 when productId is missing", async () => {
    const res = await POST(
      new Request("https://app.test/api/subscription/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when productId is not a known Dodo product", async () => {
    const res = await POST(previewRequest("bogus") as never);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the user has no subscription", async () => {
    installSubscription(null);
    const res = await POST(previewRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect(res.status).toBe(404);
  });

  it("returns 400 when the subscription has no dodo_subscription_id", async () => {
    installSubscription({ dodo_subscription_id: null });
    const res = await POST(previewRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect(res.status).toBe(400);
  });

  it("forwards the Dodo error status when the preview call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse("bad request", { status: 400 })),
    );

    const res = await POST(previewRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect(res.status).toBe(400);
  });

  it("extracts immediateCharge, newPlan and currency from the Dodo preview response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        dodoResponse({
          immediate_charge: { summary: { total_amount: 250, currency: "EUR" } },
          new_plan: { id: "dodo_plus_test", name: "Plus" },
          message: "Proration calculated",
        }),
      ),
    );

    const res = await POST(previewRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.immediateCharge).toBe(250);
    expect(body.currency).toBe("EUR");
    expect(body.newPlan).toEqual({ id: "dodo_plus_test", name: "Plus" });
    expect(body.message).toBe("Proration calculated");
  });

  it("defaults immediateCharge to 0 when the summary is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse({ new_plan: { id: "x" } })),
    );

    const body = await (await POST(previewRequest(PRODUCT_IDS.PLUS_MONTHLY) as never)).json();
    expect(body.immediateCharge).toBe(0);
  });

  it("falls back to the subscription currency then USD when Dodo omits it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        dodoResponse({ immediate_charge: { summary: { total_amount: 0 } } }),
      ),
    );

    const body = await (await POST(previewRequest(PRODUCT_IDS.PLUS_MONTHLY) as never)).json();
    // SUB.currency is "EUR"
    expect(body.currency).toBe("EUR");
  });

  it("returns 500 when the Dodo response body cannot be parsed as JSON", async () => {
    // dodoResponse with a non-JSON string body — the route's JSON.parse throws.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse("not-json-at-all")),
    );

    const res = await POST(previewRequest(PRODUCT_IDS.PLUS_MONTHLY) as never);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Invalid response from payment provider");
  });
});
