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
}: MessageRendererProps) {

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
        />
      );
    default:
      return null;
  }
});