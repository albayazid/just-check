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
import { rateLimitAllowed, rateLimitBlocked } from "@/test/mocks/ratelimit";
import { POST } from "./route";

function installSubscription(row: object | null) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({
      rpc: { get_user_subscription: { data: row === null ? [] : [row], error: null } },
    }) as never,
  );
}

const SUB = { dodo_subscription_id: "dodo_sub_1" };

describe("POST /api/subscription/update-payment-method", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setAuthenticated(auth as never, "user_1");
    vi.mocked(subscriptionRatelimit.limit).mockResolvedValue(rateLimitAllowed());
    installSubscription(SUB);
  });

  it("returns 401 when unauthenticated", async () => {
    setUnauthenticated(auth as never);
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    vi.mocked(subscriptionRatelimit.limit).mockResolvedValue(rateLimitBlocked());
    const res = await POST();
    expect(res.status).toBe(429);
  });

  it("returns 404 when the user has no subscription", async () => {
    installSubscription(null);
    const res = await POST();
    expect(res.status).toBe(404);
  });

  it("returns 400 when the subscription has no dodo_subscription_id", async () => {
    installSubscription({ dodo_subscription_id: null });
    const res = await POST();
    expect(res.status).toBe(400);
  });

  it("forwards the Dodo error status when the update-payment-method call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse("server error", { status: 502 })),
    );

    const res = await POST();
    expect(res.status).toBe(502);
  });

  it("returns 500 when Dodo succeeds but omits payment_link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse({ payment_id: "pay_1" })),
    );

    const res = await POST();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("No payment link returned");
  });

  it("returns the payment_link, payment_id and client_secret on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        dodoResponse({
          payment_link: "https://pay.dodo.test/abc",
          payment_id: "pay_123",
          client_secret: "secret_xyz",
        }),
      ),
    );

    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      payment_link: "https://pay.dodo.test/abc",
      payment_id: "pay_123",
      client_secret: "secret_xyz",
    });
  });

  it("nulls out payment_id and client_secret when Dodo omits them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        dodoResponse({ payment_link: "https://pay.dodo.test/abc" }),
      ),
    );

    const body = await (await POST()).json();
    expect(body.payment_id).toBeNull();
    expect(body.client_secret).toBeNull();
  });

  it("targets the Dodo update-payment-method endpoint with type: 'new'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse({ payment_link: "x" })),
    );

    await POST();

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.dodo.test/subscriptions/dodo_sub_1/update-payment-method");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ type: "new" });
  });

  it("returns 500 when the Dodo response body cannot be parsed as JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse("garbage")),
    );

    const res = await POST();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Invalid response from payment provider");
  });
});
