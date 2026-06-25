import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import type { InfiniteData } from '@tanstack/react-query';
import type { ListConversationsResult, StoredConversation } from '@/lib/chat-history';
import type { ConversationData } from './use-conversation';

// ============================================================================
// FETCH (List)
// ============================================================================

async function fetchConversations({ pageParam }: { pageParam: string | null }): Promise<ListConversationsResult> {
  const url = pageParam
    ? `/api/conversations/list?view=regular&limit=20&cursor=${encodeURIComponent(pageParam)}`
    : '/api/conversations/list?view=regular&limit=20';

  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch conversations');
  return response.json();
}

export function useConversations() {
  return useInfiniteQuery({
    queryKey: ['conversations', 'regular'],
    queryFn: fetchConversations,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
  });
}

// ============================================================================
// FETCH PINNED
// ============================================================================

async function fetchPinnedConversations({ pageParam }: { pageParam: string | null }): Promise<ListConversationsResult> {
  const url = pageParam
    ? `/api/conversations/list?view=pinned&limit=20&cursor=${encodeURIComponent(pageParam)}`
    : '/api/conversations/list?view=pinned&limit=20';

  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch pinned conversations');
  return response.json();
}

export function usePinnedConversations() {
  return useInfiniteQuery({
    queryKey: ['conversations', 'pinned'],
    queryFn: fetchPinnedConversations,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
  });
}

// ============================================================================
// FETCH ARCHIVED
// ============================================================================

async function fetchArchivedConversations({ pageParam }: { pageParam: string | null }): Promise<ListConversationsResult> {
  const url = pageParam
    ? `/api/conversations/list?view=archived&limit=20&cursor=${encodeURIComponent(pageParam)}`
    : '/api/conversations/list?view=archived&limit=20';

  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch archived conversations');
  return response.json();
}

export function useArchivedConversations() {
  return useInfiniteQuery({
    queryKey: ['conversations', 'archived'],
    queryFn: fetchArchivedConversations,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
  });
}

// ============================================================================
// FETCH BY FOLDER
// ============================================================================

async function fetchConversationsInFolder(
  folderId: string,
  { pageParam }: { pageParam: string | null }
): Promise<ListConversationsResult> {
  const url = pageParam
    ? `/api/conversations/list?folder_id=${folderId}&limit=20&cursor=${encodeURIComponent(pageParam)}`
    : `/api/conversations/list?folder_id=${folderId}&limit=20`;

  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch folder conversations');
  return response.json();
}

export function useConversationsInFolder(folderId: string) {
  return useInfiniteQuery({
    queryKey: ['conversations', 'folder', folderId],
    queryFn: (context) => fetchConversationsInFolder(folderId, context),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    enabled: !!folderId,
  });
}

// ============================================================================
// CREATE
// ============================================================================

interface CreateConversationResponse {
  id: string;
}

interface CreateConversationParams {
  title?: string;
  isTemporary?: boolean;
}

async function createConversation(params?: CreateConversationParams): Promise<CreateConversationResponse> {
  const response = await fetch('/api/conversations/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: params?.title,
      isTemporary: params?.isTemporary === true,
    }),
  });
  if (!response.ok) throw new Error('Failed to create conversation');
  return response.json();
}

export function useCreateConversation() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params?: CreateConversationParams) => createConversation(params),
    onSuccess: (data, variables) => {
      if (!variables?.isTemporary) {
        // Invalidate conversations list to include new conversation
        queryClient.invalidateQueries({ queryKey: ['conversations', 'regular'] });
      }
      // Navigate to new conversation
      router.push(`/chats/${data.id}`);
    },
  });
}

// ============================================================================
// DELETE
// ============================================================================

async function deleteConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete conversation');
}

