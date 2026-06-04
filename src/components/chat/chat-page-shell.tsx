'use client';

import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ChatInput } from '@/components/chat-input';
import { MessageRenderer } from '@/components/messages/renderers/MessageRenderer';
import type { EditMessagePart } from '@/components/messages/renderers/UserMessage';
import { useBranchSync } from '@/hooks/use-branch-sync';
import { getLastRealMessageId, type SiblingInfo } from '@/hooks/use-branch-state';
import { useOptimisticMessages } from '@/hooks/use-optimistic-messages';
import { executeClientTool } from '@/lib/tools/client-executors';

export type ChatPageShellAttachment = {
  url: string;
  originalName: string;
  mimeType: string;
};

export type ChatPageShellPendingMessage = {
  message: string;
  attachments?: ChatPageShellAttachment[];
  UIModelId: string;
  body?: Record<string, unknown>;
};

type SendRequestOptions = {
  id?: string;
  messages: UIMessage[];
  body?: Record<string, unknown>;
  trigger: string;
  messageId?: string;
};

type ChatPageSendContext = {
  text: string;
  attachments?: ChatPageShellAttachment[];
  currentUIModelId: string;
  displayedMessages: UIMessage[];
  sendMessage: ReturnType<typeof useChat>['sendMessage'];
  getLastRealMessageId: typeof getLastRealMessageId;
};

type ChatPageEditContext = {
  parts: EditMessagePart[];
  previousMessageId: string | null;
  currentUIModelId: string;
  sendMessage: ReturnType<typeof useChat>['sendMessage'];
};

type ChatPageRegenerateContext = {
  messageId: string;
  parentId: string | null;
  currentUIModelId: string;
  regenerate: ReturnType<typeof useChat>['regenerate'];
};

interface ChatPageShellProps {
  chatId: string;
  branchChatId?: string;
  messagesData: { messages: UIMessage[] } | undefined;
  prepareSendMessagesRequest: (options: SendRequestOptions) => {
    body: Record<string, unknown>;
  };
  isLoadingHistory?: boolean;
  historyContent?: ReactNode;
  emptyState?: ReactNode;
  extraLoading?: boolean;
  pendingMessage?: ChatPageShellPendingMessage | null;
  onPendingMessageConsumed?: () => void;
  onSubmitMessage: (context: ChatPageSendContext) => void | Promise<void>;
  onSubmitEditedMessage: (context: ChatPageEditContext) => void;
  onSubmitRegeneratedMessage: (context: ChatPageRegenerateContext) => void;
  canSendMessages: boolean;
  canMutateMessages: boolean;
  planId: string | undefined;
  hasAllowance: boolean | undefined;
  remainingPercentage: number;
  allowanceResetTime: string | null;
  isLoadingAllowance: boolean;
  initialUIModelId?: string;
}

function buildMessageParts(text: string, attachments?: ChatPageShellAttachment[]) {
  const parts: Array<
    { type: 'text'; text: string } |
    { type: 'file'; url: string; mediaType: string; filename?: string }
  > = [{ type: 'text', text }];

  attachments?.forEach((attachment) => {
    parts.push({
      type: 'file',
      url: attachment.url,
      mediaType: attachment.mimeType,
      filename: attachment.originalName,
    });
  });

  return parts;
}

