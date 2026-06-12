import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { shareForkRatelimit } from '@/lib/ratelimit';
import { forkSharedConversation } from '@/lib/sharing/share-service';

const shareTokenSchema = z.string().min(12).max(32).regex(/^[A-Za-z0-9_-]+$/);

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await shareForkRatelimit.limit(clerkUserId);
    if (!success) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    const { token } = await params;
    const parsed = shareTokenSchema.safeParse(token);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid share link' }, { status: 400 });
    }
    const result = await forkSharedConversation(token, clerkUserId);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid share token' },
        { status: 400 }
      );
    }
    console.error('Error forking share:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('not found') || message.includes('no longer available') ? 404 : 500;
    return NextResponse.json(
      { error: status === 500 ? 'Internal server error' : message },
      { status }
    );
  }
}
