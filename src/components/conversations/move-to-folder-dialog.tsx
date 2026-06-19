'use client';

import { Loader2, FolderInput } from 'lucide-react';
import { useFolders, useMoveToFolder } from '@/hooks/use-folders';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface MoveToFolderDialogProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Shared move-to-folder dialog. Folders are fetched lazily (only while open and
 * a target conversation is set) so opening the dialog never costs a request
 * otherwise. Used by both the chat header and the sidebar.
 */
export function MoveToFolderDialog({
  conversationId,
  open,
  onOpenChange,
}: MoveToFolderDialogProps) {
  const enabled = open && !!conversationId;
  const { data: foldersData, isPending: foldersLoading } = useFolders({ enabled });
  const moveToFolder = useMoveToFolder();
  const folders = foldersData?.folders ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Move to Folder</DialogTitle>
          <DialogDescription>Select a folder to move this conversation to.</DialogDescription>
        </DialogHeader>
        <div className="max-h-75 space-y-2 overflow-y-auto py-4">
          {foldersLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading folders...</span>
            </div>
          ) : folders.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No folders yet. Create one first.</p>
          ) : (
            folders.map((folder) => (
              <button
                key={folder.id}
                className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  if (conversationId) {
                    moveToFolder.mutate({ conversationId, folderId: folder.id });
                  }
                  onOpenChange(false);
                }}
              >
                <FolderInput className="size-4" style={{ color: folder.color || undefined }} />
                <span>{folder.name}</span>
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