export function ChatPageShell({
  chatId,
  branchChatId,
  messagesData,
  prepareSendMessagesRequest,
  isLoadingHistory = false,
  historyContent,
  emptyState,
  extraLoading = false,
  pendingMessage = null,
  onPendingMessageConsumed,
  onSubmitMessage,
  onSubmitEditedMessage,
  onSubmitRegeneratedMessage,
  canSendMessages,
  canMutateMessages,
  planId,
  hasAllowance,
  remainingPercentage,
  allowanceResetTime,
  isLoadingAllowance,
  initialUIModelId = 'fast',
}: ChatPageShellProps) {
  const queryClient = useQueryClient();
  const cacheChatId = branchChatId ?? chatId;
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef(true);
  const prevActivePathRef = useRef<string[]>([]);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [currentUIModelId, setCurrentUIModelId] = useState<string>(initialUIModelId);

  const { messages, sendMessage, regenerate, status, stop, setMessages, addToolOutput } = useChat({
    id: chatId,
    experimental_throttle: 100,
    generateId: uuidv4,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest,
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    async onToolCall({ toolCall }) {
      const result = await executeClientTool(toolCall);

      if (!result) {
        return;
      }

      if (result.error) {
        addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          state: result.error.state,
          errorText: result.error.errorText,
        });
        return;
      }

      addToolOutput({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: result.output,
      });
    },
  });

  useOptimisticMessages(messages, cacheChatId, queryClient);

  const {
    displayedMessages: branchDisplayedMessages,
    branchState,
    siblingInfo,
    handleBranchPrevious,
    handleBranchNext,
    toUIMessage,
  } = useBranchSync(messagesData, cacheChatId);

  const streamingLastMessageId = useMemo(() => {
    return messages.length > 0 ? messages[messages.length - 1].id : null;
  }, [messages]);

  const activePathLastMessageId = useMemo(() => {
    const path = branchState.activePath;
    return path.length > 0 ? path[path.length - 1].id : null;
  }, [branchState.activePath]);

  const isViewingStreamingBranch =
    status !== 'ready'
    && streamingLastMessageId
    && activePathLastMessageId
    && streamingLastMessageId === activePathLastMessageId;

  const displayedMessages = useMemo(() => {
    return isViewingStreamingBranch ? messages : branchDisplayedMessages;
  }, [branchDisplayedMessages, isViewingStreamingBranch, messages]);

  useEffect(() => {
    if (status === 'ready' && branchState.activePath.length > 0 && !isViewingStreamingBranch) {
      const newIds = branchState.activePath.map((message) => message.id);
      const prevIds = prevActivePathRef.current;
      const isSame = newIds.length === prevIds.length && newIds.every((id, index) => id === prevIds[index]);

      if (!isSame) {
        setMessages(branchState.activePath.map(toUIMessage));
        prevActivePathRef.current = newIds;
      }
    }
  }, [branchState.activePath, isViewingStreamingBranch, setMessages, status, toUIMessage]);

  useEffect(() => {
    if (!pendingMessage || isLoadingHistory || !messagesData) {
      return;
    }

    sendMessage(
      { parts: buildMessageParts(pendingMessage.message, pendingMessage.attachments) },
      {
        body: {
          UIModelId: pendingMessage.UIModelId,
          previousMessageId: getLastRealMessageId(displayedMessages),
          ...pendingMessage.body,
        },
      }
    );
    onPendingMessageConsumed?.();
  }, [
    displayedMessages,
    isLoadingHistory,
    messagesData,
    onPendingMessageConsumed,
    pendingMessage,
    sendMessage,
  ]);

  const handleSendMessage = useCallback((text: string, attachments?: ChatPageShellAttachment[]) => {
    if (!canSendMessages) {
      return;
    }

    void onSubmitMessage({
      text,
      attachments,
      currentUIModelId,
      displayedMessages,
      sendMessage,
      getLastRealMessageId,
    });
  }, [canSendMessages, currentUIModelId, displayedMessages, onSubmitMessage, sendMessage]);

  const handleEditMessage = useCallback((parts: EditMessagePart[], previousMessageId: string | null) => {
    if (!canMutateMessages) {
      return;
    }

    branchState.clearOverride(previousMessageId);

    if (previousMessageId) {
      const parentChain = branchState.getAncestors(previousMessageId);
      setMessages(parentChain.map(toUIMessage));
    } else {
      setMessages([]);
    }

    onSubmitEditedMessage({
      parts,
      previousMessageId,
      currentUIModelId,
      sendMessage,
    });
  }, [branchState, canMutateMessages, currentUIModelId, onSubmitEditedMessage, sendMessage, setMessages, toUIMessage]);

  const handleRegenerateMessage = useCallback((messageId: string, parentId: string | null) => {
    if (!canMutateMessages) {
      return;
    }

    branchState.clearOverride(parentId);
    onSubmitRegeneratedMessage({
      messageId,
      parentId,
      currentUIModelId,
      regenerate,
    });
  }, [branchState, canMutateMessages, currentUIModelId, onSubmitRegeneratedMessage, regenerate]);

  const scrollToBottom = useCallback(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const nearBottom = distanceFromBottom < 100;

      setShowScrollButton(!nearBottom);
      isUserAtBottomRef.current = nearBottom;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (displayedMessages.length > 0 && !isLoadingHistory && isUserAtBottomRef.current) {
      setTimeout(() => {
        if (messagesContainerRef.current && isUserAtBottomRef.current) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      }, 50);
    }
  }, [displayedMessages, isLoadingHistory]);

  const isLoading = status === 'submitted' || extraLoading;
  const isGenerating = status === 'streaming';

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="relative flex-1">
        <div
          ref={messagesContainerRef}
          className="absolute inset-0 overflow-y-auto p-4"
        >
          <div className="mx-auto min-h-full max-w-3xl space-y-6">
            {isLoadingHistory ? historyContent : (
              <>
                {displayedMessages.length === 0 ? emptyState : displayedMessages.map((message, index, array) => {
                  const isLastMessage = index === array.length - 1;
                  const info = siblingInfo.get(message.id);
                  const branchCurrentIndex = info && info.total > 1 ? info.index : undefined;
                  const branchTotalSiblings = info && info.total > 1 ? info.total : undefined;
                  const branchParentId = info && info.total > 1 ? info.parentId : undefined;
                  const editParentId =
                    message.role === 'user'
                      ? siblingInfo.get(message.id)?.parentId ??
                        (message.metadata as { previous_message_id?: string | null } | undefined)?.previous_message_id ??
                        null
                      : null;

                  return (
                    <MessageRenderer
                      key={message.id}
                      message={message}
                      conversationId={chatId}
                      isStreaming={isGenerating && isLastMessage}
                      isLoading={isLoading}
                      isGenerating={isGenerating}
                      onEdit={
                        message.role === 'user'
                          ? (parts) => handleEditMessage(parts, editParentId)
                          : undefined
                      }
                      onRegenerate={
                        message.role === 'assistant'
                          ? () => handleRegenerateMessage(message.id, branchParentId ?? null)
                          : undefined
                      }
                      branchCurrentIndex={branchCurrentIndex}
                      branchTotalSiblings={branchTotalSiblings}
                      onBranchPrevious={branchParentId !== undefined ? () => handleBranchPrevious(branchParentId) : undefined}
                      onBranchNext={branchParentId !== undefined ? () => handleBranchNext(branchParentId) : undefined}
                      selectedUIModelId={currentUIModelId}
                      onUIModelChange={setCurrentUIModelId}
                      hasAllowance={hasAllowance}
                      isLoadingAllowance={isLoadingAllowance}
                    />
                  );
                })}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <AnimatePresence>
          {showScrollButton && (
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2 }}
              onClick={scrollToBottom}
              className="absolute bottom-4 left-1/2 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white shadow-lg transition-colors hover:bg-black/70"
              aria-label="Scroll to bottom"
            >
              <ChevronDown className="h-5 w-5" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="sticky bottom-0 left-0 right-0 border-t border-border bg-background p-2">
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="flex flex-1 flex-col"
          >
            <motion.div
              layoutId="chat-input-container"
              className="flex-1"
            >
              <ChatInput
                onSubmit={handleSendMessage}
                isLoading={isLoading}
                isAiGenerating={isGenerating}
                onStopGenerating={stop}
                placeholder="Type your message..."
                selectedUIModelId={currentUIModelId}
                onUIModelChange={setCurrentUIModelId}
                planId={planId}
                hasAllowance={hasAllowance}
                remainingPercentage={remainingPercentage}
                allowanceResetTime={allowanceResetTime}
                isLoadingAllowance={isLoadingAllowance}
              />
            </motion.div>
            <p className="mt-1 text-center text-[12px] text-gray-500">
              AI can make mistakes, consider checking important information.
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export type { SiblingInfo };
