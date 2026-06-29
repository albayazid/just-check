import { NextRequest } from "next/server";

/**
 * Helpers for testing the Dodo webhook route.
 *
 * `buildWebhookRequest` constructs a `NextRequest` matching what Dodo sends
 * (POST with `webhook-id` / `webhook-signature` / `webhook-timestamp` headers
 * and a JSON body). The `standardwebhooks` module mock itself lives in each
 * test file (vi.mock is per-file) using the `vi.hoisted` pattern:
 *
 *   const { webhookVerify } = vi.hoisted(() => ({ webhookVerify: vi.fn() }));
 *   vi.mock("standardwebhooks", () => ({
 *     Webhook: vi.fn(() => ({ verify: webhookVerify })),
 *   }));
 *
 * Then per test: `webhookVerify.mockResolvedValue({})` (valid) or
 * `webhookVerify.mockRejectedValue(new Error("bad sig"))` (invalid).
 */

export interface BuildWebhookRequestOptions {
  /** Override the webhook-id header (default "evt_test_1"). */
  webhookId?: string;
  /** Override the webhook-signature header (default "sig_test"). */
  webhookSignature?: string;
  /** Override the webhook-timestamp header (default "1719500000"). */
  webhookTimestamp?: string;
  /** Omit all three webhook headers — for the missing-headers 400 path. */
  omitHeaders?: boolean;
}

export function buildWebhookRequest(
  body: object,
  opts: BuildWebhookRequestOptions = {},
): NextRequest {
  const headers = new Headers();
  if (!opts.omitHeaders) {
    headers.set("webhook-id", opts.webhookId ?? "evt_test_1");
    headers.set("webhook-signature", opts.webhookSignature ?? "sig_test");
    headers.set("webhook-timestamp", opts.webhookTimestamp ?? "1719500000");
  }
  return new NextRequest("https://app.test/api/webhooks/dodo", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Builds the canonical Dodo `subscription.*` event payload used across tests.
 * Override fields via `overrides` (merged shallowly into `data`).
 */
export function buildSubscriptionEventPayload(
  overrides: {
    type?: string;
    timestamp?: string;
    data?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    id: "evt_test_1",
    type: overrides.type ?? "subscription.active",
    timestamp: overrides.timestamp ?? "2026-06-28T00:00:00Z",
    data: {
      status: "active",
      created_at: "2026-06-01T00:00:00Z",
      next_billing_date: "2026-07-01T00:00:00Z",
      payment_frequency_interval: "MONTHLY",
      trial_period_days: 0,
      recurring_pre_tax_amount: 20,
      currency: "USD",
      cancel_at_next_billing_date: false,
      cancelled_at: null,
      product_id: "dodo_plus_test",
      subscription_id: "dodo_sub_1",
      customer: {
        customer_id: "dodo_cust_1",
        metadata: { clerk_user_id: "user_1" },
      },
      ...overrides.data,
    },
  };
}
