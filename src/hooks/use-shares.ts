'use client';

/**
 * React Query hooks for the sharing feature.
 * Follows the same pattern as use-conversations.ts.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShareListItem, ShareMode, PublicShareView } from '@/lib/sharing/types';

// ============================================================================
// FETCH HELPERS
// ============================================================================

async function fetchShares(conversationId: string): Promise<ShareListItem[]> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/shares`);
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to fetch shares');
  }
  const data = await res.json();
  return data.shares;
}

async function createShare(input: {
  conversationId: string;
  shareMode: ShareMode;
  showOwnerName: boolean;
  currentLeafMessageId?: string;
}): Promise<{ id: string; token: string; url: string }> {
  const res = await fetch('/api/shares', {
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

async function revokeShare(shareId: string): Promise<void> {
  const res = await fetch(`/api/shares/${shareId}/revoke`, { method: 'DELETE' });
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

/** Fetch all shares for a conversation (auth required) */
export function useShares(conversationId: string) {
  return useQuery({
    queryKey: ['shares', conversationId],
    queryFn: () => fetchShares(conversationId),
    enabled: !!conversationId,
  });
}

/** Create a new share (auth required) */
export function useCreateShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createShare,
    onSuccess: (_data, variables) => {
      // Invalidate shares list for this conversation
      queryClient.invalidateQueries({ queryKey: ['shares', variables.conversationId] });
    },
  });
}

/** Revoke an existing share (auth required) */
export function useRevokeShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: revokeShare,
    onSuccess: () => {
      // Invalidate all shares queries (we don't know which conversation)
      queryClient.invalidateQueries({ queryKey: ['shares'] });
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
  return useMutation({
    mutationFn: forkShare,
  });
}
