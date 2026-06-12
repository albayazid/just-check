import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { shareGetRatelimit } from '@/lib/ratelimit';
import { listSharesForConversation } from '@/lib/sharing/share-service';
import { UUID_REGEX } from '@/lib/uuid-utils';

/**
 * GET /api/conversations/[conversationId]/shares
 * Lists all shares for a conversation.
 * Auth required, verifies ownership.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await shareGetRatelimit.limit(clerkUserId);
    if (!success) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const { conversationId } = await params;

    if (!UUID_REGEX.test(conversationId)) {
      return NextResponse.json({ error: 'Invalid conversation ID format' }, { status: 400 });
    }

    const shares = await listSharesForConversation(conversationId, clerkUserId);

    return NextResponse.json({ shares });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error('Error listing shares:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
