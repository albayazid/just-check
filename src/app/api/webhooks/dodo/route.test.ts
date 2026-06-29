import { describe, it, expect, beforeEach, vi } from "vitest";

// DODO_WEBHOOK_SECRET is read at module load (route.ts:85). Must be set BEFORE
// the route module imports. vi.hoisted runs before imports.
vi.hoisted(() => {
  process.env.DODO_WEBHOOK_SECRET = "test_secret";
});

// standardwebhooks mock: hoisted so the factory can reference the verify spy.
// IMPORTANT: the constructor must use a `function` (not an arrow) — Vitest 4
// rejects arrow-function mocks when the route calls `new Webhook(...)`.
const { webhookVerify } = vi.hoisted(() => ({ webhookVerify: vi.fn() }));
vi.mock("standardwebhooks", () => ({
  Webhook: vi.fn(function () {
    return { verify: webhookVerify };
  }),
}));

vi.mock("@/lib/supabase-client.server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { Webhook } from "standardwebhooks";
import { createMockSupabaseClient, pgError } from "@/test/mocks/supabase";
import {
  buildWebhookRequest,
  buildSubscriptionEventPayload,
} from "@/test/mocks/webhook";
import { stubDodoProductEnvs } from "@/test/mocks/env";
import { POST } from "./route";
import { PLAN_ALLOWANCES } from "@/lib/subscription-utils.server";

// restoreMocks wipes the Webhook factory impl between tests — re-wire it in each
// beforeEach so `new Webhook(secret).verify(...)` resolves to the spy.
// Must use `function` (not arrow) so `new Webhook(...)` works (Vitest 4 rule).
function wireWebhookVerify() {
  vi.mocked(Webhook).mockImplementation(function () {
    return { verify: webhookVerify };
  } as never);
  // Route ignores verify's return value; undefined is fine.
  webhookVerify.mockResolvedValue(undefined as never);
}

// ---------------------------------------------------------------------------
// Supabase scenario builder. The handler hits 3 tables in varying orders; the
// per-table arrays are consumed in call sequence.
// ---------------------------------------------------------------------------

type Tables = NonNullable<Parameters<typeof createMockSupabaseClient>[0]>["tables"];

/** Non-duplicate dedup check result (provider_updated_at differs from event). */
const NON_DUP_METADATA = { data: { metadata: { provider_updated_at: "2020-01-01T00:00:00Z" } }, error: null };
const EXISTING_SUB_METADATA = { data: { metadata: {} }, error: null };
const OK = { data: null, error: null };

/**
 * Installs a supabase mock configured for the common "proceed to event
 * processing" path: log insert succeeds, dedup check says "not a duplicate".
 */
function installSupabase(tables: Tables = {}) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({
      rpc: {},
      tables: {
        webhook_event_log: [{ data: { id: "log_1" }, error: null }, OK],
        user_subscriptions: [NON_DUP_METADATA, EXISTING_SUB_METADATA, OK],
        periodic_allowance: [OK],
        ...tables,
      },
    } as never) as never,
  );
}

/** Installs a supabase mock where the idempotency insert returns the given error. */
function installSupabaseWithLogError(
  logError: { code: string; message: string },
  existing: { id: string; processed: boolean } | null,
) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({
      rpc: {},
      tables: {
        webhook_event_log: [
          { data: null, error: logError },
          existing ? { data: existing, error: null } : { data: null, error: null },
        ],
      },
    } as never) as never,
  );
}

describe("POST /api/webhooks/dodo — signature verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wireWebhookVerify();
    installSupabase();
    stubDodoProductEnvs(vi);
  });

  it("returns 400 when webhook headers are missing", async () => {
    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload(), { omitHeaders: true }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing webhook headers" });
  });

  it("returns 401 when signature verification throws", async () => {
    webhookVerify.mockRejectedValue(new Error("invalid signature"));
    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid signature" });
  });

  it("proceeds past verification when the signature is valid", async () => {
    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload()));
    expect(webhookVerify).toHaveBeenCalledTimes(1);
    // 200 = it reached the end of processing (not a 400/401/500).
    expect(res.status).toBe(200);
  });
});

