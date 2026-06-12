import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { shareViewRatelimit } from '@/lib/ratelimit';
import { getPublicShare } from '@/lib/sharing/share-service';

const shareTokenSchema = z.string().min(12).max(32).regex(/^[A-Za-z0-9_-]+$/);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    // Public endpoint — no auth required
    // Rate limit by IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? 'unknown';
    const { success } = await shareViewRatelimit.limit(ip);
    if (!success) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }

    const { token } = await params;
    const parsed = shareTokenSchema.safeParse(token);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid share link' }, { status: 400 });
    }
    const share = await getPublicShare(token);

    if (!share) {
      return NextResponse.json(
        { error: 'This shared conversation is no longer available.' },
        { status: 404 }
      );
    }

    return NextResponse.json(share);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid share token' },
        { status: 400 }
      );
    }
    console.error('Error fetching public share:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
