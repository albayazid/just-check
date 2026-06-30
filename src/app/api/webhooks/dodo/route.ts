/**
 * Dodo Payment Provider Webhook Handler
 * 
 * This file handles incoming webhooks from the Dodo payment provider.
 * Webhooks are HTTP callbacks that notify your application when events happen
 * in the payment provider's system (e.g., subscription created, payment succeeded, etc.).
 * 
 * @see https://www.dodo.com/developers/docs/webhooks for Dodo webhook documentation
 * 
 * =============================================================================
 * WEBHOOK FLOW OVERVIEW:
 * =============================================================================
 * 
 * 1. RECEIVE: Dodo sends a POST request to this endpoint when an event occurs
 * 2. VERIFY: Validate the webhook signature to ensure it's actually from Dodo
 * 3. LOG: Record the webhook in the database for audit and idempotency
 * 4. PROCESS: Handle the specific event type (subscription active, payment, etc.)
 * 5. UPDATE: Mark the webhook as processed in the database
 * 
 * =============================================================================
 * WHY THIS ARCHITECTURE:
 * =============================================================================
 * 
 * - SECURITY: Signature verification prevents fake webhooks from malicious actors
 * - IDEMPOTENCY: Processing each webhook only once prevents duplicate operations
 * - AUDIT TRAIL: All webhooks are logged for troubleshooting
 * - FAULT TOLERANCE: If processing fails, we log the error without crashing
 * 
 * =============================================================================
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient, SupabaseClient } from '@/lib/supabase-client.server';
import { Webhook } from "standardwebhooks";
import { PLAN_ALLOWANCES } from "@/lib/subscription-utils.server";
import { getCurrentUtcDailyAllowanceWindow } from "@/lib/allowance";
import { buildSubscriptionData, type DodoSubscriptionEventData } from "./helpers";

// =============================================================================
// TIMESTAMP DEDUPLICATION (OPTIONAL)
// ==============================================================================

/**
 * Checks if a Dodo event's timestamp matches the stored subscription's provider_updated_at.
 * Dodo fires duplicate events with the same timestamp for the same action.
 * This check is only performed when a timestamp is provided in the event.
 * But as of our knowledge dodo provides it in all the subscription.___ events.
 *
 * @param supabase - Supabase client
 * @param subscriptionId - Dodo subscription ID
 * @param dodoTimestamp - ISO 8601 timestamp from Dodo event
 * @returns True if the timestamp matches the stored value (duplicate event)
 */
