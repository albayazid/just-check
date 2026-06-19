'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  FolderInput,
  Menu,
  MessageCirclePlus,
  MoreHorizontal,
  PencilLine,
  Pin,
  PinOff,
  Trash2,
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

interface ChatPageHeaderProps {
  chatId: string;
}

/**
 * Page-mounted header for a real conversation: inline-renameable title plus the
 * conversation actions (rename, pin/unpin, archive, move to folder, delete).
 *
 * Layout: [toggle] [title · inline rename] .... [new-chat mobile] [⋮]
 */
export default function ChatPageHeader({ chatId }: ChatPageHeaderProps) {
  const isMobile = useIsMobile();
  const { toggleSidebar } = useSidebar();
  const { data, isPending } = useConversation(chatId);
  const renameConversation = useRenameConversation();
  const pinConversation = usePinConversation();
  const archiveConversation = useArchiveConversation();
  const { data: pinnedCountData } = usePinnedCount();

  const title = data?.title ?? null;
  const isPinned = !!data?.pinned_at;
  const canPin = pinnedCountData?.canPin ?? true;

  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
            disabled={renameConversation.isPending}
            className="h-8 min-w-0 flex-1"
            placeholder="Enter conversation title"
          />
        ) : (
          <button
            type="button"
            onClick={isPending ? undefined : startEditing}
            title={title || 'Untitled Conversation'}
            className="flex h-8 min-w-0 flex-1 items-center text-left text-sm font-medium text-foreground/90 hover:text-foreground md:text-base"
          >
            {isPending ? (
              <Skeleton className="h-4 w-40" />
            ) : (
              <span className="truncate">{title || 'Untitled Conversation'}</span>
            )}
          </button>
        )}

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
          <DropdownMenuContent side="bottom" align="end" className="min-w-45">
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
            <DropdownMenuItem onSelect={() => archiveConversation.mutate({ conversationId: chatId, archived: true })}>
              <Archive /> Archive
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
