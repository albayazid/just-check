import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { DODO_API_KEY, DODO_API_URL } from '@/lib/dodo-utils.server';
import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import { subscriptionRatelimit } from '@/lib/ratelimit';
import { getDodoProductId } from '@/lib/subscription-utils.server';

/**
 * POST /api/subscription/update
 * Updates user's subscription to a new plan with automatic proration
 *
 * Business Logic:
 * 1. Call Dodo's change-plan API with prorated_immediately mode
 * 2. Dodo automatically calculates the fair charge based on unused time
 * 3. Return subscription data from Dodo (no custom credit logic)
 *
 * @param request - NextRequest with { productId: string } in body
 * @returns JSON with success, subscription data, currency
 */
export async function POST(request: NextRequest) {
  try {
    // 1. AUTHENTICATION: Get authenticated user from Clerk
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await subscriptionRatelimit.limit(clerkUserId);
    if (!success) {
      return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
    }

    // 2. VALIDATE REQUEST: Get productId from request body
    const body = await request.json();
    const { productId } = body;

    if (!productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    }

    const dodoProductId = getDodoProductId(productId);
    if (!dodoProductId) {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    // 3. FETCH CURRENT SUBSCRIPTION
    const { data: subscriptions, error: subError } = await supabase
      .rpc('get_user_subscription', { p_clerk_user_id: clerkUserId });

    // The RPC returns an array, not a single object. So subscription is [] (empty array) or [{...}]
    const subscription = Array.isArray(subscriptions) ? subscriptions[0] : subscriptions;

    if (subError || !subscription) {
      return NextResponse.json({ 
        error: 'No active subscription found',
        message: 'You need an active subscription to upgrade. Please subscribe first.'
      }, { status: 403 });
    }

    if (!subscription.dodo_subscription_id) {
      return NextResponse.json({ error: 'Subscription ID not found' }, { status: 400 });
    }

    if (!subscription.dodo_customer_id) {
      return NextResponse.json({ error: 'Customer ID not found' }, { status: 400 });
    }

    // 4. CHANGE PLAN: Call DODO API with prorated_immediately for automatic proration
    // prorated_immediately = Dodo automatically calculates fair charge based on unused time
    // on_payment_failure: prevent_change = only change if payment succeeds
    const response = await fetch(`${DODO_API_URL}/subscriptions/${subscription.dodo_subscription_id}/change-plan`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DODO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_id: dodoProductId,
        quantity: 1,
        proration_billing_mode: 'prorated_immediately',
        on_payment_failure: 'prevent_change',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DODO update subscription error:', errorText);
      return NextResponse.json(
        { error: 'Failed to update subscription', details: errorText },
        { status: response.status }
      );
    }

    // 5. RETURN SUCCESS: change-plan returns an empty body, so we only signal
    // success/error here. The new plan is confirmed by the subscription webhook.
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error updating subscription:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