describe("POST /api/webhooks/dodo — idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wireWebhookVerify();
    stubDodoProductEnvs(vi);
  });

  it("returns 200 'already_processed' when a duplicate event was already processed", async () => {
    installSupabaseWithLogError(pgError("23505", "unique"), { id: "log_old", processed: true });

    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, status: "already_processed" });
  });

  it("returns 200 'in_progress' when a duplicate event is being processed elsewhere", async () => {
    installSupabaseWithLogError(pgError("23505", "unique"), { id: "log_old", processed: false });

    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, status: "in_progress" });
  });

  it("returns 500 when the log insert fails with a non-duplicate error", async () => {
    installSupabaseWithLogError(pgError("XX000", "connection lost"), null);

    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Logging failed" });
  });
});

describe("POST /api/webhooks/dodo — event processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wireWebhookVerify();
    installSupabase();
    stubDodoProductEnvs(vi);
  });

  function client() {
    return vi.mocked(getSupabaseAdminClient).mock.results[0]?.value as ReturnType<typeof createMockSupabaseClient>;
  }

  it("subscription.active: updates the subscription without touching allowance", async () => {
    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload({ type: "subscription.active" })));
    expect(res.status).toBe(200);

    // periodic_allowance is NOT touched on activation.
    expect(client().from).not.toHaveBeenCalledWith("periodic_allowance");
    // user_subscriptions IS upserted.
    expect(client().from).toHaveBeenCalledWith("user_subscriptions");
  });

  it("subscription.plan_changed: behaves like subscription.active (no allowance reset)", async () => {
    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload({ type: "subscription.plan_changed" })));
    expect(res.status).toBe(200);
    expect(client().from).not.toHaveBeenCalledWith("periodic_allowance");
  });

  it("subscription.renewed: resets allowance to the full plan amount", async () => {
    const payload = buildSubscriptionEventPayload({
      type: "subscription.renewed",
      data: { product_id: "dodo_pro_test" }, // maps to pro_monthly (allowance 275)
    });
    const res = await POST(buildWebhookRequest(payload));
    expect(res.status).toBe(200);

    // periodic_allowance IS upserted with the plan's full allowance.
    expect(client().from).toHaveBeenCalledWith("periodic_allowance");
    const chain = client().from("periodic_allowance") as unknown as { upsert: ReturnType<typeof vi.fn> };
    const upsertArg = chain.upsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(upsertArg.alloted_allowance).toBe(PLAN_ALLOWANCES.pro_monthly);
    expect(upsertArg.remaining_allowance).toBe(PLAN_ALLOWANCES.pro_monthly);
  });

  it("subscription.failed: updates the subscription without resetting allowance", async () => {
    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload({ type: "subscription.failed" })));
    expect(res.status).toBe(200);
    expect(client().from).not.toHaveBeenCalledWith("periodic_allowance");
  });

  it("subscription.on_hold: resets allowance to the free plan amount", async () => {
    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload({ type: "subscription.on_hold" })));
    expect(res.status).toBe(200);

    expect(client().from).toHaveBeenCalledWith("periodic_allowance");
    const chain = client().from("periodic_allowance") as unknown as { upsert: ReturnType<typeof vi.fn> };
    const upsertArg = chain.upsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(upsertArg.alloted_allowance).toBe(PLAN_ALLOWANCES.free);
    expect(upsertArg.remaining_allowance).toBe(PLAN_ALLOWANCES.free);
  });

  it("subscription.cancelled: resets allowance to the free plan amount", async () => {
    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload({ type: "subscription.cancelled" })));
    expect(res.status).toBe(200);

    expect(client().from).toHaveBeenCalledWith("periodic_allowance");
    const chain = client().from("periodic_allowance") as unknown as { upsert: ReturnType<typeof vi.fn> };
    const upsertArg = chain.upsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(upsertArg.alloted_allowance).toBe(PLAN_ALLOWANCES.free);
  });

  it("marks the webhook as processed (processed: true) after a successful event", async () => {
    await POST(buildWebhookRequest(buildSubscriptionEventPayload({ type: "subscription.active" })));

    const chain = client().from("webhook_event_log") as unknown as { update: ReturnType<typeof vi.fn> };
    const updateArg = chain.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateArg.processed).toBe(true);
    expect(updateArg.http_status).toBe(200);
    expect(updateArg.processing_details).toMatchObject({ action: "subscription_activated" });
  });

  it("subscription.cancelled records the canceled_at timestamp in processing_details", async () => {
    await POST(buildWebhookRequest(buildSubscriptionEventPayload({
      type: "subscription.cancelled",
      data: { cancelled_at: "2026-06-28T12:00:00Z" },
    })));

    const chain = client().from("webhook_event_log") as unknown as { update: ReturnType<typeof vi.fn> };
    const updateArg = chain.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateArg.processing_details).toMatchObject({
      action: "subscription_cancelled",
      canceled_at: "2026-06-28T12:00:00Z",
    });
  });
});

