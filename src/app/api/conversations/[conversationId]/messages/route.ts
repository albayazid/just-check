import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getMessagesForConversation, type AssistantResponseMetadata } from '@/lib/conversation-history';
import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import { UUID_REGEX } from '@/lib/uuid-utils';
import type { ClientMessageMetadata } from '@/lib/conversation-history/types';

/**
 * Filters server-side metadata to only include client-safe fields.
 * Converts AssistantResponseMetadata to ClientMessageMetadata.
 */
function filterClientMetadata(meta: AssistantResponseMetadata | undefined): ClientMessageMetadata {
    if (!meta) return {};

    return {
        model_data: meta.model_data ? { UIModelId: meta.model_data.UIModelId } : undefined,
    };
}

/**
 * GET /api/conversations/[conversationId]/messages
 * 
 * Retrieves all messages for a specific conversation, ordered by sequence.
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

        const { conversationId } = await params;

        // 1. Validate UUID format
        if (!UUID_REGEX.test(conversationId)) {
            return NextResponse.json({ error: 'Invalid conversation ID format' }, { status: 400 });
        }

        // 2. Verify ownership/existence first
        const supabase = getSupabaseAdminClient();
        const { data: conversation, error: convError } = await supabase
            .from('conversations')
            .select('id')
            .eq('id', conversationId)
            .eq('clerk_user_id', clerkUserId)
            .eq('is_temporary', false)
            .is('deleted_at', null)
            .single();

        if (convError || !conversation) {
            return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
        }

        // 3. Fetch raw messages
        const rawMessages = await getMessagesForConversation(conversationId);

        // 4. Filter out orphan messages (whose previous_message_id points to a non-existent message)
        const existingIds = new Set(rawMessages.map(m => m.id));
        const messages = rawMessages.filter(
            m => m.previous_message_id === null || existingIds.has(m.previous_message_id)
        );

        // 5. Map StoredMessage to format suitable for useChat's initialMessages
        // Include previous_message_id in metadata so the client can reconstruct
        // the conversation tree for branching support.
        const uiMessages = messages.map(msg => ({
            id: msg.id,
            role: msg.sender_type,
            parts: msg.content,
            metadata: {
                ...filterClientMetadata(msg.metadata as AssistantResponseMetadata | undefined),
                previous_message_id: msg.previous_message_id,
            },
            createdAt: msg.created_at ? new Date(msg.created_at) : undefined,
        }));

        // Keep attachment:// URLs stable in the chat state. Renderers resolve them
        // lazily for display; sending signed URLs back to /api/chat loses the file ID.
        return NextResponse.json({ messages: uiMessages });
    } catch (error) {
        console.error('Error fetching messages:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