export function useDeleteConversation() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteConversation,
    onMutate: async (conversationId) => {
      const regularKey = ['conversations', 'regular'] as const;
      const pinnedKey = ['conversations', 'pinned'] as const;

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: regularKey });
      await queryClient.cancelQueries({ queryKey: pinnedKey });

      // Snapshot previous values
      const previousRegular = queryClient.getQueryData<InfiniteData<ListConversationsResult>>(regularKey);
      const previousPinned = queryClient.getQueryData<InfiniteData<ListConversationsResult>>(pinnedKey);

      // Optimistically update: remove from both caches
      const removeFromCache = (old: InfiniteData<ListConversationsResult> | undefined) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            conversations: page.conversations.filter((c) => c.id !== conversationId),
          })),
        };
      };

      queryClient.setQueryData<InfiniteData<ListConversationsResult>>(regularKey, removeFromCache);
      queryClient.setQueryData<InfiniteData<ListConversationsResult>>(pinnedKey, removeFromCache);

      // Return context with previous data for rollback
      return { previousRegular, previousPinned };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousRegular) {
        queryClient.setQueryData(['conversations', 'regular'], context.previousRegular);
      }
      if (context?.previousPinned) {
        queryClient.setQueryData(['conversations', 'pinned'], context.previousPinned);
      }
    },
    onSettled: () => {
      // Refetch to ensure server state
      queryClient.invalidateQueries({ queryKey: ['conversations', 'regular'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', 'pinned'] });
    },
    onSuccess: (_, conversationId) => {
      // Drop cached detail/messages so navigating back never shows stale data
      queryClient.removeQueries({ queryKey: ['conversation', conversationId] });
      queryClient.removeQueries({ queryKey: ['messages', conversationId] });
      // Navigate home if deleted conversation was active
      if (pathname === `/chats/${conversationId}`) {
        router.push('/');
      }
    },
  })
}

// ============================================================================
// RENAME
// ============================================================================

interface RenameConversationParams {
  conversationId: string;
  newTitle: string;
}

async function renameConversation({ conversationId, newTitle }: RenameConversationParams): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: newTitle }),
  });
  if (!response.ok) throw new Error('Failed to rename conversation');
}

export function useRenameConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: renameConversation,
    onMutate: async ({ conversationId, newTitle }) => {
      const regularKey = ['conversations', 'regular'] as const;
      const pinnedKey = ['conversations', 'pinned'] as const;

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: regularKey });
      await queryClient.cancelQueries({ queryKey: pinnedKey });

      // Snapshot previous values
      const previousRegular = queryClient.getQueryData<InfiniteData<ListConversationsResult>>(regularKey);
      const previousPinned = queryClient.getQueryData<InfiniteData<ListConversationsResult>>(pinnedKey);

      // Optimistically update: rename in both caches
      const renameInCache = (old: InfiniteData<ListConversationsResult> | undefined) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            conversations: page.conversations.map((c) =>
              c.id === conversationId ? { ...c, title: newTitle } : c
            ),
          })),
        };
      };

      queryClient.setQueryData<InfiniteData<ListConversationsResult>>(regularKey, renameInCache);
      queryClient.setQueryData<InfiniteData<ListConversationsResult>>(pinnedKey, renameInCache);

      // Optimistically update the single-conversation cache consumed by the chat
      // header so the title flips instantly instead of waiting for a refetch.
      const singleKey = ['conversation', conversationId] as const;
      const previousSingle = queryClient.getQueryData<ConversationData>(singleKey);
      queryClient.setQueryData<ConversationData>(singleKey, (old) =>
        old ? { ...old, title: newTitle } : old
      );

      // Return context with previous data for rollback
      return { previousRegular, previousPinned, previousSingle };
    },
    onError: (_err, variables, context) => {
      // Rollback on error
      if (context?.previousRegular) {
        queryClient.setQueryData(['conversations', 'regular'], context.previousRegular);
      }
      if (context?.previousPinned) {
        queryClient.setQueryData(['conversations', 'pinned'], context.previousPinned);
      }
      if (context?.previousSingle) {
        queryClient.setQueryData(['conversation', variables.conversationId], context.previousSingle);
      }
    },
    onSettled: (_data, _error, variables) => {
      // Refetch to ensure server state
      queryClient.invalidateQueries({ queryKey: ['conversations', 'regular'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', 'pinned'] });
      queryClient.invalidateQueries({ queryKey: ['conversation', variables.conversationId] });
    },
  });
}

