"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useIsMobile } from '@/hooks/use-mobile';
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
  PanelLeftOpen,
  PanelLeftClose,
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
  Dropdown,
  DropdownItem,
  DropdownSurface,
  DropdownTrigger
} from '@/components/experimental-components/Experimental_DropDown';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FolderDialog } from '@/components/folder-dialog';
import type { StoredConversation, ConversationFolder } from '@/lib/chat-history';

interface ChatSidebarProps {
  isMobileSidebarOpen: boolean;
  onMobileSidebarToggle: () => void;
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({ isMobileSidebarOpen, onMobileSidebarToggle }) => {
  const router = useRouter();
  const pathname = usePathname();
  const isTouchDevice = useIsTouchDevice();
  const { user, isLoaded } = useUser();
  const { signOut } = useAuth();

  // Extract the current conversation ID from the URL
  const activeConversationId = useMemo(() => {
    const match = pathname.match(/^\/chats\/([a-f0-9-]{36})$/i);
    return match ? match[1] : null;
  }, [pathname]);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [conversationToRename, setConversationToRename] = useState<StoredConversation | null>(null);
  const [newTitle, setNewTitle] = useState('');

  // Chat history state - managed by TanStack Query
  const { data, fetchNextPage, hasNextPage, isPending, isFetchingNextPage } = useConversations();
  const { data: pinnedData } = usePinnedConversations();
  const deleteConversation = useDeleteConversation();
  const renameConversation = useRenameConversation();
  const pinConversation = usePinConversation();
  const archiveConversation = useArchiveConversation();
  const { data: pinnedCountData } = usePinnedCount();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Folder state
  const [foldersExpanded, setFoldersExpanded] = useState(false);

  // Move to folder dialog state
  const [moveToFolderDialogOpen, setMoveToFolderDialogOpen] = useState(false);
  const [conversationToMove, setConversationToMove] = useState<string | null>(null);

  const shouldFetchFolders = foldersExpanded || moveToFolderDialogOpen;
  const { data: foldersData, isPending: foldersLoading } = useFolders({ enabled: shouldFetchFolders });
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const moveToFolder = useMoveToFolder();
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  // Folder dialog state
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderToEdit, setFolderToEdit] = useState<ConversationFolder | null>(null);
  const [folderDialogError, setFolderDialogError] = useState<string | null>(null);

