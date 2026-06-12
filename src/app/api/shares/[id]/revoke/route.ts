import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { shareRevokeRatelimit } from '@/lib/ratelimit';
import { revokeShare } from '@/lib/sharing/share-service';

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await shareRevokeRatelimit.limit(clerkUserId);
    if (!success) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    const { id } = paramsSchema.parse(await params);
    await revokeShare(id, clerkUserId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid share ID format', details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    console.error('Error revoking share:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
