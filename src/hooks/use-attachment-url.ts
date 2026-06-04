"use client";

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAttachmentUrl, extractFileIdFromAttachmentUrl } from '@/lib/storage/attachment-url-utils';

/**
 * Fetcher function for resolving attachment URLs
 */
async function resolveAttachmentFetcher(fileId: string, conversationId: string): Promise<string> {
  const response = await fetch('/api/attachments/resolve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileId, conversationId }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to resolve attachment URL');
  }

  const data = await response.json();
  return data.url;
}

interface UseAttachmentUrlResult {
  resolvedUrl: string | undefined;
  isResolving: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Custom hook to resolve attachment URLs to signed URLs using React Query.
 * This provides automatic caching, deduplication, and retry logic.
 * 
 * Benefits over manual fetch:
 * - Caching: Same attachment URL won't trigger duplicate requests
 * - Deduplication: Multiple components requesting same URL = single request
 * - Retry: Automatic retry on failure (3 attempts by default)
 * - Stale-while-revalidate: Shows cached data while refreshing in background
 */
export function useAttachmentUrl(initialUrl: string | undefined, conversationId?: string): UseAttachmentUrlResult {
  // Determine if this is an attachment URL that needs resolution
  const isAttachment = useMemo(() => {
    return initialUrl !== undefined && isAttachmentUrl(initialUrl);
  }, [initialUrl]);

  const fileId = useMemo((): string | null => {
    if (!isAttachment || !initialUrl) return null;
    try {
      return extractFileIdFromAttachmentUrl(initialUrl);
    } catch {
      return null;
    }
  }, [initialUrl, isAttachment]);

  // Use React Query for data fetching with caching
  const queryResult = useQuery({
    queryKey: ['attachment-url', fileId, conversationId],
    queryFn: () => resolveAttachmentFetcher(fileId!, conversationId!),
    enabled: !!fileId && !!conversationId, // Only run query if we have both fileId and conversationId
    staleTime: 23 * 60 * 60 * 1000, // 23 hours - signed URLs expire in 24 hours
    gcTime: 24 * 60 * 60 * 1000, // 24 hours garbage collection (formerly cacheTime)
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Return the resolved URL or original based on URL type
  return {
    resolvedUrl: isAttachment ? queryResult.data : initialUrl,
    isResolving: queryResult.isLoading,
    error: queryResult.error as Error | null,
    refetch: queryResult.refetch,
  };
}
