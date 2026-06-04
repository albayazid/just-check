import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { resolveAttachmentUrlForConversation } from '@/lib/storage/file-storage-service';
import { attachmentResolveRatelimit } from '@/lib/ratelimit';
import { UUID_REGEX } from '@/lib/uuid-utils';

/**
 * POST /api/attachments/resolve
 * 
 * Resolves an attachment:// URL to a fresh signed URL.
 * This is needed for client-side display of uploaded images.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await attachmentResolveRatelimit.limit(clerkUserId);
    if (!success) {
      return NextResponse.json({ error: 'Too many requests. Please wait.' }, { status: 429 });
    }

    const { fileId, conversationId } = await req.json();

    if (!fileId || typeof fileId !== 'string' || !UUID_REGEX.test(fileId)) {
      return NextResponse.json({ error: 'Invalid or missing file ID' }, { status: 400 });
    }

    if (!conversationId || typeof conversationId !== 'string' || !UUID_REGEX.test(conversationId)) {
      return NextResponse.json({ error: 'Invalid or missing conversation ID' }, { status: 400 });
    }

    // Resolve the attachment URL scoped to conversation access
    const resolvedUrl = await resolveAttachmentUrlForConversation(fileId, clerkUserId, conversationId);

    return NextResponse.json({ url: resolvedUrl });
  } catch (error) {
    console.error('Error resolving attachment URL:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve attachment' },
      { status: 500 }
    );
  }
}
