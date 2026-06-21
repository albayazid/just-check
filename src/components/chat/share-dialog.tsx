'use client';

/** ShareDialog — one active link per conversation. Views: loading → create → manage → resync. */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, Check, Link2, Loader2, Trash2, RefreshCw, MessagesSquare, GitBranch, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/utils/clipboard';
import { toast } from 'sonner';
import { useShare, useCreateShare, useResyncShare, useRevokeShare } from '@/hooks/use-shares';
import type { ShareConversationView, ShareMode } from '@/lib/sharing/types';

// ============================================================================
// SHARE MODE OPTIONS
// ============================================================================

const SHARE_MODES: Array<{
  value: ShareMode;
  label: string;
  description: string;
  icon: React.ElementType;
}> = [
  {
    value: 'entire',
    label: 'Entire conversation',
    description: 'All messages and branches',
    icon: MessagesSquare,
  },
  {
    value: 'latest_thread',
    label: 'Latest thread',
    description: 'Most recent conversation path',
    icon: GitBranch,
  },
  {
    value: 'visible_thread',
    label: 'Current visible thread',
    description: 'Exactly what you see now',
    icon: Eye,
  },
];

function modeLabel(mode: ShareMode): string {
  return SHARE_MODES.find((m) => m.value === mode)?.label ?? mode;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ============================================================================
// SHARE MODE SELECTOR
// ============================================================================

function ShareModeSelector({
  value,
  onChange,
}: {
  value: ShareMode;
  onChange: (mode: ShareMode) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">What to share</Label>
      <div className="space-y-1.5">
        {SHARE_MODES.map((mode) => {
          const Icon = mode.icon;
          const isSelected = value === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => onChange(mode.value)}
              className={cn(
                'w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')} />
              <div className="min-w-0">
                <div className={cn('text-sm font-medium', isSelected ? 'text-foreground' : 'text-foreground/80')}>
                  {mode.label}
                </div>
                <div className="text-xs text-muted-foreground">{mode.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN DIALOG
// ============================================================================

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  currentLeafMessageId: string | null;
}

export function ShareDialog({
  open,
  onOpenChange,
  conversationId,
  currentLeafMessageId,
}: ShareDialogProps) {
  const queryClient = useQueryClient();
  const { data: share, isLoading } = useShare(conversationId);
  const createMutation = useCreateShare();
  const resyncMutation = useResyncShare();
  const revokeMutation = useRevokeShare();

  const [editing, setEditing] = useState(false);
  const [shareMode, setShareMode] = useState<ShareMode>('entire');
  const [copied, setCopied] = useState(false);

  const view: 'loading' | 'create' | 'manage' | 'resync' = isLoading
    ? 'loading'
    : share
      ? (editing ? 'resync' : 'manage')
      : 'create';

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const shareUrl = share ? `${origin}/share/${share.token}` : null;
  const leafMissing = shareMode === 'visible_thread' && !currentLeafMessageId;

  const beginEdit = () => {
    if (!share) return;
    setShareMode(share.shareMode);
    setEditing(true);
  };

  const handleCreate = async () => {
    try {
      const result = await createMutation.mutateAsync({
        conversationId,
        shareMode,
        currentLeafMessageId: shareMode === 'visible_thread' ? currentLeafMessageId ?? undefined : undefined,
      });
      // Optimistically populate the cache so the manage view appears instantly;
      // the background refetch corrects timestamps.
      const nowIso = new Date().toISOString();
      queryClient.setQueryData(['share', conversationId], {
        id: result.id,
        token: result.token,
        shareMode,
        isActive: true,
        createdAt: nowIso,
        syncedAt: nowIso,
        expiresAt: null,
      } as ShareConversationView);
      toast.success('Share link created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create share');
    }
  };

  const handleResync = async () => {
    if (!share) return;
    try {
      await resyncMutation.mutateAsync({
        conversationId,
        shareMode,
        currentLeafMessageId: shareMode === 'visible_thread' ? currentLeafMessageId ?? undefined : undefined,
      });
      setEditing(false);
      toast.success('Link updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update link');
    }
  };

  const handleRevoke = () => {
    if (!share) return;
    revokeMutation.mutate(conversationId, {
      onSuccess: () => {
        setEditing(false);
        setShareMode('entire');
        toast.success('Share link revoked');
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to revoke'),
    });
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await copyToClipboard(shareUrl);
      setCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setEditing(false);
      setShareMode('entire');
      setCopied(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {view === 'manage' || view === 'resync' ? 'Shared link' : 'Share conversation'}
          </DialogTitle>
        </DialogHeader>

        {view === 'loading' && (
          <div className="space-y-4 py-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-8 w-40" />
          </div>
        )}

        {view === 'create' && (
          <div className="py-2">
            <ShareModeSelector value={shareMode} onChange={setShareMode} />
          </div>
        )}

        {view === 'manage' && share && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Anyone with the link can view.
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={shareUrl ?? ''}
                className="text-xs font-mono"
                onFocus={(e) => e.target.select()}
              />
              <Button size="sm" variant="outline" onClick={handleCopyLink}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Shared {modeLabel(share.shareMode)} {share.syncedAt ? formatRelativeTime(share.syncedAt) : 'recently'}
            </div>
          </div>
        )}

        {view === 'resync' && share && (
          <div className="py-2">
            <p className="text-sm text-muted-foreground mb-4">
              The link stays the same; only what it shows will change.
            </p>
            <ShareModeSelector value={shareMode} onChange={setShareMode} />
          </div>
        )}

        <DialogFooter>
          {view === 'create' && (
            <>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleCreate} disabled={createMutation.isPending || leafMissing}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Link2 className="h-4 w-4 mr-1.5" />
                    Create link
                  </>
                )}
              </Button>
            </>
          )}

          {view === 'manage' && (
            <>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={handleRevoke}
                disabled={revokeMutation.isPending}
              >
                {revokeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1.5" />
                )}
                Revoke
              </Button>
              <Button onClick={beginEdit}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                Update
              </Button>
            </>
          )}

          {view === 'resync' && (
            <>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={handleResync} disabled={resyncMutation.isPending || leafMissing}>
                {resyncMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                    Confirm update
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
