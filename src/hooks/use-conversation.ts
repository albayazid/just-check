import { useQuery } from '@tanstack/react-query';

interface ConversationData {
  title: string | null;
  pinned_at: string | null;
  archived_at: string | null;
}

async function fetchConversation(conversationId: string): Promise<ConversationData> {
  const response = await fetch(`/api/conversations/${conversationId}`);
  if (!response.ok) throw new Error('Failed to fetch conversation');
  return response.json();
}

export function useConversation(conversationId: string) {
  return useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => fetchConversation(conversationId),
    enabled: !!conversationId,
  });
}
