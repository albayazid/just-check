import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { shareForkRatelimit } from '@/lib/ratelimit';
import { forkConversation } from '@/lib/chat-history/conversations';
import { UUID_REGEX } from '@/lib/uuid-utils';

/**
 * POST /api/conversations/[conversationId]/fork
 * Forks one of the user's own conversations into a standalone copy. Auth required.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await shareForkRatelimit.limit(clerkUserId);
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

    const result = await forkConversation(conversationId, clerkUserId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Error forking conversation:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('not found') ? 404
      : message.includes('No messages') ? 400
      : 500;
    return NextResponse.json(
      { error: status === 500 ? 'Internal server error' : message },
      { status }
    );
  }
}
