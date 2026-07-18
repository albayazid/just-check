'use client';

import { memo } from "react";
import { UIMessage } from 'ai';
import { UserMessage } from './UserMessage';
import type { EditMessagePart } from './UserMessage';
import { AIMessage } from './AIMessage';
import type { ChatErrorKind } from '@/lib/chat-error';

interface MessageRendererProps {
  message: UIMessage;
  conversationId: string;
  isStreaming?: boolean;
  isLoading?: boolean;
  isGenerating?: boolean;
  onEdit?: (parts: EditMessagePart[]) => void;
  onRegenerate?: () => void;
  branchCurrentIndex?: number;
  branchTotalSiblings?: number;
  onBranchPrevious?: () => void;
  onBranchNext?: () => void;
  selectedUIModelId: string;
  onUIModelChange: (uiModelId: string) => void;
  hasAllowance?: boolean;
  isLoadingAllowance?: boolean;
  /** When provided, uses the public share endpoint to resolve attachment URLs instead of the authenticated one. Also enables readOnly mode. */
  shareToken?: string;
  /** When non-null, this assistant message's stream failed; renders an inline notice below it. */
  failureKind?: ChatErrorKind | null;
  /** Clears the failed-assistant marker (Dismiss on the notice). */
  onDismissFailure?: () => void;
}

export const MessageRenderer = memo(function MessageRenderer({
  message,
  conversationId,
  isStreaming = false,
  isLoading = false,
  isGenerating = false,
  onEdit,
  onRegenerate,
  branchCurrentIndex,
  branchTotalSiblings,
  onBranchPrevious,
  onBranchNext,
  selectedUIModelId,
  onUIModelChange,
  hasAllowance,
  isLoadingAllowance,
  shareToken,
  failureKind,
  onDismissFailure,
}: MessageRendererProps) {
  const readOnly = !!shareToken;

  switch (message.role) {
    case 'user':
      return (
        <UserMessage
          message={message}
          conversationId={conversationId}
          onEdit={onEdit}
          branchCurrentIndex={branchCurrentIndex}
          branchTotalSiblings={branchTotalSiblings}
          onBranchPrevious={onBranchPrevious}
          onBranchNext={onBranchNext}
          isGenerating={isGenerating}
          isLoading={isLoading}
          selectedUIModelId={selectedUIModelId}
          onUIModelChange={onUIModelChange}
          hasAllowance={hasAllowance}
          isLoadingAllowance={isLoadingAllowance}
          shareToken={shareToken}
        />
      );
    case 'assistant':
      return (
        <AIMessage
          message={message}
          isStreaming={isStreaming}
          onRegenerate={onRegenerate}
          branchCurrentIndex={branchCurrentIndex}
          branchTotalSiblings={branchTotalSiblings}
          onBranchPrevious={onBranchPrevious}
          onBranchNext={onBranchNext}
          isLoading={isLoading}
          isGenerating={isGenerating}
          readOnly={readOnly}
          status={failureKind ? 'failed' : 'normal'}
          failureKind={failureKind}
          onDismissFailure={onDismissFailure}
        />
      );
    default:
      return null;
  }
});