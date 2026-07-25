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
    business_id: "biz_test_1",
    data: {
      // Full Subscription payload that passes @dodopayments/core's
      // WebhookPayloadSchema. Tests override individual fields via `...overrides.data`.
      payload_type: "Subscription",
      status: "active",
      created_at: "2026-06-01T00:00:00Z",
      previous_billing_date: "2026-06-01T00:00:00Z",
      next_billing_date: "2026-07-01T00:00:00Z",
      payment_frequency_interval: "Month",
      payment_frequency_count: 1,
      subscription_period_interval: "Month",
      subscription_period_count: 1,
      trial_period_days: 0,
      recurring_pre_tax_amount: 20,
      currency: "USD",
      cancel_at_next_billing_date: false,
      cancelled_at: null,
      expires_at: null,
      product_id: "dodo_plus_test",
      subscription_id: "dodo_sub_1",
      quantity: 1,
      on_demand: false,
      tax_id: null,
      tax_inclusive: false,
      payment_method_id: null,
      discount_id: null,
      discount_cycles_remaining: null,
      brand_id: "brand_test_1",
      addons: [],
      meters: [],
      credit_entitlement_cart: [],
      meter_credit_entitlement_cart: [],
      custom_field_responses: null,
      metadata: {},
      customer: {
        customer_id: "dodo_cust_1",
        email: "user@example.com",
        name: "User One",
        phone_number: null,
        metadata: { clerk_user_id: "user_1" },
      },
      billing: { country: "US", city: null, state: null, street: null, zipcode: null },
      ...overrides.data,
    },
  };
}
