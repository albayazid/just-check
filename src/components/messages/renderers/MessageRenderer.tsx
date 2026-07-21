'use client';

import { memo } from "react";
import { UIMessage } from 'ai';
import { UserMessage } from './UserMessage';
import type { EditMessagePart } from './UserMessage';
import { AIMessage } from './AIMessage';

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
  /** ID of the assistant message whose stream failed; renders a notice below it. */
  failedAssistantId?: string | null;
  /** IDs of user messages whose send failed; shows a Retry button below them. */
  failedUserIds?: Set<string>;
  /** Retries a failed user message by its ID. */
  onRetryUserMessage?: (messageId: string) => void;
  /** Whether the user can send/regenerate right now (allowance + other gates). */
  canSendMessages?: boolean;
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
  failedAssistantId,
  failedUserIds,
  onRetryUserMessage,
  canSendMessages,
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
          status={failedUserIds?.has(message.id) ? 'failed' : 'normal'}
          onRetry={onRetryUserMessage ? () => onRetryUserMessage(message.id) : undefined}
          canSendMessages={canSendMessages}
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
          status={failedAssistantId === message.id ? 'failed' : 'normal'}
        />
      );
    default:
      return null;
  }
});