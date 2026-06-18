"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useIsTouchDevice } from '@/hooks/use-touch-device';
import { useConversations, usePinnedConversations, useDeleteConversation, useRenameConversation, usePinConversation, useArchiveConversation, usePinnedCount } from '@/hooks/use-conversations';
import { useFolders, useCreateFolder, useUpdateFolder, useDeleteFolder, useMoveToFolder, useFolderLimit } from '@/hooks/use-folders';
import { useSubscription } from '@/hooks/use-subscription';
import { getPlanDisplayName } from '@/lib/subscription-utils';
import { useUser, useAuth } from '@clerk/nextjs';
import {
  SquarePen,
  Sparkles,
  MoreHorizontal,
  PencilLine,
  Trash2,
  HelpCircle,
  Settings,
  User,
  ChevronDown,
  LogOut,
  Loader2,
  Crown,
  Pin,
  PinOff,
  Archive,
  FolderPlus,
  FolderInput,
  ChevronRight,
  Folder,
  FolderOpen,
  CircleEllipsis,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderDialog } from '@/components/folder-dialog';
import type { StoredConversation, ConversationFolder } from '@/lib/chat-history';

const MENU_ACTION_HOVER_REVEAL =
  'opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground data-[state=open]:opacity-100';

// ============================================================================
// ChatSidebar — shadcn/ui (Radix) sidebar, collapsible="icon".
//
// Collapse is driven entirely by shadcn's <Sidebar> (desktop width + mobile
// sheet). <SidebarProvider> (in the layout) owns open/openMobile. We read
// isMobile/setOpenMobile here to close the drawer after navigating on mobile.
//
// All real hooks (Clerk, TanStack Query) and dialogs are preserved verbatim
// from the previous manual implementation; only the markup + collapse model
// changed to shadcn primitives.
// ============================================================================
function ChatSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoaded } = useUser();
  const { signOut } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const isTouchDevice = useIsTouchDevice();

  // Current conversation id from the URL
  const activeConversationId = useMemo(() => {
    const match = pathname.match(/^\/chats\/([a-f0-9-]{36})$/i);
    return match ? match[1] : null;
  }, [pathname]);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  // Dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [conversationToRename, setConversationToRename] = useState<StoredConversation | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [moveToFolderDialogOpen, setMoveToFolderDialogOpen] = useState(false);
  const [conversationToMove, setConversationToMove] = useState<string | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderToEdit, setFolderToEdit] = useState<ConversationFolder | null>(null);
  const [folderDialogError, setFolderDialogError] = useState<string | null>(null);
  const [deleteFolderDialogOpen, setDeleteFolderDialogOpen] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);

  // Chat history (TanStack Query)
  const { data, fetchNextPage, hasNextPage, isPending, isFetchingNextPage } = useConversations();
  const { data: pinnedData } = usePinnedConversations();
  const deleteConversation = useDeleteConversation();
  const renameConversation = useRenameConversation();
  const pinConversation = usePinConversation();
  const archiveConversation = useArchiveConversation();
  const { data: pinnedCountData } = usePinnedCount();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Folders
  const [foldersExpanded, setFoldersExpanded] = useState(false);
  const shouldFetchFolders = foldersExpanded || moveToFolderDialogOpen;
  const { data: foldersData, isPending: foldersLoading } = useFolders({ enabled: shouldFetchFolders });
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const moveToFolder = useMoveToFolder();
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  const { data: folderLimitData } = useFolderLimit({ enabled: foldersExpanded });

  const folders = foldersData?.folders || [];
  const canPin = pinnedCountData?.canPin ?? true;
  const canCreateFolder = folderLimitData?.canCreate ?? true;
  const folderCount = folderLimitData?.count ?? 0;
  const folderLimit = folderLimitData?.limit ?? 1;

  // Subscription
  const { data: subscription, isLoading: subscriptionLoading } = useSubscription();
  const hasActiveSubscription = subscription && subscription.planId !== 'free';
  const subscriptionButtonLabel = hasActiveSubscription
    ? getPlanDisplayName(subscription.planId)
    : 'Upgrade';
  const subscriptionButtonHref = hasActiveSubscription ? '/settings/usage' : '/upgrade';

  const regularConversations = useMemo(() => {
    if (!data) return [];
    return data.pages.flatMap((page) => page.conversations);
  }, [data]);

  const pinnedConversations = useMemo(() => {
    if (!pinnedData) return [];
    return pinnedData.pages.flatMap((page) => page.conversations);
  }, [pinnedData]);

  // Infinite scroll
  const loadMoreRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) fetchNextPage();
      },
      { root: scrollContainerRef.current, rootMargin: '100px', threshold: 0 }
    );
    const currentRef = loadMoreRef.current;
    if (currentRef) observer.observe(currentRef);
    return () => {
      if (currentRef) observer.unobserve(currentRef);
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    if (!isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const closeMobile = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const navigate = useCallback((href: string) => {
    router.push(href);
    closeMobile();
  }, [router, closeMobile]);

  return (
    <Sidebar collapsible="icon">
      {/* ------------------------------------------------------------ */}
      {/* Header: brand + trigger, then New Chat                       */}
      {/* ------------------------------------------------------------ */}
      <SidebarHeader>
        <div className="relative flex h-8 items-center px-2">
          <span className="text-xl font-semibold tracking-tight text-sidebar-foreground transition-opacity duration-200 group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0">
            Lumy
          </span>
          <SidebarTrigger className="absolute right-0 text-muted-foreground hover:text-sidebar-foreground" />
        </div>

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="New Chat"
              onClick={() => navigate('/')}
              className="pl-0 group-data-[collapsible=icon]:pl-0! bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground [&_svg]:size-5"
            >
              <div className="flex aspect-square size-8 items-center justify-center">
                <SquarePen />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">New Chat</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* ------------------------------------------------------------ */}
      {/* Content — fades out entirely when collapsed                  */}
      {/* ------------------------------------------------------------ */}
      <SidebarContent
        ref={scrollContainerRef}
        className={cn(
          'gap-0',
          '**:data-[sidebar=group]:py-1',
          'transition-opacity duration-200 ease-linear',
          'group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0'
        )}
      >
        {/* Folders */}
        <SidebarGroup>
          <SidebarGroupLabel asChild>
            <button
              type="button"
              onClick={() => setFoldersExpanded((v) => !v)}
              className="flex w-full items-center gap-1"
            >
              <ChevronRight
                className={cn('size-4 shrink-0 transition-transform duration-200', foldersExpanded && 'rotate-90')}
              />
              Folders
            </button>
          </SidebarGroupLabel>

          {foldersExpanded && (
            <SidebarMenu className="gap-0.5">
              {foldersLoading ? (
                [...Array(2)].map((_, i) => (
                  <SidebarMenuItem key={`folder-skeleton-${i}`}>
                    <Skeleton className="h-8 max-md:h-10 w-full" />
                  </SidebarMenuItem>
                ))
              ) : (
                <>
                  {folders.map((folder) => {
                    const isActive = pathname === `/folders/${folder.id}`;
                    return (
                      <SidebarMenuItem key={folder.id} className="rounded-md hover:bg-sidebar-accent">
                        <SidebarMenuButton
                          tooltip={folder.name}
                          isActive={isActive}
                          onClick={() => navigate(`/folders/${folder.id}`)}
                        >
                          {isActive ? (
                            <FolderOpen style={{ color: folder.color || undefined }} />
                          ) : (
                            <Folder style={{ color: folder.color || undefined }} />
                          )}
                          <span className="truncate">{folder.name}</span>
                        </SidebarMenuButton>
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuAction className={cn('hover:bg-sidebar!', !isTouchDevice && MENU_ACTION_HOVER_REVEAL)}>
                              <MoreHorizontal />
                              <span className="sr-only">Folder options</span>
                            </SidebarMenuAction>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="bottom" align="end" className="min-w-45">
                            <DropdownMenuItem
                              onSelect={() => {
                                setFolderToEdit(folder);
                                setFolderDialogError(null);
                                setFolderDialogOpen(true);
                              }}
                              >
                                <PencilLine /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => {
                                  setFolderToDelete(folder.id);
                                setDeleteFolderDialogOpen(true);
                              }}
                            >
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SidebarMenuItem>
                    );
                  })}

                  <SidebarMenuItem>
                    <SidebarMenuButton tooltip="All Folders" onClick={() => navigate('/folders')}>
                      <CircleEllipsis />
                      <span className="truncate">All Folders</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  <SidebarMenuItem>
                    {canCreateFolder ? (
                      <SidebarMenuButton
                        tooltip="New Folder"
                        onClick={() => {
                          setFolderToEdit(null);
                          setFolderDialogError(null);
                          setFolderDialogOpen(true);
                        }}
                      >
                        <FolderPlus />
                        <span className="truncate">New Folder</span>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton tooltip="New Folder" asChild>
                        <Link href="/upgrade" onClick={closeMobile} className="justify-between">
                          <div className="flex min-w-0 items-center gap-2 opacity-50">
                            <FolderPlus className="size-4 shrink-0" />
                            <span className="truncate">New Folder</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1 text-xs">
                            <HoverCard>
                              <HoverCardTrigger asChild>
                                <span className="rounded-lg border border-muted-foreground/80 px-1 py-0.5 text-muted-foreground/80">{folderCount}/{folderLimit}</span>
                              </HoverCardTrigger>
                              <HoverCardContent side="bottom" align="end" className="w-64">
                                <p className="text-sm">
                                  You&apos;ve reached your folder creation limit for your current plan. <Link href="/upgrade" className="font-medium text-blue-500 hover:text-blue-600">Upgrade</Link> to create more folders.
                                </p>
                              </HoverCardContent>
                            </HoverCard>
                            <span className="rounded-lg border border-blue-500 px-1 py-0.5 text-blue-500 transition-colors hover:bg-blue-500/10">Upgrade</span>
                          </div>
                        </Link>
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                </>
              )}
            </SidebarMenu>
          )}
        </SidebarGroup>

        {/* Pinned */}
        {pinnedConversations.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Pinned</SidebarGroupLabel>
            <SidebarMenu className="gap-0.5">
              {pinnedConversations.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === activeConversationId}
                  isTouchDevice={isTouchDevice}
                  canPin={canPin}
                  onNavigate={() => navigate(`/chats/${conversation.id}`)}
                  onRename={() => {
                    setConversationToRename(conversation);
                    setNewTitle(conversation.title || '');
                    setRenameDialogOpen(true);
                  }}
                  onDelete={() => {
                    setConversationToDelete(conversation.id);
                    setDeleteDialogOpen(true);
                  }}
                  onPin={() => pinConversation.mutate({ conversationId: conversation.id, pinned: false })}
                  onArchive={() => archiveConversation.mutate({ conversationId: conversation.id, archived: true })}
                  onMoveToFolder={() => {
                    setConversationToMove(conversation.id);
                    setMoveToFolderDialogOpen(true);
                  }}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {/* Chat history */}
        <SidebarGroup className="flex-1">
          <SidebarGroupLabel>Chat History</SidebarGroupLabel>
          <SidebarMenu className="gap-0.5">
            {isPending ? (
              [...Array(3)].map((_, i) => (
                <SidebarMenuItem key={`pending-${i}`}>
                  <Skeleton className="h-8 max-md:h-10 w-full" />
                </SidebarMenuItem>
              ))
            ) : regularConversations.length === 0 && pinnedConversations.length === 0 ? (
              <p className="px-2 py-2 text-center text-sm text-muted-foreground">No chat history</p>
            ) : regularConversations.length === 0 ? (
              <p className="px-2 py-2 text-center text-sm text-muted-foreground">No more chats</p>
            ) : (
              <>
                {regularConversations.map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isActive={conversation.id === activeConversationId}
                    isTouchDevice={isTouchDevice}
                    canPin={canPin}
                    onNavigate={() => navigate(`/chats/${conversation.id}`)}
                    onRename={() => {
                      setConversationToRename(conversation);
                      setNewTitle(conversation.title || '');
                      setRenameDialogOpen(true);
                    }}
                    onDelete={() => {
                      setConversationToDelete(conversation.id);
                      setDeleteDialogOpen(true);
                    }}
                    onPin={() => pinConversation.mutate({ conversationId: conversation.id, pinned: true })}
                    onArchive={() => archiveConversation.mutate({ conversationId: conversation.id, archived: true })}
                    onMoveToFolder={() => {
                      setConversationToMove(conversation.id);
                      setMoveToFolderDialogOpen(true);
                    }}
                  />
                ))}

                {hasNextPage &&
                  [...Array(3)].map((_, i) => (
                    <SidebarMenuItem key={`more-${i}`} ref={i === 2 ? loadMoreRef : undefined}>
                      <Skeleton className="h-8 max-md:h-10 w-full" />
                    </SidebarMenuItem>
                  ))}
                {!hasNextPage && !isPending && regularConversations.length > 0 && (
                  <p className="px-2 pt-2 text-center text-xs text-muted-foreground">End of history</p>
                )}
              </>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      {/* ------------------------------------------------------------ */}
      {/* Footer: upgrade + account (both collapse to icons)          */}
      {/* ------------------------------------------------------------ */}
      <SidebarFooter>
        <SidebarMenu className="gap-1">
          {/* Subscription / upgrade */}
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={subscriptionLoading ? 'Loading...' : subscriptionButtonLabel}
              disabled={subscriptionLoading}
              onClick={() => navigate(subscriptionButtonHref)}
              className={cn(
                'pl-0 group-data-[collapsible=icon]:pl-0!',
                'bg-linear-to-r from-purple-600 to-indigo-600 text-white shadow-sm',
                'hover:from-purple-700 hover:to-indigo-700 hover:text-white [&_svg]:size-5',
                subscriptionLoading && 'opacity-70'
              )}
            >
              <div className="flex aspect-square size-8 items-center justify-center">
                {subscriptionLoading ? (
                  <Loader2 className="animate-spin" />
                ) : hasActiveSubscription ? (
                  <Crown />
                ) : (
                  <Sparkles />
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {subscriptionLoading ? 'Loading...' : subscriptionButtonLabel}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Account */}
          <SidebarMenuItem>
            {!isLoaded ? (
              <div className="flex h-8 items-center gap-2 rounded-md px-2">
                <Skeleton className="size-8 rounded-lg" />
                <Skeleton className="h-4 w-24" />
              </div>
            ) : (
              <DropdownMenu modal={false} open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    className={cn(
                      'pl-0 pr-2 max-md:pl-1 group-data-[collapsible=icon]:px-0!',
                      accountMenuOpen && 'bg-sidebar-accent text-sidebar-accent-foreground'
                    )}
                  >
                    <Avatar className="size-8 rounded-lg">
                      <AvatarImage src={user?.imageUrl} alt="User avatar" />
                      <AvatarFallback className="rounded-lg bg-secondary text-secondary-foreground">
                        <User className="size-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{user?.fullName || 'User Name'}</span>
                    </div>
                    <ChevronDown
                      className={cn(
                        'size-4 transition-transform duration-200',
                        accountMenuOpen && 'rotate-180'
                      )}
                    />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-72">
                  <DropdownMenuItem onSelect={() => navigate('/settings/general')}>
                    <Settings /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate('/feedback')}>
                    <HelpCircle /> Feedback
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => signOut()}>
                    <LogOut /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />

      {/* ---------------------------------------------------------- */}
      {/* Dialogs                                                    */}
      {/* ---------------------------------------------------------- */}

      {/* Delete conversation */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setConversationToDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Chat, Sure?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete this conversation and all its messages.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3 sm:justify-end">
            <Button variant="secondary" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (conversationToDelete) {
                  deleteConversation.mutate(conversationToDelete);
                }
                setDeleteDialogOpen(false);
                setConversationToDelete(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename conversation */}
      <Dialog
        open={renameDialogOpen}
        onOpenChange={(open) => {
          setRenameDialogOpen(open);
          if (!open) {
            setConversationToRename(null);
            setNewTitle('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
            <DialogDescription>Enter a new name for this conversation.</DialogDescription>
          </DialogHeader>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Enter conversation title"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTitle.trim()) {
                if (conversationToRename) {
                  renameConversation.mutate({
                    conversationId: conversationToRename.id,
                    newTitle: newTitle.trim(),
                  });
                }
                setRenameDialogOpen(false);
                setConversationToRename(null);
                setNewTitle('');
              }
            }}
          />
          <DialogFooter className="gap-3 sm:justify-end">
            <Button variant="secondary" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newTitle.trim()}
              onClick={() => {
                if (conversationToRename && newTitle.trim()) {
                  renameConversation.mutate({
                    conversationId: conversationToRename.id,
                    newTitle: newTitle.trim(),
                  });
                }
                setRenameDialogOpen(false);
                setConversationToRename(null);
                setNewTitle('');
              }}
            >
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder create / edit */}
      <FolderDialog
        open={folderDialogOpen}
        onOpenChange={(open) => {
          setFolderDialogOpen(open);
          if (!open) {
            setFolderToEdit(null);
            setFolderDialogError(null);
          }
        }}
        folder={folderToEdit}
        isLoading={createFolder.isPending || updateFolder.isPending}
        error={folderDialogError}
        onSubmit={(name, color) => {
          setFolderDialogError(null);
          if (folderToEdit) {
            updateFolder.mutate(
              { folderId: folderToEdit.id, name, color: color || null },
              {
                onSuccess: () => {
                  setFolderDialogOpen(false);
                  setFolderToEdit(null);
                },
                onError: (err) => setFolderDialogError(err.message),
              }
            );
          } else {
            createFolder.mutate(
              { name, color },
              {
                onSuccess: () => {
                  setFolderDialogOpen(false);
                },
                onError: (err) => setFolderDialogError(err.message),
              }
            );
          }
        }}
      />

      {/* Delete folder */}
      <Dialog
        open={deleteFolderDialogOpen}
        onOpenChange={(open) => {
          setDeleteFolderDialogOpen(open);
          if (!open) setFolderToDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Folder?</DialogTitle>
            <DialogDescription>
              This will permanently delete the folder and all chats inside it. To keep your chats, move them to another folder or back to your regular chat list before deleting.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3 sm:justify-end">
            <Button variant="secondary" onClick={() => setDeleteFolderDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (folderToDelete) {
                  deleteFolder.mutate(folderToDelete);
                  if (activeFolderId === folderToDelete) {
                    setActiveFolderId(null);
                  }
                }
                setDeleteFolderDialogOpen(false);
                setFolderToDelete(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to folder */}
      <Dialog
        open={moveToFolderDialogOpen}
        onOpenChange={(open) => {
          setMoveToFolderDialogOpen(open);
          if (!open) setConversationToMove(null);
        }}
      >
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
                    if (conversationToMove) {
                      moveToFolder.mutate({ conversationId: conversationToMove, folderId: folder.id });
                    }
                    setMoveToFolderDialogOpen(false);
                    setConversationToMove(null);
                  }}
                >
                  <FolderInput className="size-4" style={{ color: folder.color || undefined }} />
                  <span>{folder.name}</span>
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setMoveToFolderDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}

// ============================================================================
// Conversation item
// ============================================================================
interface ConversationItemProps {
  conversation: StoredConversation;
  isActive: boolean;
  isTouchDevice: boolean;
  canPin: boolean;
  onNavigate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onPin: () => void;
  onArchive: () => void;
  onMoveToFolder: () => void;
}

function ConversationItem({
  conversation,
  isActive,
  isTouchDevice,
  canPin,
  onNavigate,
  onRename,
  onDelete,
  onPin,
  onArchive,
  onMoveToFolder,
}: ConversationItemProps) {
  const isPinned = !!conversation.pinned_at;

  return (
    <SidebarMenuItem className="rounded-md hover:bg-sidebar-accent">
      <SidebarMenuButton
        isActive={isActive}
        tooltip={conversation.title || 'Untitled Conversation'}
        onClick={onNavigate}
      >
        {isPinned && <Pin className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="truncate">{conversation.title || 'Untitled Conversation'}</span>
      </SidebarMenuButton>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction className={cn('hover:bg-sidebar!', !isTouchDevice && MENU_ACTION_HOVER_REVEAL)}>
            <MoreHorizontal />
            <span className="sr-only">Chat options</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" className="min-w-45">
          <DropdownMenuItem onSelect={onRename}>
            <PencilLine /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onPin}
            disabled={!isPinned && !canPin}
            title={!isPinned && !canPin ? 'Max 5 pinned chats' : undefined}
          >
            {isPinned ? <PinOff /> : <Pin />}
            {isPinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onArchive}>
            <Archive /> Archive
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onMoveToFolder}>
            <FolderInput /> Move to folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

export default ChatSidebar;
