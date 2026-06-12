'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAttachmentUrl, extractFileIdFromAttachmentUrl } from '@/lib/storage/attachment-url-utils';

/**
 * Fetcher function for resolving attachment URLs in the share context.
 * Uses the public share-specific endpoint instead of the authenticated one.
 */
async function resolveShareAttachmentFetcher(fileId: string, shareToken: string): Promise<string> {
  const response = await fetch(`/api/share/${shareToken}/attachments/${encodeURIComponent(fileId)}`);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to resolve attachment URL');
  }

  const data = await response.json();
  return data.url;
}

interface UseShareAttachmentUrlResult {
  resolvedUrl: string | undefined;
  isResolving: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook to resolve attachment URLs for shared conversations.
 * Works without authentication — uses the share token for access validation.
 */
export function useShareAttachmentUrl(
  initialUrl: string | undefined,
  shareToken: string
): UseShareAttachmentUrlResult {
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

  const queryResult = useQuery({
    queryKey: ['share-attachment-url', fileId, shareToken],
    queryFn: () => resolveShareAttachmentFetcher(fileId!, shareToken),
    enabled: !!fileId && !!shareToken,
    staleTime: 23 * 60 * 60 * 1000, // 23 hours — signed URLs expire in 24 hours
    gcTime: 24 * 60 * 60 * 1000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  return {
    resolvedUrl: isAttachment ? queryResult.data : initialUrl,
    isResolving: queryResult.isLoading,
    error: queryResult.error as Error | null,
    refetch: queryResult.refetch,
  };
}
