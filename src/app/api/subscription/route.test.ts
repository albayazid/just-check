import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  subscriptionGetRatelimit: { limit: vi.fn() },
}));
vi.mock("@/lib/supabase-client.server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { auth } from "@clerk/nextjs/server";
import { subscriptionGetRatelimit } from "@/lib/ratelimit";
import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { createMockSupabaseClient } from "@/test/mocks/supabase";
import { setAuthenticated, setUnauthenticated } from "@/test/mocks/clerk";
import { rateLimitAllowed, rateLimitBlocked } from "@/test/mocks/ratelimit";
import { GET } from "./route";

function installSubscriptionRow(row: object | null, error: unknown = null) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({
      rpc: {
        get_user_subscription: {
          // The route treats the rpc result as possibly-array; mirror that.
          data: row === null ? [] : [row],
          error,
        },
      },
    }) as never,
  );
}

const ACTIVE_SUBSCRIPTION = {
  plan_id: "plus_monthly",
  status: "active",
  current_period_start: "2026-06-01T00:00:00Z",
  current_period_end: "2026-07-01T00:00:00Z",
  metadata: { cancel_at_next_billing_date: false },
  trial_start: null,
  trial_end: null,
  amount: 20,
  currency: "USD",
  billing_period: "MONTHLY",
  dodo_subscription_id: "dodo_sub_123",
};

describe("GET /api/subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setAuthenticated(auth as never, "user_1");
    // Default: rate limit passes. Override per-test where needed.
    vi.mocked(subscriptionGetRatelimit.limit).mockResolvedValue(rateLimitAllowed());
  });

  it("returns 401 when unauthenticated", async () => {
    setUnauthenticated(auth as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    vi.mocked(subscriptionGetRatelimit.limit).mockResolvedValue(rateLimitBlocked());
    installSubscriptionRow(ACTIVE_SUBSCRIPTION);

    const res = await GET();
    expect(res.status).toBe(429);
  });

  it("returns a normalized free stub when the user has no subscription", async () => {
    installSubscriptionRow(null);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      planId: "free",
      status: "inactive",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialStart: null,
      trialEnd: null,
      amount: 0,
      currency: "USD",
      billingCycle: "monthly",
      subscriptionId: null,
    });
  });

  it("returns the active subscription mapped to the response shape", async () => {
    installSubscriptionRow(ACTIVE_SUBSCRIPTION);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      planId: "plus_monthly",
      status: "active",
      currentPeriodStart: "2026-06-01T00:00:00Z",
      currentPeriodEnd: "2026-07-01T00:00:00Z",
      cancelAtPeriodEnd: false,
      trialStart: null,
      trialEnd: null,
      amount: 20,
      currency: "USD",
      billingCycle: "monthly", // billing_period lowercased
      subscriptionId: "dodo_sub_123",
    });
  });

  it("surfaces cancel_at_next_billing_date from metadata as cancelAtPeriodEnd", async () => {
    installSubscriptionRow({
      ...ACTIVE_SUBSCRIPTION,
      metadata: { cancel_at_next_billing_date: true },
    });

    const res = await GET();
    expect((await res.json()).cancelAtPeriodEnd).toBe(true);
  });

  it("falls back to 'USD' and 'monthly' when currency/billing_period are missing", async () => {
    installSubscriptionRow({
      ...ACTIVE_SUBSCRIPTION,
      currency: null,
      billing_period: null,
    });

    const body = await (await GET()).json();
    expect(body.currency).toBe("USD");
    expect(body.billingCycle).toBe("monthly");
  });

  it("returns 500 when the database throws", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      createMockSupabaseClient({
        rpc: {
          get_user_subscription: {
            data: null,
            error: { code: "X", message: "rpc blew up" },
          },
        },
      }) as never,
    );

    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