describe("POST /api/webhooks/dodo — timestamp deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wireWebhookVerify();
    stubDodoProductEnvs(vi);
  });

  it("returns 200 'skipped_duplicate' when the event timestamp matches stored metadata", async () => {
    const eventTimestamp = "2026-06-28T00:00:00Z";
    installSupabase({
      // dedup check returns metadata whose provider_updated_at === event timestamp
      user_subscriptions: [
        { data: { metadata: { provider_updated_at: eventTimestamp } }, error: null },
        EXISTING_SUB_METADATA,
        OK,
      ],
    });

    const res = await POST(buildWebhookRequest(
      buildSubscriptionEventPayload({ type: "subscription.active", timestamp: eventTimestamp }),
    ));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, status: "skipped_duplicate" });
  });
});

describe("POST /api/webhooks/dodo — deliberate quirks (regression pins)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wireWebhookVerify();
    installSupabase();
    stubDodoProductEnvs(vi);
  });

  function client() {
    return vi.mocked(getSupabaseAdminClient).mock.results[0]?.value as ReturnType<typeof createMockSupabaseClient>;
  }

  it("QUIRK: subscription.renewed skips the timestamp dedup check entirely", async () => {
    // renewed does NOT call hasMatchingDodoWebhookTimestamp, so user_subscriptions
    // is queried only for the metadata fetch (1 select) + upsert — no dedup select.
    await POST(buildWebhookRequest(buildSubscriptionEventPayload({ type: "subscription.renewed" })));

    const subChain = client().from("user_subscriptions") as unknown as { select: ReturnType<typeof vi.fn> };
    // Only ONE select call on user_subscriptions (the metadata fetch inside
    // updateSubscription). The dedup check would have added a second.
    expect(subChain.select.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("QUIRK: subscription.updated does not persist the dedup timestamp (next event won't be deduped)", async () => {
    await POST(buildWebhookRequest(buildSubscriptionEventPayload({ type: "subscription.updated" })));

    // The upserted user_subscriptions row should NOT carry provider_updated_at,
    // because updateSubscription is called without dodoEventTimestamp for .updated.
    const subChain = client().from("user_subscriptions") as unknown as { upsert: ReturnType<typeof vi.fn> };
    const upsertArg = subChain.upsert.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(upsertArg.metadata).not.toHaveProperty("provider_updated_at");
  });

  it("QUIRK: unknown event types return 200 with action 'unhandled' (silent ack, not an error)", async () => {
    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload({ type: "payment.success" })));
    expect(res.status).toBe(200);

    const logChain = client().from("webhook_event_log") as unknown as { update: ReturnType<typeof vi.fn> };
    const updateArg = logChain.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateArg.processing_details).toEqual({ action: "unhandled" });
    expect(updateArg.processed).toBe(true);
  });
});

describe("POST /api/webhooks/dodo — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    wireWebhookVerify();
    installSupabase();
    stubDodoProductEnvs(vi);
  });

  it("returns 500 and logs processing_details.error when an event handler throws", async () => {
    // Make updateSubscription throw by having the user_subscriptions upsert fail.
    installSupabase({
      user_subscriptions: [
        NON_DUP_METADATA,
        EXISTING_SUB_METADATA,
        { data: null, error: pgError("XX000", "write failed") },
      ],
    });

    const res = await POST(buildWebhookRequest(buildSubscriptionEventPayload({ type: "subscription.active" })));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Processing failed" });

    const client = vi.mocked(getSupabaseAdminClient).mock.results[0]?.value as ReturnType<typeof createMockSupabaseClient>;
    const logChain = client.from("webhook_event_log") as unknown as { update: ReturnType<typeof vi.fn> };
    const updateArg = logChain.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateArg.processed).toBe(false);
    expect(updateArg.http_status).toBe(500);
    expect((updateArg.processing_details as { error: string }).error).toContain("write failed");
  });

  it("returns 500 when clerk_user_id is missing from the event metadata", async () => {
    const payload = buildSubscriptionEventPayload({
      type: "subscription.active",
      data: { customer: { customer_id: "c1", metadata: {} } }, // no clerk_user_id
    });

    const res = await POST(buildWebhookRequest(payload));
    expect(res.status).toBe(500);
  });
});