// ============================================================================
// PIN
// ============================================================================

async function pinConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}/pin`, {
    method: 'POST',
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to pin conversation');
  }
}

async function unpinConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}/pin`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to unpin conversation');
}

export function usePinConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, pinned }: { conversationId: string; pinned: boolean }) =>
      pinned ? pinConversation(conversationId) : unpinConversation(conversationId),
    onMutate: async ({ conversationId, pinned }) => {
      const regularKey = ['conversations', 'regular'] as const;
      const pinnedKey = ['conversations', 'pinned'] as const;

      await queryClient.cancelQueries({ queryKey: regularKey });
      await queryClient.cancelQueries({ queryKey: pinnedKey });

      const previousRegular = queryClient.getQueryData<InfiniteData<ListConversationsResult>>(regularKey);
      const previousPinned = queryClient.getQueryData<InfiniteData<ListConversationsResult>>(pinnedKey);
      const now = new Date().toISOString();

      if (pinned) {
        // Pinning: remove from regular, add to pinned
        let movedConversation: StoredConversation | null = null;

        queryClient.setQueryData<InfiniteData<ListConversationsResult>>(regularKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => {
              const filtered = page.conversations.filter((c) => {
                if (c.id === conversationId) {
                  movedConversation = c;
                  return false;
                }
                return true;
              });
              return { ...page, conversations: filtered };
            }),
          };
        });

        if (movedConversation) {
          const conv = movedConversation as StoredConversation;
          const updated: StoredConversation = { ...conv, pinned_at: now, updated_at: now };
          queryClient.setQueryData<InfiniteData<ListConversationsResult>>(pinnedKey, (old) => {
            if (!old || old.pages.length === 0) {
              return {
                pages: [{ conversations: [updated], hasMore: false, nextCursor: null, totalCount: 1 }],
                pageParams: [null],
              };
            }
            return {
              ...old,
              pages: [
                { ...old.pages[0], conversations: [updated, ...old.pages[0].conversations] },
                ...old.pages.slice(1),
              ],
            };
          });
        }
      } else {
        // Unpinning: remove from pinned, add to regular
        let movedConversation: StoredConversation | null = null;

        queryClient.setQueryData<InfiniteData<ListConversationsResult>>(pinnedKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => {
              const filtered = page.conversations.filter((c) => {
                if (c.id === conversationId) {
                  movedConversation = c;
                  return false;
                }
                return true;
              });
              return { ...page, conversations: filtered };
            }),
          };
        });

        if (movedConversation) {
          const conv = movedConversation as StoredConversation;
          const updated: StoredConversation = { ...conv, pinned_at: null, updated_at: now };
          queryClient.setQueryData<InfiniteData<ListConversationsResult>>(regularKey, (old) => {
            if (!old || old.pages.length === 0) {
              return {
                pages: [{ conversations: [updated], hasMore: false, nextCursor: null, totalCount: 1 }],
                pageParams: [null],
              };
            }
            return {
              ...old,
              pages: [
                { ...old.pages[0], conversations: [updated, ...old.pages[0].conversations] },
                ...old.pages.slice(1),
              ],
            };
          });
        }
      }

      return { previousRegular, previousPinned };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousRegular) {
        queryClient.setQueryData(['conversations', 'regular'], context.previousRegular);
      }
      if (context?.previousPinned) {
        queryClient.setQueryData(['conversations', 'pinned'], context.previousPinned);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'regular'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', 'pinned'] });
      queryClient.invalidateQueries({ queryKey: ['pinnedCount'] });
      queryClient.invalidateQueries({ queryKey: ['conversation', variables.conversationId] });
    },
  });
}

// ============================================================================
// ARCHIVE
// ============================================================================

