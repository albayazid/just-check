'use client';
import ChatInput from '@/components/chat-input';
import BrandHeader from '@/components/common/brand-header';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { MessageCircleDashed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCreateConversation } from '@/hooks/use-conversations';
import { useConversationStarterStore } from '@/stores/message-store';
import { useSubscriptionAndAllowanceStatus } from '@/hooks/use-subscription-and-allowance';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function MainClient() {
  const createConversation = useCreateConversation();
  const setConversationStarter = useConversationStarterStore((state) => state.setConversationStarter);
  const [isLoading, setIsLoading] = useState(false);
  const [currentUIModelId, setCurrentUIModelId] = useState<string>('fast');
  const { planId, hasAllowance, remainingPercentage, periodEnd, isLoading: isLoadingAllowance } = useSubscriptionAndAllowanceStatus();

  const handleSubmit = (message: string, attachments?: Array<{ url: string; originalName: string; mimeType: string }>) => {
    if (!message.trim()) return;

    // Block submission if user has no allowance
    if (!hasAllowance) return;

    setIsLoading(true);

    setConversationStarter({ message: message.trim(), UIModelId: currentUIModelId, attachments });

    // Use first 256 characters of the message as the conversation title
    const title = message.trim().slice(0, 256);
    createConversation.mutate({ title }, {
      onError: () => {
        setIsLoading(false);
      },
    });
  };

  // Cleanup: reset loading state if component unmounts during mutation
  useEffect(() => {
    return () => {
      setIsLoading(false);
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      <BrandHeader>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/chats/temporary"
                className="p-2 text-foreground transition-colors hover:bg-accent hover:text-foreground/80 rounded-lg"
                aria-label="Start temporary chat"
              >
                <MessageCircleDashed size={20} />
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              <p>Temporary Chat</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </BrandHeader>

      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="mb-8 text-center"
        >
          <div className="text-2xl md:text-3xl h-10 md:h-12 font-bold bg-clip-text text-foreground">
            Need anything? Just ask me.
          </div>
        </motion.div>

        <motion.div
          layoutId="chat-input-container"
          className="w-full max-w-3xl"
        >
          <ChatInput
            onSubmit={handleSubmit}
            isLoading={isLoading}
            placeholder="Type your message..."
            selectedUIModelId={currentUIModelId}
            onUIModelChange={setCurrentUIModelId}
            planId={planId}
            hasAllowance={hasAllowance}
            remainingPercentage={remainingPercentage}
            allowanceResetTime={periodEnd}
            isLoadingAllowance={isLoadingAllowance}
          />
        </motion.div>
      </div>
    </div>
  );
}
