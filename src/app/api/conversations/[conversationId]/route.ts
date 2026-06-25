import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import { ensureConversationNotTemporary } from '@/lib/chat-history';
import { z } from 'zod';

const paramsSchema = z.object({
  conversationId: z.string().uuid(),
});

const renameBodySchema = z.object({
  title: z.string().trim().min(1),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { conversationId } = paramsSchema.parse(await params);
    const supabase = getSupabaseAdminClient();

    const { data, error } = await supabase
      .from('conversations')
      .select('title, pinned_at, archived_at')
      .eq('id', conversationId)
      .eq('clerk_user_id', clerkUserId)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json({
      title: data.title,
      pinned_at: data.pinned_at,
      archived_at: data.archived_at,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid conversation ID format', details: error.issues.map(i => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    console.error('Error fetching conversation:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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

    const { conversationId } = paramsSchema.parse(await params);

    const parsed = renameBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    const { title } = parsed.data;

    const supabase = getSupabaseAdminClient();

    await ensureConversationNotTemporary(conversationId, clerkUserId);

    // Update conversation title
    const { error } = await supabase
      .from('conversations')
      .update({ title })
      .eq('id', conversationId)
      .eq('clerk_user_id', clerkUserId);

    if (error) {
      throw new Error(`Failed to rename conversation: ${error.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid conversation ID format', details: error.issues.map(i => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    console.error('Error renaming conversation:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const isNotFound = message === 'Conversation not found' || message === 'Temporary conversations cannot be organized';
    const status = isNotFound ? 404 : 500;
    return NextResponse.json(
      { error: status === 404 ? 'Conversation not found' : 'Internal server error' },
      { status }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { conversationId } = paramsSchema.parse(await params);

    const supabase = getSupabaseAdminClient();

    // Soft delete - update deleted_at timestamp
    const { error } = await supabase
      .from('conversations')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('clerk_user_id', clerkUserId);

    if (error) {
      throw new Error(`Failed to delete conversation: ${error.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid conversation ID format', details: error.issues.map(i => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    console.error('Error deleting conversation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