  // Folder delete confirmation
  const [deleteFolderDialogOpen, setDeleteFolderDialogOpen] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);

  const folders = foldersData?.folders || [];
  const canPin = pinnedCountData?.canPin ?? true;
  const pinnedCount = pinnedCountData?.count ?? 0;

  const { data: folderLimitData } = useFolderLimit({ enabled: foldersExpanded });
  const canCreateFolder = folderLimitData?.canCreate ?? true;
  const folderCount = folderLimitData?.count ?? 0;
  const folderLimit = folderLimitData?.limit ?? 1;

  // Subscription data for dynamic upgrade button
  const { data: subscription, isLoading: subscriptionLoading } = useSubscription();

  // Determine subscription button state
  // Database already filters for active/on_hold subscriptions via get_user_subscription
  // If planId is 'free', user has no paid subscription
  const hasActiveSubscription = subscription && subscription.planId !== 'free';

  const subscriptionButtonLabel = hasActiveSubscription
    ? getPlanDisplayName(subscription.planId)
    : 'Upgrade';

  const subscriptionButtonHref = hasActiveSubscription
    ? '/settings/usage'
    : '/upgrade';

  // Flatten infinite query data for display
  const regularConversations = useMemo(() => {
    if (!data) return [];
    return data.pages.flatMap((page) => page.conversations);
  }, [data]);

  const pinnedConversations = useMemo(() => {
    if (!pinnedData) return [];
    return pinnedData.pages.flatMap((page) => page.conversations);
  }, [pinnedData]);

  // Infinite scroll logic using Intersection Observer
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          fetchNextPage();
        }
      },
      {
        root: scrollContainerRef.current,
        rootMargin: '100px',
        threshold: 0,
      }
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Close mobile sidebar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        if (isMobileSidebarOpen) {
          onMobileSidebarToggle();
        }
      }
    };

    if (isMobileSidebarOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMobileSidebarOpen, onMobileSidebarToggle]);

  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile) {
      setIsCollapsed(false);
    }
  }, [isMobile]);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
    if (!isCollapsed) {
      setAccountMenuOpen(false);
    }
  };

  const NavItem = ({
    icon: Icon,
    label,
    onClick,
    isCollapsed,
    className = "",
    isActive = false
  }: {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    onClick: () => void;
    isCollapsed: boolean;
    className?: string;
    isActive?: boolean;
  }) => (
    <button
      className={cn(
        "relative flex items-center h-10 rounded-lg transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)]",
        "text-sidebar-foreground hover:bg-accent",
        isActive ? "bg-accent" : "",
        className
      )}
      style={{
        width: isCollapsed ? '40px' : '100%',
        paddingLeft: isCollapsed ? '0' : '12px',
        paddingRight: isCollapsed ? '0' : '12px',
        justifyContent: isCollapsed ? 'center' : 'flex-start'
      }}
      onClick={onClick}
      aria-label={isCollapsed ? label : undefined}
    >
      <Icon
        size={20}
        className="shrink-0"
      />
      <span
        className={cn(
          "truncate whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)]",
          isCollapsed ? "opacity-0" : "opacity-100"
        )}
        style={{
          marginLeft: isCollapsed ? '0px' : '12px',
          width: isCollapsed ? '0px' : 'auto',
          overflow: 'hidden'
        }}
      >
        {label}
      </span>
    </button>
  );

  return (
    <div
      ref={sidebarRef}
      className={cn(
        "flex flex-col h-dvh bg-sidebar border-r border-border shadow-lg z-30",
        // Mobile styles
        "fixed inset-y-0",
        isMobileSidebarOpen ? "left-0" : "left-[-272px] md:left-0",
        // Desktop styles
        "md:relative"
      )}
      style={{
        width: isCollapsed ? '64px' : '272px',
        transition: 'width 300ms cubic-bezier(0.4, 0, 0.2, 1), left 300ms cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      {/* Top Section */}
      <div className="flex items-center border-b border-border h-16 shrink-0"
        style={{
          paddingLeft: isCollapsed ? '0' : '16px',
          paddingRight: isCollapsed ? '0' : '16px',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          transition: 'padding 300ms cubic-bezier(0.4, 0, 0.2, 1), justify-content 300ms cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        <h1
          className={cn(
            "text-xl font-semibold tracking-tight transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)] text-sidebar-foreground",
            isCollapsed ? "opacity-0" : "opacity-100"
          )}
          style={{
            width: isCollapsed ? '0' : 'auto',
            overflow: 'hidden',
            whiteSpace: 'nowrap'
          }}
        >
          Lumy
        </h1>
        <button
          onClick={toggleCollapse}
          className="text-muted-foreground p-1.5 rounded-md hover:bg-accent hover:text-sidebar-foreground transition-colors duration-200 hidden md:flex items-center justify-center shrink-0"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
      </div>

      {/* New Chat Button */}
      <div className="py-3 shrink-0"
        style={{
          paddingLeft: isCollapsed ? '12px' : '16px',
          paddingRight: isCollapsed ? '12px' : '16px',
          transition: 'padding 300ms cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        <button
          className={cn(
            "relative flex items-center h-10 rounded-lg transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)]",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "font-medium shadow-sm hover:shadow-md"
          )}
          style={{
            width: isCollapsed ? '40px' : '100%',
            paddingLeft: isCollapsed ? '0' : '12px',
            paddingRight: isCollapsed ? '0' : '12px',
            justifyContent: isCollapsed ? 'center' : 'flex-start'
          }}
          onClick={() => {
            router.push('/');
            if (isMobile) onMobileSidebarToggle();
          }}
        >
          <SquarePen size={20} className="shrink-0" />
          <span
            className={cn(
              "truncate whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)]",
              isCollapsed ? "opacity-0" : "opacity-100"
            )}
            style={{
              marginLeft: isCollapsed ? '0px' : '12px',
              width: isCollapsed ? '0px' : 'auto',
              overflow: 'hidden'
            }}
          >
            New Chat
          </span>
        </button>
      </div>

      {/* Main Content */}
      <div
        ref={scrollContainerRef}
        className="grow overflow-y-auto"
        style={{
          opacity: isCollapsed ? 0 : 1,
          transition: 'opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: isCollapsed ? 'none' : 'auto'
        }}
      >
        <div className="p-4 space-y-6">
          {/* Folders */}
          <div className="space-y-1">
            <button
              className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 hover:text-foreground transition-colors w-full"
              onClick={() => setFoldersExpanded(!foldersExpanded)}
            >
              <ChevronRight
                size={14}
                className={cn(
                  "transition-transform duration-200",
                  foldersExpanded && "rotate-90"
                )}
              />
              Folders
            </button>
            {foldersExpanded && (
              <div className="space-y-1">
                {foldersLoading ? (
                  <>
                    <Skeleton className="h-9 w-full rounded-md" />
                    <Skeleton className="h-9 w-full rounded-md" />
                  </>
                ) : (
                <>
                {folders.map((folder) => {
                  const folderColor = folder.color || undefined;
                  const isActive = pathname === `/folders/${folder.id}`;

                  return (
                    <div
                      key={folder.id}
                      className={cn(
                        "group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-colors duration-200",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-foreground"
                          : "hover:bg-sidebar-accent"
                      )}
                      style={{
                        width: isCollapsed ? '40px' : '100%',
                        paddingLeft: isCollapsed ? '0' : '8px',
                        paddingRight: isCollapsed ? '0' : '8px',
                        justifyContent: isCollapsed ? 'center' : 'space-between',
                      }}
                      tabIndex={0}
                      role="button"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          router.push(`/folders/${folder.id}`);
                          if (isMobile) onMobileSidebarToggle();
                        }
                      }}
                      onClick={() => {
                        router.push(`/folders/${folder.id}`);
                        if (isMobile) onMobileSidebarToggle();
                      }}
                      title={isCollapsed ? folder.name : undefined}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isActive ? (
                          <FolderOpen
                            size={18}
                            className="shrink-0"
                            style={{ color: folderColor }}
                          />
                        ) : (
                          <Folder
                            size={18}
                            className="shrink-0"
                            style={{ color: folderColor }}
                          />
                        )}
                        <span
                          className={cn(
                            "truncate text-sm transition-all duration-300",
                            isCollapsed ? "opacity-0 w-0" : "opacity-100"
                          )}
                        >
                          {folder.name}
                        </span>
                      </div>

                      {!isCollapsed && (
                        <Dropdown align="left">
                          <DropdownTrigger asChild>
                            <button
                              className={cn(
                                isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                                'p-1 -mr-1 rounded-md hover:bg-sidebar transition-all duration-200'
                              )}
                              tabIndex={0}
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Folder options"
                            >
                              <MoreHorizontal size={16} className="text-sidebar-foreground" />
                            </button>
                          </DropdownTrigger>
                          <DropdownSurface className="bg-popover border border-border text-popover-foreground min-w-[180px] shadow-lg">
                            <DropdownItem
                              icon={<PencilLine size={16} />}
                              className="flex items-center gap-2 p-2 hover:bg-accent hover:text-accent-foreground transition-colors duration-200"
                              onSelect={() => {
                                setFolderToEdit(folder);
                                setFolderDialogError(null);
                                setFolderDialogOpen(true);
                              }}
                            >
                              Edit
                            </DropdownItem>
                            <DropdownItem
                              icon={<Trash2 size={16} />}
                              className="flex items-center gap-2 p-2 text-destructive focus:bg-destructive/10! transition-colors duration-200"
                              onSelect={() => {
                                setFolderToDelete(folder.id);
                                setDeleteFolderDialogOpen(true);
                              }}
                            >
                              Delete
                            </DropdownItem>
                          </DropdownSurface>
                        </Dropdown>
                      )}
                    </div>
                  );
                })}
                <div
                  className={cn(
                    "group flex items-center justify-between h-10 px-2 py-1.5 rounded-md cursor-pointer transition-colors duration-200",
                    "hover:bg-sidebar-accent"
                  )}
                  style={{
                    width: isCollapsed ? '40px' : '100%',
                    paddingLeft: isCollapsed ? '0' : '8px',
                    paddingRight: isCollapsed ? '0' : '8px',
                    justifyContent: isCollapsed ? 'center' : 'space-between',
                  }}
                  tabIndex={0}
                  role="button"
                  onClick={() => {
                    router.push('/folders');
                    if (isMobile) onMobileSidebarToggle();
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CircleEllipsis
                      size={18}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span
                      className={cn(
                        "truncate text-sm transition-all duration-300",
                        isCollapsed ? "opacity-0 w-0" : "opacity-100"
                      )}
                    >
                      All Folders
                    </span>
                  </div>
                </div>

                {/* New Folder Button */}
                <div
                  className={cn(
                    "group flex items-center justify-between h-10 px-2 py-1.5 rounded-md cursor-pointer transition-colors duration-200",
                    "hover:bg-sidebar-accent",
                    !canCreateFolder && "opacity-50 cursor-not-allowed"
                  )}
                  style={{
                    width: isCollapsed ? '40px' : '100%',
                    paddingLeft: isCollapsed ? '0' : '8px',
                    paddingRight: isCollapsed ? '0' : '8px',
                    justifyContent: isCollapsed ? 'center' : 'space-between',
                  }}
                  tabIndex={0}
                  role="button"
                  onClick={() => {
                    if (!canCreateFolder) return;
                    setFolderToEdit(null);
                    setFolderDialogError(null);
                    setFolderDialogOpen(true);
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderPlus
                      size={18}
                      className={cn(
                        "shrink-0 text-muted-foreground",
                        !canCreateFolder && "opacity-50"
                      )}
                    />
                    <span
                      className={cn(
                        "truncate text-sm transition-all duration-300",
                        isCollapsed ? "opacity-0 w-0" : "opacity-100"
                      )}
                    >
                      {canCreateFolder ? "New Folder" : "Folder limit reached"}
                    </span>
                  </div>
                  {!isCollapsed && !canCreateFolder && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">
                        {folderCount}/{folderLimit}
                      </span>
                      <a
                        href="/upgrade"
                        className="text-xs text-blue-500 hover:text-blue-600"
                      >
                        Upgrade
                      </a>
                    </div>
                  )}
                </div>
                </>
                )}
              </div>
            )}
          </div>

          {/* Pinned Conversations */}
          {pinnedConversations.length > 0 && (
            <div className="space-y-1">
              <h3
                className={cn(
                  "text-xs font-semibold text-muted-foreground uppercase tracking-wider transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)] px-1",
                  isCollapsed ? "opacity-0 scale-95 h-0" : "opacity-100 scale-100 h-4"
                )}
                style={{ maxWidth: isCollapsed ? '0' : '200px' }}
              >
                Pinned
              </h3>
              <div className="space-y-1">
                {pinnedConversations.map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isActive={conversation.id === activeConversationId}
                    isTouchDevice={isTouchDevice}
                    isMobile={isMobile}
                    canPin={canPin}
                    onNavigate={() => {
                      router.push(`/chats/${conversation.id}`);
                      if (isMobile) onMobileSidebarToggle();
                    }}
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
              </div>
            </div>
          )}

          {/* Chat History */}
          <div className="space-y-1">
            <h3
              className={cn(
                "text-xs font-semibold text-muted-foreground uppercase tracking-wider transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)] px-1",
                isCollapsed ? "opacity-0 scale-95 h-0" : "opacity-100 scale-100 h-4"
              )}
              style={{
                maxWidth: isCollapsed ? '0' : '200px'
              }}
            >
              Chat History
            </h3>
            {isPending ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-8 rounded-md" />
                ))}
              </div>
            ) : regularConversations.length === 0 && pinnedConversations.length === 0 ? (
              <p className="text-muted-foreground text-sm py-2 text-center">No chat history</p>
            ) : regularConversations.length === 0 ? (
              <p className="text-muted-foreground text-sm py-2 text-center">No more chats</p>
            ) : (
              <div className="space-y-1">
                {regularConversations.map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isActive={conversation.id === activeConversationId}
                    isTouchDevice={isTouchDevice}
                    isMobile={isMobile}
                    canPin={canPin}
                    onNavigate={() => {
                      router.push(`/chats/${conversation.id}`);
                      if (isMobile) onMobileSidebarToggle();
                    }}
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

                {hasNextPage && (
                  <div ref={loadMoreRef} className="space-y-2 pt-2">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-8 rounded-md" />
                    ))}
                  </div>
                )}
                {!hasNextPage && !isPending && regularConversations.length > 0 && (
                  <p className="text-muted-foreground text-xs text-center pt-2">End of history</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="mt-auto py-2 border-t border-border shrink-0"
        style={{
          paddingLeft: isCollapsed ? '12px' : '16px',
          paddingRight: isCollapsed ? '12px' : '16px',
          transition: 'padding 300ms cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >



        {/* Subscription Button - Dynamic based on subscription status */}
        <button
          className={cn(
            "relative flex items-center h-10 rounded-lg transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)]",
            "font-medium shadow-sm hover:shadow-md",
            "bg-linear-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white",
            subscriptionLoading && "opacity-70 cursor-wait"
          )}
          style={{
            width: isCollapsed ? '40px' : '100%',
            paddingLeft: isCollapsed ? '0' : '12px',
            paddingRight: isCollapsed ? '0' : '12px',
            justifyContent: isCollapsed ? 'center' : 'flex-start'
          }}
          onClick={() => {
            router.push(subscriptionButtonHref);
            if (isMobile) onMobileSidebarToggle();
          }}
          disabled={subscriptionLoading}
        >
          {subscriptionLoading ? (
            <Loader2 size={20} className="shrink-0 animate-spin" />
          ) : hasActiveSubscription ? (
            <Crown size={20} className="shrink-0" />
          ) : (
            <Sparkles size={20} className="shrink-0" />
          )}
          <span
            className={cn(
              "truncate whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)]",
              isCollapsed ? "opacity-0" : "opacity-100"
            )}
            style={{
              marginLeft: isCollapsed ? '0px' : '12px',
              width: isCollapsed ? '0px' : 'auto',
              overflow: 'hidden'
            }}
          >
            {subscriptionLoading ? 'Loading...' : subscriptionButtonLabel}
          </span>
        </button>

        {/* Account Section */}
        <div className="relative mt-1">
          {!isLoaded ? (
            <div
              className={cn(
                "relative flex items-center h-10 rounded-lg transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)]",
                "text-sidebar-foreground"
              )}
              style={{
                width: isCollapsed ? '40px' : '100%',
                paddingLeft: isCollapsed ? '0' : '12px',
                paddingRight: isCollapsed ? '0' : '12px',
                justifyContent: isCollapsed ? 'center' : 'flex-start'
              }}
            >
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              {!isCollapsed && (
                <Skeleton className="h-4 w-24 ml-3 shrink-0" />
              )}
            </div>
          ) : (
            <Dropdown
              open={accountMenuOpen}
              onOpenChange={setAccountMenuOpen}
              align="center"
              className="w-full"
            >
              <DropdownTrigger asChild>
                <button
                  className={cn(
                    "relative flex items-center h-10 rounded-lg transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)]",
                    "text-sidebar-foreground hover:bg-accent"
                  )}
                  style={{
                    width: isCollapsed ? '40px' : '100%',
                    paddingLeft: isCollapsed ? '0' : '12px',
                    paddingRight: isCollapsed ? '0' : '12px',
                    justifyContent: isCollapsed ? 'center' : 'flex-start'
                  }}
                  aria-label={isCollapsed ? "Account menu" : undefined}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={user?.imageUrl} alt="User Avatar" />
                    <AvatarFallback className="bg-secondary">
                      <User className="text-secondary-foreground" size={18} />
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className={cn(
                      "truncate whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.4, 0, 0.2, 1)]",
                      isCollapsed ? "opacity-0" : "opacity-100"
                    )}
                    style={{
                      marginLeft: isCollapsed ? '0px' : '12px',
                      width: isCollapsed ? '0px' : 'auto',
                      overflow: 'hidden'
                    }}
                  >
                    {user?.fullName || 'User Name'}
                  </span>
                  {!isCollapsed && (
                    <ChevronDown
                      size={16}
                      className={cn(
                        "ml-auto transition-transform duration-300",
                        accountMenuOpen && "rotate-180"
                      )}
                    />
                  )}
                </button>
              </DropdownTrigger>

              <DropdownSurface
                className="bg-popover border border-border text-popover-foreground shadow-lg w-76"
                align="center"
                sideOffset={8}
              >
                <DropdownItem
                  icon={<Settings size={24} />}
                  className="flex items-center gap-3 px-4 py-3 text-md hover:bg-accent hover:text-accent-foreground transition-colors duration-200 font-medium"
                  onSelect={() => router.push('/settings/general')}
                >
                  Settings
                </DropdownItem>
                <DropdownItem
                  icon={<HelpCircle size={24} />}
                  className="flex items-center gap-3 px-4 py-3 text-md hover:bg-accent hover:text-accent-foreground transition-colors duration-200 font-medium"
                  onSelect={() => router.push('/feedback')}
                >
                  Feedback
                </DropdownItem>
                <div className="h-px bg-border w-full" />
                <DropdownItem
                  icon={<LogOut size={24} />}
                  className="flex items-center gap-3 px-4 py-3 text-md text-destructive hover:bg-destructive/10! transition-colors duration-200 font-medium"
                  onSelect={() => signOut()}
                >
                  Sign out
                </DropdownItem>
              </DropdownSurface>
            </Dropdown>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => {
        setDeleteDialogOpen(open);
        if (!open) setConversationToDelete(null);
      }}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Chat, Sure?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete this conversation and all its messages.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end gap-3">
            <button
              className="inline-flex items-center justify-center h-9 px-4 py-2 rounded-md text-sm font-medium transition-colors bg-secondary text-secondary-foreground hover:bg-secondary/80"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </button>
            <button
              className="inline-flex items-center justify-center h-9 px-4 py-2 rounded-md text-sm font-medium transition-colors bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (conversationToDelete) {
                  deleteConversation.mutate(conversationToDelete);
                }
                setDeleteDialogOpen(false);
                setConversationToDelete(null);
              }}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={(open) => {
        setRenameDialogOpen(open);
        if (!open) {
          setConversationToRename(null);
          setNewTitle('');
        }
      }}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
            <DialogDescription>
              Enter a new name for this conversation.
            </DialogDescription>
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
          <DialogFooter className="sm:justify-end gap-3">
            <button
              className="inline-flex items-center justify-center h-9 px-4 py-2 rounded-md text-sm font-medium transition-colors bg-secondary text-secondary-foreground hover:bg-secondary/80"
              onClick={() => setRenameDialogOpen(false)}
            >
              Cancel
            </button>
            <button
              className="inline-flex items-center justify-center h-9 px-4 py-2 rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
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
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder Dialog (Create/Edit) */}
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

      {/* Delete Folder Confirmation Dialog */}
      <Dialog open={deleteFolderDialogOpen} onOpenChange={(open) => {
        setDeleteFolderDialogOpen(open);
        if (!open) setFolderToDelete(null);
      }}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Folder?</DialogTitle>
            <DialogDescription>
              This will permanently delete the folder and all chats inside it. To keep your chats, move them to another folder or back to your regular chat list before deleting.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end gap-3">
            <button
              className="inline-flex items-center justify-center h-9 px-4 py-2 rounded-md text-sm font-medium transition-colors bg-secondary text-secondary-foreground hover:bg-secondary/80"
              onClick={() => setDeleteFolderDialogOpen(false)}
            >
              Cancel
            </button>
            <button
              className="inline-flex items-center justify-center h-9 px-4 py-2 rounded-md text-sm font-medium transition-colors bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Folder Dialog */}
      <Dialog open={moveToFolderDialogOpen} onOpenChange={(open) => {
        setMoveToFolderDialogOpen(open);
        if (!open) setConversationToMove(null);
      }}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Move to Folder</DialogTitle>
            <DialogDescription>
              Select a folder to move this conversation to.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4 max-h-[300px] overflow-y-auto">
            {foldersLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading folders...</span>
              </div>
            ) : folders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No folders yet. Create one first.
              </p>
            ) : (
              folders.map((folder) => (
                <button
                  key={folder.id}
                  className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-accent text-left text-sm"
                  onClick={() => {
                    if (conversationToMove) {
                      moveToFolder.mutate({ conversationId: conversationToMove, folderId: folder.id });
                    }
                    setMoveToFolderDialogOpen(false);
                    setConversationToMove(null);
                  }}
                >
                  <FolderInput size={16} style={{ color: folder.color || undefined }} />
                  <span>{folder.name}</span>
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <button
              className="inline-flex items-center justify-center h-9 px-4 py-2 rounded-md text-sm font-medium transition-colors bg-secondary text-secondary-foreground hover:bg-secondary/80"
              onClick={() => setMoveToFolderDialogOpen(false)}
            >
              Cancel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

// ============================================================================
// CONVERSATION ITEM COMPONENT
// ============================================================================

interface ConversationItemProps {
  conversation: StoredConversation;
  isActive: boolean;
  isTouchDevice: boolean;
  isMobile: boolean;
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
    <div
      className={cn(
        "group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-colors duration-200",
        isActive
          ? "bg-sidebar-accent text-sidebar-foreground"
          : "hover:bg-sidebar-accent"
      )}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onNavigate();
        }
      }}
      onClick={onNavigate}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {isPinned && <Pin size={14} className="shrink-0 text-muted-foreground" />}
        <span className="truncate text-sidebar-foreground transition-colors duration-200">
          {conversation.title || 'Untitled Conversation'}
        </span>
      </div>
      <Dropdown align="left">
        <DropdownTrigger asChild>
          <button
            className={cn(
              isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              'p-1 -mr-1 rounded-md hover:bg-sidebar transition-all duration-200'
            )}
            tabIndex={0}
            onClick={(e) => e.stopPropagation()}
            aria-label="Chat options"
          >
            <MoreHorizontal size={16} className="text-sidebar-foreground" />
          </button>
        </DropdownTrigger>
        <DropdownSurface className="bg-popover border border-border text-popover-foreground min-w-[180px] shadow-lg">
          <DropdownItem
            icon={<PencilLine size={16} />}
            className="flex items-center gap-2 p-2 hover:bg-accent hover:text-accent-foreground transition-colors duration-200"
            onSelect={onRename}
          >
            Rename
          </DropdownItem>
          <DropdownItem
            icon={isPinned ? <PinOff size={16} /> : <Pin size={16} />}
            className="flex items-center gap-2 p-2 hover:bg-accent hover:text-accent-foreground transition-colors duration-200"
            onSelect={onPin}
            disabled={!isPinned && !canPin}
            title={!isPinned && !canPin ? 'Max 5 pinned chats' : undefined}
          >
            {isPinned ? 'Unpin' : 'Pin'}
          </DropdownItem>
          <DropdownItem
            icon={<Archive size={16} />}
            className="flex items-center gap-2 p-2 hover:bg-accent hover:text-accent-foreground transition-colors duration-200"
            onSelect={onArchive}
          >
            Archive
          </DropdownItem>
          <DropdownItem
            icon={<FolderInput size={16} />}
            className="flex items-center gap-2 p-2 hover:bg-accent hover:text-accent-foreground transition-colors duration-200"
            onSelect={onMoveToFolder}
          >
            Move to folder
          </DropdownItem>
          <DropdownItem
            icon={<Trash2 size={16} />}
            className="flex items-center gap-2 p-2 text-destructive focus:bg-destructive/10! transition-colors duration-200"
            onSelect={onDelete}
          >
            Delete
          </DropdownItem>
        </DropdownSurface>
      </Dropdown>
    </div>
  );
}

export default ChatSidebar;
