'use client';

import { useMemo } from 'react';
import type { UIMessage } from 'ai';
import { useAuth } from '@clerk/nextjs';
import { AlertTriangle, ExternalLink, GitFork, Copy, Check } from 'lucide-react';
import { usePublicShare, useForkShare } from '@/hooks/use-shares';
import { useBranchState } from '@/hooks/use-branch-state';
import { MessageRenderer } from '@/components/messages/renderers/MessageRenderer';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { APP_BRAND_NAME, PARENT_COMPANY_NAME } from '@/lib/branding-constants';
import { copyToClipboard } from '@/lib/utils/clipboard';
import { toast } from 'sonner';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StoredMessage } from '@/lib/conversation-history';

function toStoredMessages(
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    parts: unknown[];
    metadata: Record<string, unknown>;
    previousMessageId: string | null;
    createdAt: string;
  }>,
  conversationId: string
): StoredMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: m.id,
      conversation_id: conversationId,
      previous_message_id: m.previousMessageId ?? null,
      sender_type: m.role as 'user' | 'assistant',
      content: m.parts as StoredMessage['content'],
      metadata: m.metadata,
      created_at: m.createdAt,
    }));
}

export default function SharePageClient({ token }: { token: string }) {
  const { data: share, isLoading, error } = usePublicShare(token);
  const { isSignedIn } = useAuth();
  const forkMutation = useForkShare();
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const allMessages = useMemo(() => {
    if (!share?.messages) return [];
    return toStoredMessages(share.messages, share.id);
  }, [share]);

  const branchState = useBranchState(allMessages);

  const displayedMessages = useMemo(() => {
    return branchState.activePath.map((m) => ({
      id: m.id,
      role: m.sender_type as 'user' | 'assistant',
      parts: m.content,
      metadata: m.metadata,
      createdAt: m.created_at ? new Date(m.created_at) : undefined,
    })) as UIMessage[];
  }, [branchState.activePath]);

  const handleBranchPrevious = (parentId: string | null) => {
    branchState.switchBranch(parentId, 'prev');
  };

  const handleBranchNext = (parentId: string | null) => {
    branchState.switchBranch(parentId, 'next');
  };

  const handleCopyLink = async () => {
    try {
      await copyToClipboard(window.location.href);
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const handleFork = async () => {
    try {
      const result = await forkMutation.mutateAsync(token);
      router.push(`/chats/${result.conversationId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to fork conversation');
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-4 w-32 mb-8" />
        <div className="space-y-6">
          <Skeleton className="h-20 w-3/4 ml-auto" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-16 w-2/3 ml-auto" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (error || !share) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 px-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-semibold text-foreground">
          This shared conversation is no longer available.
        </h1>
        <p className="text-muted-foreground text-sm text-center max-w-md">
          The link may have been revoked or has expired.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => (window.location.href = '/')}
        >
          Go to {APP_BRAND_NAME}
          <ExternalLink className="ml-2 h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-2">
        {share.title && (
          <h1 className="text-xl font-semibold text-foreground">{share.title}</h1>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          {share.ownerDisplayName && <span>Shared by {share.ownerDisplayName}</span>}
          {share.ownerDisplayName && <span>·</span>}
          <span>{new Date(share.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="mx-auto max-w-3xl space-y-6 py-6">
          {displayedMessages.map((message) => {
            const info = branchState.siblingInfo.get(message.id);
            const branchCurrentIndex = info && info.total > 1 ? info.index : undefined;
            const branchTotalSiblings = info && info.total > 1 ? info.total : undefined;
            const branchParentId = info && info.total > 1 ? info.parentId : undefined;

            return (
              <MessageRenderer
                key={message.id}
                message={message}
                conversationId={share.id}
                branchCurrentIndex={branchCurrentIndex}
                branchTotalSiblings={branchTotalSiblings}
                onBranchPrevious={
                  branchParentId !== undefined ? () => handleBranchPrevious(branchParentId) : undefined
                }
                onBranchNext={
                  branchParentId !== undefined ? () => handleBranchNext(branchParentId) : undefined
                }
                selectedUIModelId="fast"
                onUIModelChange={() => {}}
                shareToken={token}
              />
            );
          })}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-border/50 bg-background/95 backdrop-blur-sm px-4 py-3">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-3">
          <Button
            onClick={isSignedIn ? handleFork : () => (window.location.href = `/sign-up?redirect_url=${encodeURIComponent(window.location.pathname)}`)}
            disabled={forkMutation.isPending}
            size="sm"
          >
            {forkMutation.isPending ? 'Loading...' : 'Continue this chat in Lumy'}
          </Button>
        </div>
        <div className="mt-2 text-center">
          <span className="text-xs text-muted-foreground/40">
            &copy; {new Date().getFullYear()} {PARENT_COMPANY_NAME}
          </span>
        </div>
      </div>
    </div>
  );
}
