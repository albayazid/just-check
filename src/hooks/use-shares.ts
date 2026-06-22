'use client';

/** React Query hooks for sharing — singleton share at `/api/conversations/[id]/share`. */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShareConversationView, RefreshShareInput, PublicShareView } from '@/lib/sharing/types';

// ============================================================================
// FETCH HELPERS
// ============================================================================

async function fetchShare(conversationId: string): Promise<ShareConversationView | null> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/share`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch share');
  }
  const data = await res.json();
  return data.share;
}

async function createShare(
  conversationId: string,
  input: RefreshShareInput,
): Promise<{ id: string; token: string; url: string }> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to create share');
  }
  return res.json();
}

async function resyncShare(
  conversationId: string,
  input: RefreshShareInput,
): Promise<{ id: string; token: string; url: string }> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/share`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to update link');
  }
  return res.json();
}

async function revokeShare(conversationId: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/share`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to revoke share');
  }
}

async function fetchPublicShare(token: string): Promise<PublicShareView> {
  const res = await fetch(`/api/share/${token}`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Shared conversation not found');
  }
  return res.json();
}

async function forkShare(token: string): Promise<{ conversationId: string }> {
  const res = await fetch(`/api/share/${token}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fork conversation');
  }
  return res.json();
}

// ============================================================================
// HOOKS
// ============================================================================

/** Fetch the single active share for a conversation, or null (auth required) */
export function useShare(conversationId: string) {
  return useQuery({
    queryKey: ['share', conversationId],
    queryFn: () => fetchShare(conversationId),
    enabled: !!conversationId,
  });
}

/** Create a new share, or reuse the existing one if present (auth required) */
export function useCreateShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, ...input }: { conversationId: string } & RefreshShareInput) =>
      createShare(conversationId, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['share', variables.conversationId] });
    },
  });
}

/** Re-freeze the share with new settings, same token (auth required) */
export function useResyncShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, ...input }: { conversationId: string } & RefreshShareInput) =>
      resyncShare(conversationId, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['share', variables.conversationId] });
    },
  });
}

/** Revoke the share for a conversation (auth required) */
export function useRevokeShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId: string) => revokeShare(conversationId),
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({ queryKey: ['share', conversationId] });
    },
  });
}

/** Fetch a public share by token (no auth required) */
export function usePublicShare(token: string) {
  return useQuery({
    queryKey: ['public-share', token],
    queryFn: () => fetchPublicShare(token),
    enabled: !!token,
    retry: 1,
  });
}

/** Fork a shared conversation into the user's account (auth required) */
export function useForkShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: forkShare,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
