'use client';

import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageCircleDashed, MessageCirclePlus } from 'lucide-react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import Link from 'next/link';
import {
  ChatPageShell,
  type ChatPageShellAttachment,
  type ChatPageShellPendingMessage,
} from '@/components/chat/chat-page-shell';
import BrandHeader from '@/components/common/brand-header';
import { MessageCircleDashedCheck } from '@/components/icons/message-circle-dashed-check';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSubscriptionAndAllowanceStatus } from '@/hooks/use-subscription-and-allowance';

const MAX_CREATE_ATTEMPTS = 3;

type PendingMessage = ChatPageShellPendingMessage;

export default function TemporaryChatPageClient() {
  const isMobile = useIsMobile();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [pendingFirstMessage, setPendingFirstMessage] = useState<PendingMessage | null>(null);
  const [isPreparingFirstSend, setIsPreparingFirstSend] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const localSessionIdRef = useRef<string>(`temporary-${uuidv4()}`);
  const pendingCreateRef = useRef<Promise<string> | null>(null);
  const hasRequestedTemporaryEndRef = useRef(false);
  const pendingEndUsesBeaconRef = useRef(false);
  const branchChatKey = localSessionIdRef.current;
  const { planId, hasAllowance, remainingPercentage, periodEnd, isLoading: isLoadingAllowance } = useSubscriptionAndAllowanceStatus();

  const { mutateAsync: createTemporaryConversationMutateAsync } = useMutation({
    mutationFn: async (title: string) => {
      const response = await fetch('/api/conversations/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, isTemporary: true }),
      });

      if (!response.ok) {
        throw new Error(`Create failed with status ${response.status}`);
      }

      const data = await response.json() as { id: string };
      return data.id;
    },
    retry: MAX_CREATE_ATTEMPTS - 1,
    retryDelay: (attempt) => Math.min(1000, 300 * attempt),
  });

  const { data: messagesData } = useQuery({
    queryKey: ['messages', branchChatKey],
    queryFn: async () => ({ messages: [] as UIMessage[] }),
    initialData: { messages: [] as UIMessage[] },
    staleTime: Number.POSITIVE_INFINITY,
  });

  const requestEndTemporaryConversation = useCallback((targetConversationId: string, useBeacon: boolean) => {
    const url = `/api/conversations/${targetConversationId}/end-temporary`;

    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([], { type: 'application/json' }));
      return;
    }

    void fetch(url, {
      method: 'POST',
      keepalive: true,
    }).catch(() => {
      // Best-effort for leave events.
    });
  }, []);

  const createTemporaryConversation = useCallback(async (title: string): Promise<string> => {
    if (conversationId) {
      return conversationId;
    }

    if (pendingCreateRef.current) {
      return pendingCreateRef.current;
    }

    const createPromise = (async () => {
      setIsCreatingConversation(true);
      const createdConversationId = await createTemporaryConversationMutateAsync(title);

      if (hasRequestedTemporaryEndRef.current) {
        requestEndTemporaryConversation(createdConversationId, pendingEndUsesBeaconRef.current);
        return createdConversationId;
      }

      setConversationId(createdConversationId);
      return createdConversationId;
    })();

    pendingCreateRef.current = createPromise;

    try {
      return await createPromise;
    } finally {
      pendingCreateRef.current = null;
      setIsCreatingConversation(false);
    }
  }, [conversationId, createTemporaryConversationMutateAsync, requestEndTemporaryConversation]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    hasRequestedTemporaryEndRef.current = false;
    pendingEndUsesBeaconRef.current = false;
  }, [conversationId]);

  const endTemporaryConversation = useCallback((useBeacon: boolean) => {
    const activeConversationId = conversationIdRef.current;
    if (hasRequestedTemporaryEndRef.current) {
      return;
    }

    if (!activeConversationId) {
      if (pendingCreateRef.current) {
        hasRequestedTemporaryEndRef.current = true;
        pendingEndUsesBeaconRef.current = useBeacon;
      }
      return;
    }

    hasRequestedTemporaryEndRef.current = true;
    requestEndTemporaryConversation(activeConversationId, useBeacon);
  }, [requestEndTemporaryConversation]);

  useEffect(() => {
    const handlePageHide = () => {
      endTemporaryConversation(true);
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [endTemporaryConversation]);

  useEffect(() => {
    return () => {
      endTemporaryConversation(false);
    };
  }, [endTemporaryConversation]);

  const pendingMessageToSend = conversationId && pendingFirstMessage
    ? {
        ...pendingFirstMessage,
        body: {
          id: conversationId,
          previousMessageId: null,
        },
      }
    : null;

  return (
    <div className="flex h-full w-full flex-col">
      <BrandHeader>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="p-2 text-foreground rounded-lg"
                aria-label="Temporary chat active"
              >
                <MessageCircleDashedCheck size={20} />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Temporary Chat Enabled</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {isMobile && (
          <Link
            href="/"
            className="p-2 text-foreground hover:text-foreground/80 hover:bg-accent rounded-lg transition-colors"
            aria-label="New chat"
          >
            <MessageCirclePlus size={20} />
          </Link>
        )}
      </BrandHeader>
      <div className="min-h-0 flex-1">
        <ChatPageShell
          chatId={localSessionIdRef.current}
          messagesData={messagesData}
          prepareSendMessagesRequest={({ messages, body, trigger, messageId }) => ({
            body: { id: body?.id ?? conversationId, messages, trigger, messageId, ...body },
          })}
          emptyState={(
            <div className="flex min-h-[60vh] select-none flex-col items-center justify-center text-center">
              <MessageCircleDashed className="mb-3 h-10 w-10 text-muted-foreground/40" strokeWidth={1.5} />
              <div className="text-base text-muted-foreground/60">
                Start a temporary conversation
              </div>
            </div>
          )}
          extraLoading={isCreatingConversation || isPreparingFirstSend || pendingFirstMessage !== null}
          pendingMessage={pendingMessageToSend}
          onPendingMessageConsumed={() => {
            setPendingFirstMessage(null);
            setIsPreparingFirstSend(false);
          }}
          onSubmitMessage={async ({ text, attachments, currentUIModelId, currentModeId, displayedMessages, sendMessage, getLastRealMessageId }) => {
            if (!hasAllowance) {
              return;
            }

            const trimmedText = text.trim();
            if (!trimmedText) {
              return;
            }

            const parts: Array<{ type: 'text'; text: string } | { type: 'file'; url: string; mediaType: string; filename?: string }> = [
              { type: 'text', text: trimmedText },
            ];

            attachments?.forEach((attachment) => {
              parts.push({
                type: 'file',
                url: attachment.url,
                mediaType: attachment.mimeType,
                filename: attachment.originalName,
              });
            });

            if (!conversationId) {
              setIsPreparingFirstSend(true);
              setPendingFirstMessage({
                message: trimmedText,
                attachments: attachments as ChatPageShellAttachment[] | undefined,
                UIModelId: currentUIModelId,
                mode: currentModeId,
              });

              try {
                await createTemporaryConversation(trimmedText.slice(0, 256));
              } catch {
                setPendingFirstMessage(null);
                setIsPreparingFirstSend(false);
                toast.error('Unable to start temporary chat. Please try again.');
              }
              return;
            }

            try {
              sendMessage(
                { parts },
                {
                  body: {
                    id: conversationId,
                    UIModelId: currentUIModelId,
                    mode: currentModeId,
                    previousMessageId: getLastRealMessageId(displayedMessages),
                  },
                }
              );
            } catch {
              toast.error('Unable to start temporary chat. Please try again.');
            }
          }}
          onSubmitEditedMessage={({ parts, previousMessageId, currentUIModelId, currentModeId, sendMessage }) => {
            if (!conversationId) {
              return;
            }

            sendMessage(
              { parts },
              {
                body: { id: conversationId, UIModelId: currentUIModelId, mode: currentModeId, previousMessageId },
              }
            );
          }}
          onSubmitRegeneratedMessage={({ messageId, currentUIModelId, currentModeId, regenerate }) => {
            if (!conversationId) {
              return;
            }

            regenerate({
              messageId,
              body: { id: conversationId, UIModelId: currentUIModelId, mode: currentModeId },
            });
          }}
          canSendMessages={!!hasAllowance}
          canMutateMessages={!!hasAllowance && !!conversationId}
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
