import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { shareAttachmentRatelimit } from '@/lib/ratelimit';
import { resolveShareAttachment } from '@/lib/sharing/share-service';
import { UUID_REGEX } from '@/lib/uuid-utils';

const shareTokenSchema = z.string().min(12).max(32).regex(/^[A-Za-z0-9_-]+$/);

/**
 * GET /api/share/[token]/attachments/[fileId]
 * Public endpoint — resolves a file attachment for a shared conversation.
 * No auth required. Validates the file is referenced in an active share.
 * Returns a signed URL with short expiry.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; fileId: string }> }
) {
  try {
    // Rate limit by IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? 'unknown';
    const { success } = await shareAttachmentRatelimit.limit(ip);
    if (!success) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const { token, fileId } = await params;

    // Validate inputs
    if (!shareTokenSchema.safeParse(token).success) {
      return NextResponse.json({ error: 'Invalid share link' }, { status: 400 });
    }
    if (!UUID_REGEX.test(fileId)) {
      return NextResponse.json({ error: 'Invalid file ID' }, { status: 400 });
    }

    // Resolve file via share-scoped service
    const signedUrl = await resolveShareAttachment(fileId, token);

    return NextResponse.json({ url: signedUrl });
  } catch (error) {
    console.error('Error resolving share attachment:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('not found') || message.includes('denied') ? 404 : 500;
    return NextResponse.json(
      { error: status === 500 ? 'Internal server error' : message },
      { status }
    );
  }
}
