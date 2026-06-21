import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import {
  shareCreateRatelimit,
  shareGetRatelimit,
  shareRevokeRatelimit,
} from '@/lib/ratelimit';
import {
  createShareSnapshot,
  refreshShare,
  getShareForConversation,
  revokeShare,
} from '@/lib/sharing/share-service';
import { UUID_REGEX } from '@/lib/uuid-utils';

/**
 * /api/conversations/[conversationId]/share — the single active share (auth required).
 *   GET → share | null · POST → create/replace · PATCH → resync · DELETE → revoke
 */

const configBodySchema = z.object({
  shareMode: z.enum(['entire', 'latest_thread', 'visible_thread']),
  currentLeafMessageId: z.string().uuid().optional(),
});

/** Validates that visible_thread mode carries a leaf message id. */
function requireLeafIfVisible(
  body: z.infer<typeof configBodySchema>
): NextResponse | null {
  if (body.shareMode === 'visible_thread' && !body.currentLeafMessageId) {
    return NextResponse.json(
      { error: 'currentLeafMessageId is required for visible_thread mode' },
      { status: 400 }
    );
  }
  return null;
}

export async function GET(
  _req: NextRequest,
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

    const share = await getShareForConversation(conversationId, clerkUserId);
    return NextResponse.json({ share });
  } catch (error) {
    console.error('Error fetching share:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await shareCreateRatelimit.limit(clerkUserId);
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

    const parsed = configBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }

    const leafError = requireLeafIfVisible(parsed.data);
    if (leafError) return leafError;

    const result = await createShareSnapshot({
      clerkUserId,
      input: { conversationId, ...parsed.data },
    });

    // 201 when a new share row was created; 200 when an existing active share
    // was reused (re-frozen with the same token).
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error('Error creating share:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('not found') ? 404
      : message.includes('Temporary') ? 400
      : message.includes('No messages') ? 400
      : 500;
    return NextResponse.json(
      { error: status === 500 ? 'Internal server error' : message },
      { status }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await shareCreateRatelimit.limit(clerkUserId);
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

    const parsed = configBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }

    const leafError = requireLeafIfVisible(parsed.data);
    if (leafError) return leafError;

    const result = await refreshShare({ conversationId, clerkUserId, input: parsed.data });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('Error resyncing share:', error);
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await shareRevokeRatelimit.limit(clerkUserId);
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

    await revokeShare(conversationId, clerkUserId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error revoking share:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
