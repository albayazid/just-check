import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import { clerkClient } from "@/lib/clerk/clerk-client";
import { DODO_API_KEY, DODO_API_URL, DODO_RETURN_URL } from "@/lib/dodo-utils.server";
import { getDodoProductId } from "@/lib/subscription-utils.server";
import { checkoutRatelimit } from "@/lib/ratelimit";
import { z } from "zod";

const checkoutPostSchema = z.object({
  productId: z.string().min(1),
});

interface DODOCustomer {
  customer_id: string;
  email: string;
  name: string;
  metadata?: Record<string, unknown>;
}

/**
 * Gets or creates a DODO customer for the authenticated Clerk user.
 * Checks for existing mapping in database, creates new DODO customer if needed,
 * and stores the clerk_id â†” dodo_customer_id mapping.
 */
async function getOrCreateDODOCustomer(clerkUserId: string): Promise<string> {
  const supabase = getSupabaseAdminClient();

  // Check if mapping already exists
  const { data: existingMapping, error: mappingError } = await supabase
    .from("dodo_customer_mapping")
    .select("dodo_customer_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (mappingError) {
    console.error("Error checking customer mapping:", mappingError);
    throw new Error("Database error checking customer mapping");
  }

  // Return existing customer ID
  if (existingMapping) {
    return existingMapping.dodo_customer_id;
  }

  // Get user details from Clerk
  let clerkUser;
  try {
    clerkUser = await clerkClient.users.getUser(clerkUserId);
  } catch (clerkError) {
    console.error("Error fetching user from Clerk:", clerkError);
    throw new Error("User not found in Clerk");
  }

  // Extract email and name from Clerk user
  const email = clerkUser.emailAddresses[0]?.emailAddress;
  const name = clerkUser.fullName || clerkUser.firstName || clerkUser.username || "User";

  if (!email) {
    throw new Error("User email not found");
  }

  // Create new DODO customer
  let dodoCustomer: DODOCustomer;
  try {
    const response = await fetch(`${DODO_API_URL}/customers`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DODO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        name,
        metadata: {
          clerk_user_id: clerkUserId,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DODO API error:", errorText);
      throw new Error(`Failed to create DODO customer: ${errorText}`);
    }

    dodoCustomer = await response.json();
  } catch (dodoError) {
    console.error("Error calling DODO API:", dodoError);
    throw new Error("Failed to connect to DODO API");
  }

  // Store mapping in database
  const { error: insertError } = await supabase
    .from("dodo_customer_mapping")
    .insert({
      clerk_user_id: clerkUserId,
      dodo_customer_id: dodoCustomer.customer_id,
    });

  if (insertError) {
    console.error("Error storing customer mapping:", insertError);
    // Note: Customer was created in DODO but mapping failed
    // This is a data inconsistency that should be monitored
    throw new Error(`Failed to store customer mapping: ${insertError.message}`);
  }

  return dodoCustomer.customer_id;
}

/**
 * Creates a DODO checkout session with automatic customer association
 * 
 * Query Parameters:
 * - productId: DODO product ID to purchase
 * 
 * The customer ID is automatically retrieved or created based on the authenticated Clerk user.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Apply rate limiting
    const { success } = await checkoutRatelimit.limit(clerkUserId);
    if (!success) {
      return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
    }

    // Check if user already has an active subscription
    const supabase = getSupabaseAdminClient();
    const { data: existingSubscription } = await supabase
      .rpc('get_user_subscription', { p_clerk_user_id: clerkUserId });

    if (existingSubscription && existingSubscription.length > 0) {
      return NextResponse.json(
        {
          error: 'Active subscription exists',
          message: 'You already have an active subscription. Use the upgrade endpoint to change plans.',
          currentPlan: existingSubscription[0].plan_id
        },
        { status: 409 } // 409 Conflict
      );
    }

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");

    if (!productId) {
      return NextResponse.json(
        { error: "productId is required" },
        { status: 400 }
      );
    }

    const dodoProductId = getDodoProductId(productId);
    if (!dodoProductId) {
      return NextResponse.json(
        { error: "Invalid product ID" },
        { status: 400 }
      );
    }

    // Get or create DODO customer automatically
    const customerId = await getOrCreateDODOCustomer(clerkUserId);

    // Build checkout payload with customer association
    const payload = {
      product_cart: [{ product_id: dodoProductId, quantity: 1 }],
      return_url: DODO_RETURN_URL,
      customer: { customer_id: customerId },
    };

    // Call DODO API to create checkout session
    const response = await fetch(`${DODO_API_URL}/checkouts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DODO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DODO checkout error:", errorText);
      return NextResponse.json(
        { error: "Failed to create checkout session", details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      checkout_url: data.checkout_url,
      session_id: data.session_id,
    });

  } catch (error) {
    console.error("Checkout error:", error);
    // Return generic error to client, log details server-side
    const message = error instanceof Error && error.message === "Unauthorized"
      ? error.message
      : "Checkout failed. Please try again.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

/**
 * Dynamic checkout with full payload control
 * Customer ID is automatically retrieved or created based on the authenticated Clerk user.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Apply rate limiting
    const { success } = await checkoutRatelimit.limit(clerkUserId);
    if (!success) {
      return NextResponse.json({ error: "Too many requests. Please wait a moment." }, { status: 429 });
    }

    const parsed = checkoutPostSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 }
      );
    }
    const { productId } = parsed.data;

    const dodoProductId = getDodoProductId(productId);
    if (!dodoProductId) {
      return NextResponse.json(
        { error: "Invalid product ID" },
        { status: 400 }
      );
    }

    // Get or create DODO customer automatically
    const customerId = await getOrCreateDODOCustomer(clerkUserId);

    const payload = {
      product_cart: [{ product_id: dodoProductId, quantity: 1 }],
      return_url: DODO_RETURN_URL,
      customer: { customer_id: customerId },
    };

    const response = await fetch(`${DODO_API_URL}/checkouts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DODO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("DODO checkout error:", errorText);
      return NextResponse.json(
        { error: "Failed to create checkout session", details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      checkout_url: data.checkout_url,
      session_id: data.session_id,
    });

  } catch (error) {
    console.error("Checkout error:", error);
    // Return generic error to client, log details server-side
    const message = error instanceof Error && error.message === "Unauthorized"
      ? error.message
      : "Checkout failed. Please try again.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
