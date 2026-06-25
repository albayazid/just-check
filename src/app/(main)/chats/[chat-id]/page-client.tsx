'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ChatPageShell,
  type ChatPageShellAttachment,
  type ChatPageShellPendingMessage,
} from '@/components/chat/chat-page-shell';
import ChatPageHeader from '@/components/chat/chat-page-header';
import { ChatHistorySkeleton } from '@/components/messages/renderers/ChatHistorySkeleton';
import { useMessages } from '@/hooks/use-messages';
import { useConversation } from '@/hooks/use-conversation';
import { useSubscriptionAndAllowanceStatus } from '@/hooks/use-subscription-and-allowance';
import { useConversationStarterStore } from '@/stores/message-store';

export default function ChatPageClient() {
  const params = useParams();
  const router = useRouter();
  const chatId = params['chat-id'] as string;
  const conversationStarter = useConversationStarterStore((state) => state.conversationStarter);
  const clearConversationStarter = useConversationStarterStore((state) => state.clearConversationStarter);
  const { planId, hasAllowance, remainingPercentage, periodEnd, isLoading: isLoadingAllowance } = useSubscriptionAndAllowanceStatus();
  const { data: messagesData, isPending: isLoadingHistory, isError } = useMessages(chatId);
  const { data: conversationData } = useConversation(chatId);
  const [visibleLeafMessageId, setVisibleLeafMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (conversationData?.title !== undefined) {
      document.title = `${conversationData.title || 'Untitled Conversation'} - Lumy`;
    }
  }, [conversationData?.title]);

  useEffect(() => {
    if (isError) {
      router.push('/');
    }
  }, [isError, router]);

  if (isError) {
    return null;
  }

  const pendingMessage: ChatPageShellPendingMessage | null = conversationStarter
    ? {
        message: conversationStarter.message,
        attachments: conversationStarter.attachments as ChatPageShellAttachment[] | undefined,
        UIModelId: conversationStarter.UIModelId ?? 'fast',
        mode: conversationStarter.mode ?? null,
      }
    : null;

  return (
    <div className="flex h-full w-full flex-col">
      <ChatPageHeader chatId={chatId} currentLeafMessageId={visibleLeafMessageId} />
      {/*
        `min-h-0 flex-1` gives the shell a bounded height so its internal message
        scroller works; the header above is shrink-0 and stays pinned.
      */}
      <div className="min-h-0 flex-1">
        <ChatPageShell
          chatId={chatId}
          onVisibleLeafChange={setVisibleLeafMessageId}
          messagesData={messagesData}
          prepareSendMessagesRequest={({ id, messages, body, trigger, messageId }) => ({
            body: { id, messages, trigger, messageId, ...body },
          })}
          isLoadingHistory={isLoadingHistory}
          historyContent={<ChatHistorySkeleton />}
          pendingMessage={pendingMessage}
          onPendingMessageConsumed={clearConversationStarter}
          onSubmitMessage={({ text, attachments, currentUIModelId, currentModeId, displayedMessages, sendMessage, getLastRealMessageId }) => {
            sendMessage(
              {
                parts: [
                  { type: 'text', text },
                  ...(attachments ?? []).map((attachment) => ({
                    type: 'file' as const,
                    url: attachment.url,
                    mediaType: attachment.mimeType,
                    filename: attachment.originalName,
                  })),
                ],
              },
              {
                body: {
                  UIModelId: currentUIModelId,
                  mode: currentModeId,
                  previousMessageId: getLastRealMessageId(displayedMessages),
                },
              }
            );
          }}
          onSubmitEditedMessage={({ parts, previousMessageId, currentUIModelId, currentModeId, sendMessage }) => {
            sendMessage(
              { parts },
              {
                body: { UIModelId: currentUIModelId, mode: currentModeId, previousMessageId },
              }
            );
          }}
          onSubmitRegeneratedMessage={({ messageId, currentUIModelId, currentModeId, regenerate }) => {
            regenerate({
              messageId,
              body: { UIModelId: currentUIModelId, mode: currentModeId },
            });
          }}
          canSendMessages={!!hasAllowance}
          canMutateMessages={!!hasAllowance}
          planId={planId}
          hasAllowance={hasAllowance}
          remainingPercentage={remainingPercentage}
          allowanceResetTime={periodEnd}
          isLoadingAllowance={isLoadingAllowance}
        />
      </div>
    </div>
  );
}
