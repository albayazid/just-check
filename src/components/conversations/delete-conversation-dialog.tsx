'use client';

import { useDeleteConversation } from '@/hooks/use-conversations';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface DeleteConversationDialogProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Shared delete-confirmation dialog. Owns the mutation so callers only need to
 * drive `open` + `conversationId`. Used by both the chat header and the sidebar.
 */
export function DeleteConversationDialog({
  conversationId,
  open,
  onOpenChange,
}: DeleteConversationDialogProps) {
  const deleteConversation = useDeleteConversation();

  const handleDelete = () => {
    if (conversationId) {
      deleteConversation.mutate(conversationId);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete Chat, Sure?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete this conversation and all its messages.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-3 sm:justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