async function archiveConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}/archive`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to archive conversation');
}

async function unarchiveConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}/archive`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to unarchive conversation');
}

export function useArchiveConversation() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, archived }: { conversationId: string; archived: boolean }) =>
      archived ? archiveConversation(conversationId) : unarchiveConversation(conversationId),
    onMutate: async ({ conversationId, archived }) => {
      const regularKey = ['conversations', 'regular'] as const;
      const pinnedKey = ['conversations', 'pinned'] as const;

      await queryClient.cancelQueries({ queryKey: regularKey });
      await queryClient.cancelQueries({ queryKey: pinnedKey });

      const previousRegular = queryClient.getQueryData<InfiniteData<ListConversationsResult>>(regularKey);
      const previousPinned = queryClient.getQueryData<InfiniteData<ListConversationsResult>>(pinnedKey);

      // When archiving, remove from both regular and pinned lists
      if (archived) {
        queryClient.setQueryData<InfiniteData<ListConversationsResult>>(regularKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              conversations: page.conversations.filter((c) => c.id !== conversationId),
            })),
          };
        });
        queryClient.setQueryData<InfiniteData<ListConversationsResult>>(pinnedKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              conversations: page.conversations.filter((c) => c.id !== conversationId),
            })),
          };
        });
      }

      return { previousRegular, previousPinned };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousRegular) {
        queryClient.setQueryData(['conversations', 'regular'], context.previousRegular);
      }
      if (context?.previousPinned) {
        queryClient.setQueryData(['conversations', 'pinned'], context.previousPinned);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'regular'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', 'pinned'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', 'archived'] });
      queryClient.invalidateQueries({ queryKey: ['pinnedCount'] });
    },
    onSuccess: (_, { conversationId, archived }) => {
      if (archived) {
        // Drop cached detail/messages so navigating back never shows stale data
        queryClient.removeQueries({ queryKey: ['conversation', conversationId] });
        queryClient.removeQueries({ queryKey: ['messages', conversationId] });
        // Navigate home if archived conversation was active
        if (pathname === `/chats/${conversationId}`) {
          router.push('/');
        }
      }
    },
  });
}

// ============================================================================
// PINNED COUNT
// ============================================================================

interface PinnedCountResult {
  count: number;
  limit: number;
  canPin: boolean;
}

async function fetchPinnedCount(): Promise<PinnedCountResult> {
  const response = await fetch('/api/conversations/pinned-count');
  if (!response.ok) throw new Error('Failed to fetch pinned count');
  return response.json();
}

export function usePinnedCount() {
  return useQuery({
    queryKey: ['pinnedCount'],
    queryFn: fetchPinnedCount,
    staleTime: 30000, // 30 seconds
  });
}

// ============================================================================
// ARCHIVE ALL
// ============================================================================

interface ArchiveAllResult {
  success: boolean;
  count: number;
}

async function archiveAllConversations(): Promise<ArchiveAllResult> {
  const response = await fetch('/api/conversations/archive-all', {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to archive all conversations');
  return response.json();
}

export function useArchiveAllConversations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: archiveAllConversations,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'regular'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', 'pinned'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', 'archived'] });
      queryClient.invalidateQueries({ queryKey: ['pinnedCount'] });
    },
  });
}

// ============================================================================
// DELETE ALL
// ============================================================================

interface DeleteAllResult {
  success: boolean;
  count: number;
}

async function deleteAllConversations(): Promise<DeleteAllResult> {
  const response = await fetch('/api/conversations/delete-all', {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to delete all conversations');
  return response.json();
}

export function useDeleteAllConversations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAllConversations,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'regular'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', 'pinned'] });
    },
  });
}

async function forkConversation(conversationId: string): Promise<{ conversationId: string }> {
  const response = await fetch(`/api/conversations/${conversationId}/fork`, { method: 'POST' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fork conversation');
  }
  return response.json();
}

/** Fork one of the user's own conversations into a standalone copy. */
export function useForkConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId: string) => forkConversation(conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