async function hasMatchingDodoWebhookTimestamp(
  supabase: SupabaseClient,
  subscriptionId: string,
  dodoTimestamp: string
): Promise<boolean> {
  try {
    const { data: subscription, error } = await supabase
      .from('user_subscriptions')
      .select('metadata')
      .eq('dodo_subscription_id', subscriptionId)
      .single();

    if (error || !subscription) {
      console.warn(`Subscription not found for ${subscriptionId}:`, error);
      return false; // Can't deduplicate, let it process
    }

    const currentProviderTimestamp = subscription?.metadata?.provider_updated_at ?? null;
    return currentProviderTimestamp === dodoTimestamp;
  } catch (error) {
    console.error(`Error checking timestamp for ${subscriptionId}:`, error);
    return false; // Fail safe - process the webhook
  }
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// This secret is used to verify that incoming webhooks are actually from Dodo
// and not from someone pretending to be Dodo (security measure)
// It should be stored in your .env file as DODO_WEBHOOK_SECRET
const DODO_WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET;

/**
 * Updates subscription only (no allowance changes)
 * Uses status from the payload data
 */
async function updateSubscription(
  supabase: SupabaseClient,
  clerkUserId: string,
  productId: string,
  subscriptionId: string,
  data: DodoSubscriptionEventData,
  dodoEventTimestamp?: string // Optional: only used for deduplication when provided
) {
  // Fetch existing subscription to merge metadata (avoid overwriting)
  const { data: existingSubscription } = await supabase
    .from('user_subscriptions')
    .select('metadata')
    .eq('dodo_subscription_id', subscriptionId)
    .single();

  const existingMetadata = existingSubscription?.metadata || {};

  // Pure: resolve plan id (throws on unknown product) + build the upsert row.
  const { subscriptionData, planId } = buildSubscriptionData({
    clerkUserId,
    subscriptionId,
    productId,
    existingMetadata,
    data,
    dodoEventTimestamp,
  });

  const { error: subError } = await supabase
    .from('user_subscriptions')
    .upsert(subscriptionData, { onConflict: 'dodo_subscription_id' });

  if (subError) {
    throw new Error(`Failed to upsert subscription: ${subError.message}`);
  }

  return { planId };
}

/**
 * Updates subscription and resets allowance to plan's full amount
 * Used for: subscription.renewed (and optionally active/plan_changed if they provide timestamp)
 */
async function upsertSubscriptionAndResetAllowance(
  supabase: SupabaseClient,
  clerkUserId: string,
  productId: string,
  subscriptionId: string,
  data: DodoSubscriptionEventData,
  dodoEventTimestamp?: string // Optional: only used for deduplication when provided
) {
  const { planId } = await updateSubscription(
    supabase,
    clerkUserId,
    productId,
    subscriptionId,
    data,
    dodoEventTimestamp
  );

  const allowance = PLAN_ALLOWANCES[planId];
  const { periodStart, periodEnd } = getCurrentUtcDailyAllowanceWindow();
  const allowanceData = {
    clerk_user_id: clerkUserId,
    alloted_allowance: allowance,
    remaining_allowance: allowance, // Full reset
    period_start: periodStart,
    period_end: periodEnd,
    last_reset_at: new Date().toISOString(),
  };

  const { error: allowanceError } = await supabase
    .from('periodic_allowance')
    .upsert(allowanceData, { onConflict: 'clerk_user_id' });

  if (allowanceError) {
    throw new Error(`Failed to upsert allowance: ${allowanceError.message}`);
  }

  return { planId, allowance };
}

/**
 * Resets allowance to the free plan's allowance
 * Used for: subscription.on_hold, subscription.cancelled
 * This ensures users on free tier get the correct allowance even if the value changes
 */
async function resetAllowanceToFreePlan(supabase: SupabaseClient, clerkUserId: string) {
  const freePlanAllowance = PLAN_ALLOWANCES['free'];
  const now = new Date().toISOString();
  const { periodStart, periodEnd } = getCurrentUtcDailyAllowanceWindow();

  const { error: allowanceError } = await supabase
    .from('periodic_allowance')
    .upsert({
      clerk_user_id: clerkUserId,
      alloted_allowance: freePlanAllowance,
      remaining_allowance: freePlanAllowance,
      period_start: periodStart,
      period_end: periodEnd,
      last_reset_at: now,
    }, { onConflict: 'clerk_user_id' });

  if (allowanceError) {
    throw new Error(`Failed to reset allowance to free plan: ${allowanceError.message}`);
  }
}

// =============================================================================
// MAIN WEBHOOK HANDLER
// =============================================================================

/**
 * POST /api/webhooks/dodo
 * 
 * This is the entry point for all Dodo payment webhooks.
 * Dodo will call this endpoint whenever a subscription event occurs.
 * 
 * Expected Headers from Dodo:
 * - webhook-id: Unique identifier for this webhook
 * - webhook-signature: Cryptographic signature to verify authenticity
 * - webhook-timestamp: When the webhook was sent (for replay protection)
 * 
 * Expected JSON Body:
 * {
 *   "id": "evt_123",           // Unique event ID
 *   "type": "subscription.active",  // The type of event
 *   "data": { ... }            // Event-specific data
 * }
 * 
 * @param request - The incoming HTTP request from Dodo
 * @returns A JSON response indicating success or failure
 */
export async function POST(request: NextRequest) {
  // ===========================================================================
  // STEP 1: SECURITY CHECK - Verify webhook signature
  // ===========================================================================
  // This is CRITICAL for security. Without this check, anyone could send
  // fake webhooks to your server and modify user subscriptions!
  // 
  // The webhook signature is a cryptographic hash that only Dodo can create
  // using the shared webhook secret. If the signature doesn't match,
  // we reject the request immediately.
  // ===========================================================================

  // Check if the webhook secret is configured (fail-safe for development)
  if (!DODO_WEBHOOK_SECRET) {
    console.error("DODO_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  // Extract the signature headers from Dodo's request
  // These headers are added by Dodo to authenticate the webhook
  const webhookId = request.headers.get("webhook-id");
  const webhookSignature = request.headers.get("webhook-signature");
  const webhookTimestamp = request.headers.get("webhook-timestamp");

  // Validate that all required headers are present
  if (!webhookId || !webhookSignature || !webhookTimestamp) {
    return NextResponse.json({ error: "Missing webhook headers" }, { status: 400 });
  }

  // Get the raw request body as text
  // We need the exact raw text to verify the signature
  const rawBody = await request.text();

  try {
    // Create a webhook verifier using the standardwebhooks library
    const webhook = new Webhook(DODO_WEBHOOK_SECRET);

    // Verify the signature against the raw body and headers
    // This will throw an error if the signature is invalid
    await webhook.verify(rawBody, {
      "webhook-id": webhookId,
      "webhook-signature": webhookSignature,
      "webhook-timestamp": webhookTimestamp,
    });
  } catch (error) {
    // Signature verification failed - could be a fake webhook or tampered data
    console.error("Webhook signature verification failed:", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ===========================================================================
  // STEP 2: PARSE PAYLOAD & EXTRACT EVENT INFO
  // ===========================================================================
  // Now that we've verified the webhook is authentic, parse the JSON body
  // The payload contains information about what happened at Dodo
  // ===========================================================================

  const payload = JSON.parse(rawBody);
  const eventType = payload.type;  // e.g., "subscription.active", "payment.success"

  // Initialize the Supabase admin client
  // Admin client bypasses RLS (Row Level Security) for server-side operations
  const supabase = getSupabaseAdminClient();

  // ===========================================================================
  // STEP 3: IDEMPOTENCY CHECK - Prevent duplicate processing
  // ===========================================================================
  // Webhooks might be sent multiple times due to network issues or retries.
  // We use a unique constraint on (provider, provider_event_id) in the database
  // to ensure atomic idempotency.
  //
  // APPROACH:
  // 1. Try to insert the webhook log entry first (atomic with unique constraint)
  // 2. If insert fails due to unique constraint, another request is handling this webhook
  // 3. Check the existing record's processed status
  // 4. If already processed, return success (idempotent behavior)
  // 5. If not processed, return 200 to acknowledge receipt (the other request will handle it)
  //
  // This eliminates the race condition between check-then-insert.
  // ===========================================================================

  // Try to insert the webhook log entry first
  // This will fail with a unique constraint violation if another request is handling this webhook
  const { data: logEntry, error: logError } = await supabase
    .from("webhook_event_log")
    .insert({
      provider: "dodo",                           // Dodo payment provider
      event_type: eventType,                      // What type of event
      provider_event_id: webhookId,               // Dodo's unique webhook ID from header
      payload: payload,                           // Full payload for debugging
      processed: false,                           // Not processed yet
      received_at: new Date().toISOString(),      // When we received it
    })
    .select("id")
    .single();

  if (logError) {
    // Check if this is a unique constraint violation (duplicate webhook)
    if (logError.code === '23505' || logError.message?.includes('unique')) {
      // Unique constraint violation - another request is handling this webhook
      // Fetch the existing record to check its processed status
      const { data: existingWebhook } = await supabase
        .from("webhook_event_log")
        .select("id, processed")
        .eq("provider_event_id", webhookId)
        .eq("provider", "dodo")
        .single();

      if (existingWebhook?.processed) {
        // Already processed by a previous request - idempotent response
        return NextResponse.json({ received: true, status: "already_processed" }, { status: 200 });
      }

      // Not processed yet - another request is currently processing it
      // Return 200 to acknowledge receipt (the other request will complete processing)
      return NextResponse.json({ received: true, status: "in_progress" }, { status: 200 });
    }

    // Some other error occurred - this is a hard error, return 500
    console.error("Failed to log webhook:", logError);
    return NextResponse.json({ error: "Logging failed" }, { status: 500 });
  }

  try {
    // This object tracks what actions we took during processing
    // It's stored in the log for debugging purposes
    let processingDetails: Record<string, unknown> = {};

    // ===========================================================================
    // STEP 4: PROCESS THE SPECIFIC EVENT TYPE
    // ===========================================================================
    // Now we handle the actual business logic based on what type of event occurred.
    // Each case handles a different scenario in the subscription lifecycle.
    // ===========================================================================

    switch (eventType) {

      case "subscription.active":
      case "subscription.plan_changed": {
        // These events update subscription metadata but do NOT reset allowance.
        // Allowance resets only on renewal (new billing cycle) to avoid
        // unintended resets during plan changes or activation events.
        const data = payload.data;
        const dodoEventTimestamp = payload.timestamp; // May be undefined for .updated

        const clerkUserId = data.customer?.metadata?.clerk_user_id;
        const productId = data.product_id;
        const subscriptionId = data.subscription_id;

        if (!clerkUserId) {
          throw new Error('Missing clerk_user_id in customer metadata');
        }

        const isDuplicateWebhookTimestamp = await hasMatchingDodoWebhookTimestamp(
          supabase,
          subscriptionId,
          dodoEventTimestamp
        );

        if (isDuplicateWebhookTimestamp) {
          return NextResponse.json({ received: true, status: "skipped_duplicate" }, { status: 200 });
        }

        const { planId } = await updateSubscription(
          supabase,
          clerkUserId,
          productId,
          subscriptionId,
          {
            status: data.status, // Use status from payload
            created_at: data.created_at,
            next_billing_date: data.next_billing_date,
            payment_frequency_interval: data.payment_frequency_interval,
            trial_period_days: data.trial_period_days,
            recurring_pre_tax_amount: data.recurring_pre_tax_amount,
            currency: data.currency,
            cancel_at_next_billing_date: data.cancel_at_next_billing_date,
            customer: data.customer,
            canceled_at: data.cancelled_at,
          },
          dodoEventTimestamp
        );

        processingDetails = {
          action: eventType === 'subscription.active' ? 'subscription_activated' :
                  'subscription_plan_changed',
          clerk_user_id: clerkUserId,
          plan_id: planId,
          subscription_id: subscriptionId,
        };
        break;
      }

      case "subscription.renewed": {
        // Renewal represents a new billing cycle - this is the appropriate time
        // to reset the user's allowance to the full plan amount.
        // Dodo sends it in case of new subscription, subscription renewal, plan change.
        // kinda general event for critical allowance level change.
        const data = payload.data;
        const dodoEventTimestamp = payload.timestamp;

        const clerkUserId = data.customer?.metadata?.clerk_user_id;
        const productId = data.product_id;
        const subscriptionId = data.subscription_id;

        if (!clerkUserId) {
          throw new Error('Missing clerk_user_id in customer metadata');
        }

        // This doesn't have a timestamp check cause, it needs to update the allowance.
        // Also as we write the code we are learning that the 'provider updated at' is kind of our logic for 'allowance updated at'.
        // TODO: Take a look and consider.

        const { planId, allowance } = await upsertSubscriptionAndResetAllowance(
          supabase,
          clerkUserId,
          productId,
          subscriptionId,
          {
            status: data.status, // Use status from payload
            created_at: data.created_at,
            next_billing_date: data.next_billing_date,
            payment_frequency_interval: data.payment_frequency_interval,
            trial_period_days: data.trial_period_days,
            recurring_pre_tax_amount: data.recurring_pre_tax_amount,
            currency: data.currency,
            cancel_at_next_billing_date: data.cancel_at_next_billing_date,
            customer: data.customer,
            canceled_at: data.cancelled_at,
          },
          dodoEventTimestamp
        );

        processingDetails = {
          action: 'subscription_renewed',
          clerk_user_id: clerkUserId,
          plan_id: planId,
          subscription_id: subscriptionId,
          allowance: allowance,
        };
        break;
      }

      case "subscription.failed": {
        const data = payload.data;
        const dodoEventTimestamp = payload.timestamp;

        const clerkUserId = data.customer?.metadata?.clerk_user_id;
        const productId = data.product_id;
        const subscriptionId = data.subscription_id;

        if (!clerkUserId) {
          throw new Error('Missing clerk_user_id in customer metadata');
        }

        const isDuplicateWebhookTimestamp = await hasMatchingDodoWebhookTimestamp(
          supabase,
          subscriptionId,
          dodoEventTimestamp
        );

        if (isDuplicateWebhookTimestamp) {
          return NextResponse.json({ received: true, status: "skipped_duplicate" }, { status: 200 });
        }

        const { planId } = await updateSubscription(
          supabase,
          clerkUserId,
          productId,
          subscriptionId,
          {
            status: data.status, // Use status from payload
            created_at: data.created_at,
            next_billing_date: data.next_billing_date,
            payment_frequency_interval: data.payment_frequency_interval,
            trial_period_days: data.trial_period_days,
            recurring_pre_tax_amount: data.recurring_pre_tax_amount,
            currency: data.currency,
            cancel_at_next_billing_date: data.cancel_at_next_billing_date,
            customer: data.customer,
            canceled_at: data.cancelled_at,
          },
          dodoEventTimestamp
        );

        processingDetails = {
          action: 'subscription_failed',
          clerk_user_id: clerkUserId,
          plan_id: planId,
          subscription_id: subscriptionId,
        };
        break;
      }

      case "subscription.on_hold": {
        const data = payload.data;
        const dodoEventTimestamp = payload.timestamp;

        const clerkUserId = data.customer?.metadata?.clerk_user_id;
        const productId = data.product_id;
        const subscriptionId = data.subscription_id;

        if (!clerkUserId) {
          throw new Error('Missing clerk_user_id in customer metadata');
        }

        const isDuplicateWebhookTimestamp = await hasMatchingDodoWebhookTimestamp(
          supabase,
          subscriptionId,
          dodoEventTimestamp
        );

        if (isDuplicateWebhookTimestamp) {
          return NextResponse.json({ received: true, status: "skipped_duplicate" }, { status: 200 });
        }

        const { planId } = await updateSubscription(
          supabase,
          clerkUserId,
          productId,
          subscriptionId,
          {
            status: data.status, // Use status from payload
            created_at: data.created_at,
            next_billing_date: data.next_billing_date,
            payment_frequency_interval: data.payment_frequency_interval,
            trial_period_days: data.trial_period_days,
            recurring_pre_tax_amount: data.recurring_pre_tax_amount,
            currency: data.currency,
            cancel_at_next_billing_date: data.cancel_at_next_billing_date,
            customer: data.customer,
            canceled_at: data.cancelled_at,
          },
          dodoEventTimestamp
        );

        // Reset allowance to free plan
        await resetAllowanceToFreePlan(supabase, clerkUserId);

        processingDetails = {
          action: 'subscription_on_hold',
          clerk_user_id: clerkUserId,
          plan_id: planId,
          subscription_id: subscriptionId,
        };
        break;
      }

      case "subscription.updated": {
        const data = payload.data;
        const dodoEventTimestamp = payload.timestamp;

        const clerkUserId = data.customer?.metadata?.clerk_user_id;
        const productId = data.product_id;
        const subscriptionId = data.subscription_id;

        if (!clerkUserId) {
          throw new Error('Missing clerk_user_id in customer metadata');
        }

        const isDuplicateWebhookTimestamp = await hasMatchingDodoWebhookTimestamp(
          supabase,
          subscriptionId,
          dodoEventTimestamp
        );

        if (isDuplicateWebhookTimestamp) {
          return NextResponse.json({ received: true, status: "skipped_duplicate" }, { status: 200 });
        }

        const { planId } = await updateSubscription(
          supabase,
          clerkUserId,
          productId,
          subscriptionId,
          {
            status: data.status, // Use status from payload
            created_at: data.created_at,
            next_billing_date: data.next_billing_date,
            payment_frequency_interval: data.payment_frequency_interval,
            trial_period_days: data.trial_period_days,
            recurring_pre_tax_amount: data.recurring_pre_tax_amount,
            currency: data.currency,
            cancel_at_next_billing_date: data.cancel_at_next_billing_date,
            customer: data.customer,
            canceled_at: data.cancelled_at,
          },
          // dodoEventTimestamp // we will not save dodoEventTimestamp in case of updated. Cause it is very universal and doesn't give any purpose to ignore further
        );

        processingDetails = {
          action: 'subscription_updated',
          clerk_user_id: clerkUserId,
          plan_id: planId,
          subscription_id: subscriptionId,
        };
        break;
      }

      case "subscription.cancelled": {
        const data = payload.data;
        const dodoEventTimestamp = payload.timestamp;

        const clerkUserId = data.customer?.metadata?.clerk_user_id;
        const productId = data.product_id;
        const subscriptionId = data.subscription_id;
        const canceledAt = data.cancelled_at;

        if (!clerkUserId) {
          throw new Error('Missing clerk_user_id in customer metadata');
        }

        const isDuplicateWebhookTimestamp = await hasMatchingDodoWebhookTimestamp(
          supabase,
          subscriptionId,
          dodoEventTimestamp
        );

        if (isDuplicateWebhookTimestamp) {
          return NextResponse.json({ received: true, status: "skipped_duplicate" }, { status: 200 });
        }

        const { planId } = await updateSubscription(
          supabase,
          clerkUserId,
          productId,
          subscriptionId,
          {
            status: data.status, // Use status from payload
            created_at: data.created_at,
            next_billing_date: data.next_billing_date,
            payment_frequency_interval: data.payment_frequency_interval,
            trial_period_days: data.trial_period_days,
            recurring_pre_tax_amount: data.recurring_pre_tax_amount,
            currency: data.currency,
            cancel_at_next_billing_date: data.cancel_at_next_billing_date,
            customer: data.customer,
            canceled_at: data.cancelled_at,
          },
          dodoEventTimestamp
        );

        // Reset allowance to free plan
        await resetAllowanceToFreePlan(supabase, clerkUserId);

        processingDetails = {
          action: 'subscription_cancelled',
          clerk_user_id: clerkUserId,
          plan_id: planId,
          subscription_id: subscriptionId,
          canceled_at: canceledAt,
        };
        break;
      }

      // =======================================================================
      // DEFAULT: Unhandled event types
      // =======================================================================
      // If Dodo send event types we don't know or we don't handle, we log but don't error, cause we don't need all the event types
      default:
        processingDetails = { action: "unhandled" };
    }

    // ===========================================================================
    // STEP 6: MARK WEBHOOK AS PROCESSED
    // ===========================================================================
    // Update the log entry to show we've successfully processed this webhook
    // This ensures idempotency on future webhook deliveries
    // ===========================================================================

    await supabase
      .from("webhook_event_log")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        http_status: 200,
        processing_details: processingDetails,
      })
      .eq("id", logEntry.id);

    // Return 200 OK to Dodo to acknowledge receipt
    return NextResponse.json({ received: true }, { status: 200 });

  } catch (error) {
    // ===========================================================================
    // STEP 7: ERROR HANDLING
    // ===========================================================================
    // If anything goes wrong during processing, we:
    // 1. Log the error in the webhook_event_log
    // 2. Log to console for immediate visibility
    // 3. Return 500 to Dodo (they may retry the webhook)
    // ===========================================================================

    await supabase
      .from("webhook_event_log")
      .update({
        processed: false,
        http_status: 500,
        processing_details: {
          error: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
        },
      })
      .eq("id", logEntry.id);

    console.error("Webhook processing error:", error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
