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

const ACTIVE_SUB = {
  dodo_subscription_id: "dodo_sub_1",
  metadata: { cancel_at_next_billing_date: false },
};

function cancelRequest(cancelAtNextBillingDate: boolean): Request {
  return new Request("https://app.test/api/subscription/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cancelAtNextBillingDate }),
  });
}

describe("POST /api/subscription/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setAuthenticated(auth as never, "user_1");
    vi.mocked(subscriptionRatelimit.limit).mockResolvedValue(rateLimitAllowed());
    installSubscription(ACTIVE_SUB);
  });

  it("returns 401 when unauthenticated", async () => {
    setUnauthenticated(auth as never);
    const res = await POST(cancelRequest(true));
    expect(res.status).toBe(401);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    vi.mocked(subscriptionRatelimit.limit).mockResolvedValue(rateLimitBlocked());
    const res = await POST(cancelRequest(true));
    expect(res.status).toBe(429);
  });

  it("returns 400 when cancelAtNextBillingDate is missing", async () => {
    const res = await POST(
      new Request("https://app.test/api/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when cancelAtNextBillingDate is not a boolean", async () => {
    const res = await POST(
      new Request("https://app.test/api/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelAtNextBillingDate: "yes" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const res = await POST(
      new Request("https://app.test/api/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the user has no subscription", async () => {
    installSubscription(null);
    const res = await POST(cancelRequest(true));
    expect(res.status).toBe(404);
  });

  it("returns 400 when the subscription has no dodo_subscription_id", async () => {
    installSubscription({ dodo_subscription_id: null, metadata: {} });
    const res = await POST(cancelRequest(true));
    expect(res.status).toBe(400);
  });

  it("returns 400 when asked to cancel an already-scheduled cancellation", async () => {
    installSubscription({
      dodo_subscription_id: "dodo_sub_1",
      metadata: { cancel_at_next_billing_date: true },
    });
    const res = await POST(cancelRequest(true));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("already scheduled");
  });

  it("returns 400 when asked to uncancel a subscription not scheduled for cancellation", async () => {
    // ACTIVE_SUB has cancel_at_next_billing_date: false → uncancel makes no sense
    const res = await POST(cancelRequest(false));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not scheduled");
  });

  it("forwards the Dodo error status when the PATCH fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse("conflict", { status: 409 })),
    );

    const res = await POST(cancelRequest(true));

    expect(res.status).toBe(409);
    // The PATCH was sent with cancel_at_next_billing_date: true
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((fetchCall?.[1]?.body as string) ?? "{}");
    expect(body.cancel_at_next_billing_date).toBe(true);
  });

  it("returns success and the cancellation message when the PATCH succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse({ subscription: { id: "dodo_sub_1" } })),
    );

    const res = await POST(cancelRequest(true));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("cancelled at the end of the current billing period");
    // The route returns the raw parsed Dodo response under `subscription`.
    expect(body.subscription).toEqual({ subscription: { id: "dodo_sub_1" } });
  });

  it("returns the reactivation message when un-cancelling succeeds", async () => {
    installSubscription({
      dodo_subscription_id: "dodo_sub_1",
      metadata: { cancel_at_next_billing_date: true },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse({ subscription: { id: "dodo_sub_1" } })),
    );

    const res = await POST(cancelRequest(false));

    expect(res.status).toBe(200);
    expect((await res.json()).message).toContain("reactivated");
  });

  it("targets the correct Dodo subscription URL via PATCH", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(dodoResponse({})),
    );

    await POST(cancelRequest(true));

    const url = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(url).toBe("https://test.dodo.test/subscriptions/dodo_sub_1");
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.method).toBe("PATCH");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer dodo_test_key",
      "Content-Type": "application/json",
    });
  });
});
