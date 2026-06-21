'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Archive,
  ArchiveRestore,
  Check,
  FolderInput,
  Menu,
  MessageCirclePlus,
  MoreHorizontal,
  PencilLine,
  Pin,
  PinOff,
  Trash2,
  X,
} from 'lucide-react';
import { useConversation } from '@/hooks/use-conversation';
import {
  useArchiveConversation,
  usePinConversation,
  usePinnedCount,
  useRenameConversation,
} from '@/hooks/use-conversations';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/sidebar';
import { DeleteConversationDialog } from '@/components/conversations/delete-conversation-dialog';
import { MoveToFolderDialog } from '@/components/conversations/move-to-folder-dialog';
import { ShareButton } from '@/components/chat/share-button';

interface ChatPageHeaderProps {
  chatId: string;
  /** Leaf message id of the currently visible thread (for "visible thread" share). */
  currentLeafMessageId: string | null;
}

/**
 * Page-mounted header for a real conversation: inline-renameable title plus the
 * conversation actions (rename, pin/unpin, archive, move to folder, delete).
 *
 * Layout: [toggle] [title · inline rename] .... [new-chat mobile] [⋮]
 */
export default function ChatPageHeader({ chatId, currentLeafMessageId }: ChatPageHeaderProps) {
  const isMobile = useIsMobile();
  const { toggleSidebar } = useSidebar();
  const { data, isPending } = useConversation(chatId);
  const renameConversation = useRenameConversation();
  const pinConversation = usePinConversation();
  const archiveConversation = useArchiveConversation();
  const { data: pinnedCountData } = usePinnedCount();
  const queryClient = useQueryClient();

  const title = data?.title ?? null;
  const isPinned = !!data?.pinned_at;
  const isArchived = !!data?.archived_at;
  const canPin = pinnedCountData?.canPin ?? true;

  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set on Rename, cleared on close — tells onCloseAutoFocus to skip returning
  // focus to the ⋮ so the rename input keeps it (Rename only).
  const renameJustStarted = useRef(false);

  // Derive the displayed title straight from the query (always fresh — the
  // optimistic rename cache update keeps this in sync) and only hold a draft
  // while actively editing, so an external rename never leaves a stale title.
  useEffect(() => {
    if (!isEditing) return;
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [isEditing]);

  const startEditing = () => {
    setDraftTitle(title || '');
    setIsEditing(true);
    renameJustStarted.current = true;
  };

  const commitRename = () => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== (title || '')) {
      renameConversation.mutate({ conversationId: chatId, newTitle: trimmed });
    }
    setIsEditing(false);
  };

  const cancelRename = () => {
    setDraftTitle(title || '');
    setIsEditing(false);
  };

  return (
    <header className="flex h-header-height shrink-0 items-center bg-background px-1 text-foreground sm:px-2">
      <div className="flex w-full items-center gap-1">
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-2 text-foreground hover:text-foreground/80 md:hidden"
          aria-label="Toggle Sidebar"
        >
          <Menu size={24} />
        </button>

        <div className="flex items-center gap-1 mr-auto">
          {/* Width declared once here; the ✓/✕ below sit OUTSIDE this slot so they
              don't eat into it, keeping the input's right edge aligned with the title's. */}
          <div className="flex h-8 min-w-0 items-center px-2 w-[45vw] sm:w-104">
            {isEditing ? (
              <Input
                ref={inputRef}
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                className="h-8 w-full min-w-0"
                placeholder="Enter conversation title"
              />
            ) : (
              <button
                type="button"
                onClick={isPending ? undefined : startEditing}
                title={title || 'Untitled Conversation'}
                className="flex h-8 max-w-full min-w-0 items-center text-left text-sm font-medium text-foreground/90 hover:text-foreground md:text-base"
              >
                {isPending ? (
                  <Skeleton className="h-4 w-40" />
                ) : (
                  <span className="truncate">{title || 'Untitled Conversation'}</span>
                )}
              </button>
            )}
          </div>

          {isEditing && (
            <>
              <button
                type="button"
                // Prevent blur so commit fires once (via click) instead of twice (blur + click).
                onMouseDown={(e) => e.preventDefault()}
                onClick={commitRename}
                aria-label="Save title"
                className="rounded-md p-1.5 text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={cancelRename}
                aria-label="Cancel rename"
                className="rounded-md p-1.5 text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {isMobile && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/"
                  aria-label="New chat"
                  className="rounded-lg p-2 text-foreground transition-colors hover:bg-accent hover:text-foreground/80"
                >
                  <MessageCirclePlus size={20} />
                </Link>
              </TooltipTrigger>
              <TooltipContent>
                <p>New chat</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <ShareButton
          conversationId={chatId}
          currentLeafMessageId={currentLeafMessageId}
        />

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Chat actions"
              className="rounded-lg p-2 text-foreground transition-colors hover:bg-accent hover:text-foreground/80"
            >
              <MoreHorizontal size={20} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="end"
            className="min-w-45"
            onCloseAutoFocus={(e) => {
              // Only block focus-return when Rename was just chosen — otherwise let
              // Pin/Unpin/etc. return focus to the ⋮ as normal.
              if (renameJustStarted.current) {
                renameJustStarted.current = false;
                e.preventDefault();
              }
            }}
          >
            <DropdownMenuItem onSelect={startEditing}>
              <PencilLine /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => pinConversation.mutate({ conversationId: chatId, pinned: !isPinned })}
              disabled={!isPinned && !canPin}
              title={!isPinned && !canPin ? 'Max 5 pinned chats' : undefined}
            >
              {isPinned ? <PinOff /> : <Pin />}
              {isPinned ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                archiveConversation.mutate(
                  { conversationId: chatId, archived: !isArchived },
                  {
                    onSuccess: () => {
                      // Refresh this chat's metadata so the header flips Archive↔Unarchive.
                      queryClient.invalidateQueries({ queryKey: ['conversation', chatId] });
                    },
                  },
                )
              }
            >
              {isArchived ? <ArchiveRestore /> : <Archive />}
              {isArchived ? 'Unarchive' : 'Archive'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
              <FolderInput /> Move to folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <DeleteConversationDialog conversationId={chatId} open={deleteOpen} onOpenChange={setDeleteOpen} />
      <MoveToFolderDialog conversationId={chatId} open={moveOpen} onOpenChange={setMoveOpen} />
    </header>
  );
}
