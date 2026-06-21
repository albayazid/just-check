'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ShareDialog } from '@/components/chat/share-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ShareButtonProps {
  conversationId: string;
  currentLeafMessageId: string | null;
}

export function ShareButton({
  conversationId,
  currentLeafMessageId,
}: ShareButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDialogOpen(true)}
          >
            <Share2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Share conversation</p>
        </TooltipContent>
      </Tooltip>

      <ShareDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        conversationId={conversationId}
        currentLeafMessageId={currentLeafMessageId}
      />
    </>
  );
}
