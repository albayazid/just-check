import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { shareCreateRatelimit } from '@/lib/ratelimit';
import { createShareSnapshot } from '@/lib/sharing/share-service';

const createShareSchema = z.object({
  conversationId: z.string().uuid(),
  shareMode: z.enum(['entire', 'latest_thread', 'visible_thread']),
  showOwnerName: z.boolean(),
  currentLeafMessageId: z.string().uuid().optional(),
  expiresInHours: z.number().int().min(1).max(8760).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await shareCreateRatelimit.limit(clerkUserId);
    if (!success) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    const parsed = createShareSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }

    // Validate that currentLeafMessageId is provided for visible_thread mode
    if (parsed.data.shareMode === 'visible_thread' && !parsed.data.currentLeafMessageId) {
      return NextResponse.json(
        { error: 'currentLeafMessageId is required for visible_thread mode' },
        { status: 400 }
      );
    }

    const result = await createShareSnapshot({
      clerkUserId,
      input: parsed.data,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Error creating share:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('not found') ? 404
      : message.includes('Temporary') ? 400
      : message.includes('empty') ? 400
      : 500;
    return NextResponse.json(
      { error: status === 500 ? 'Internal server error' : message },
      { status }
    );
  }
}
