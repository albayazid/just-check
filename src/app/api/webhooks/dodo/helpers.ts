/**
 * Pure helpers for the Dodo webhook handler.
 *
 * Extracted from `./route` so the richest domain logic — plan-id resolution,
 * trial-end date math, and metadata merge — is unit-testable without a
 * Supabase mock wall. The route file handles HTTP + I/O orchestration; this
 * file holds the pure transformations.
 */
import { getPlanIdFromDodoProductId } from "@/lib/subscription-utils.server";

/** Shape of the `data` field Dodo sends on a subscription.* event. */
export interface DodoSubscriptionEventData {
  status: string;
  created_at: string;
  next_billing_date: string;
  payment_frequency_interval?: string;
  trial_period_days?: number;
  recurring_pre_tax_amount: number;
  currency: string;
  cancel_at_next_billing_date?: boolean;
  customer?: { customer_id?: string };
  canceled_at?: string;
}

/** The `user_subscriptions` row built from a Dodo event. */
export interface SubscriptionRow {
  clerk_user_id: string;
  dodo_subscription_id: string;
  status: string;
  plan_id: string;
  billing_period: string | undefined;
  current_period_start: string;
  current_period_end: string;
  trial_start: string | null;
  trial_end: string | null;
  amount: number;
  currency: string;
  dodo_customer_id: string | undefined;
  canceled_at: string | null;
  metadata: Record<string, unknown>;
}

/** Inputs to `buildSubscriptionData`. */
export interface BuildSubscriptionDataArgs {
  clerkUserId: string;
  subscriptionId: string;
  productId: string;
  existingMetadata: Record<string, unknown>;
  data: DodoSubscriptionEventData;
  /** Optional Dodo event timestamp — only persisted to metadata when provided. */
  dodoEventTimestamp?: string;
}

/**
 * Maps a Dodo product id to an internal plan id. Returns null for unknown
 * products (passthrough to `getPlanIdFromDodoProductId`).
 */
export function getPlanIdFromProductId(productId: string): string | null {
  return getPlanIdFromDodoProductId(productId);
}

/**
 * Adds days to an ISO date string, handling month/year rollovers via the
 * native Date implementation. Returns an ISO string.
 */
export function addDays(date: string, days: number): string {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result.toISOString();
}

/**
 * Builds the `user_subscriptions` row to upsert for a subscription.* event,
 * and resolves the internal plan id.
 *
 * Pure given its inputs — the only thing that was previously entangled with
 * I/O was fetching `existingMetadata`, which is now passed in by the caller.
 *
 * @throws if `productId` does not map to a known plan.
 */
export function buildSubscriptionData({
  clerkUserId,
  subscriptionId,
  productId,
  existingMetadata,
  data,
  dodoEventTimestamp,
}: BuildSubscriptionDataArgs): { subscriptionData: SubscriptionRow; planId: string } {
  const planId = getPlanIdFromProductId(productId);
  if (!planId) {
    throw new Error(`Unknown product_id: ${productId}. Not mapped to a plan.`);
  }

  const hasTrial = data.trial_period_days && data.trial_period_days > 0;

  const subscriptionData: SubscriptionRow = {
    clerk_user_id: clerkUserId,
    dodo_subscription_id: subscriptionId,
    status: data.status,
    plan_id: planId,
    billing_period: data.payment_frequency_interval?.toLowerCase(),
    current_period_start: data.created_at,
    current_period_end: data.next_billing_date,
    trial_start: hasTrial ? data.created_at : null,
    trial_end: hasTrial ? addDays(data.created_at, data.trial_period_days as number) : null,
    amount: data.recurring_pre_tax_amount,
    currency: data.currency,
    dodo_customer_id: data.customer?.customer_id,
    canceled_at: data.canceled_at || null,
    metadata: {
      ...existingMetadata, // Preserve existing metadata fields
      product_id: productId,
      cancel_at_next_billing_date: data.cancel_at_next_billing_date,
      // Only stamp the dedup timestamp when explicitly provided.
      ...(dodoEventTimestamp && { provider_updated_at: dodoEventTimestamp }),
    },
  };

  return { subscriptionData, planId };
}
