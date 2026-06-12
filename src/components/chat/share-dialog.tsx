'use client';

/**
 * ShareDialog
 *
 * Dialog for creating and managing conversation shares.
 * Allows selecting share mode, toggling name visibility,
 * creating links, and revoking existing shares.
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, Check, Link2, Loader2, Trash2, MessagesSquare, GitBranch, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/utils/clipboard';
import { toast } from 'sonner';
import { useShares, useCreateShare, useRevokeShare } from '@/hooks/use-shares';
import type { ShareMode } from '@/lib/sharing/types';

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
// EXISTING SHARES LIST
// ============================================================================

function ExistingSharesList({ conversationId }: { conversationId: string }) {
  const { data: shares, isLoading } = useShares(conversationId);
  const revokeMutation = useRevokeShare();
  const activeShares = shares?.filter((s) => s.isActive) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2 pt-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (activeShares.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 pt-2">
      <Label className="text-sm font-medium">Active shares</Label>
      <div className="space-y-1.5">
        {activeShares.map((share) => (
          <div
            key={share.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-mono text-muted-foreground">
                  ...{share.token.slice(-8)}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-destructive hover:text-destructive"
              disabled={revokeMutation.isPending}
              onClick={() => {
                revokeMutation.mutate(share.id, {
                  onSuccess: () => toast.success('Share link revoked'),
                  onError: (err) => toast.error(err.message || 'Failed to revoke'),
                });
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
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
  conversationTitle?: string | null;
  currentLeafMessageId: string | null;
}

export function ShareDialog({
  open,
  onOpenChange,
  conversationId,
  conversationTitle,
  currentLeafMessageId,
}: ShareDialogProps) {
  const [shareMode, setShareMode] = useState<ShareMode>('entire');
  const [showOwnerName, setShowOwnerName] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const createMutation = useCreateShare();

  const handleCreate = async () => {
    try {
      const result = await createMutation.mutateAsync({
        conversationId,
        shareMode,
        showOwnerName,
        currentLeafMessageId: shareMode === 'visible_thread' ? currentLeafMessageId ?? undefined : undefined,
      });
      setCreatedUrl(result.url);
      toast.success('Share link created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create share');
    }
  };

  const handleCopyLink = async () => {
    if (!createdUrl) return;
    try {
      await copyToClipboard(createdUrl);
      setCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      // Reset state on close
      setCreatedUrl(null);
      setCopied(false);
      setShareMode('entire');
      setShowOwnerName(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {createdUrl ? 'Link created' : 'Share conversation'}
          </DialogTitle>
        </DialogHeader>

        {createdUrl ? (
          /* ── Step 2: Link ready ── */
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Anyone with this link can view
              {conversationTitle ? ` "${conversationTitle}"` : ' this conversation'}
              {showOwnerName ? ' with your name shown' : ''}.
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={createdUrl}
                className="text-xs font-mono"
                onFocus={(e) => e.target.select()}
              />
              <Button size="sm" variant="outline" onClick={handleCopyLink}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        ) : (
          /* ── Step 1: Configuration ── */
          <div className="space-y-5 py-2">
            <ShareModeSelector value={shareMode} onChange={setShareMode} />

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <Label htmlFor="show-name-toggle" className="text-sm font-medium cursor-pointer">
                  Show my name on shared page
                </Label>
                <p className="text-xs text-muted-foreground">
                  Your display name will appear at the top of the shared page
                </p>
              </div>
              <Switch
                id="show-name-toggle"
                size="sm"
                checked={showOwnerName}
                onCheckedChange={setShowOwnerName}
              />
            </div>

            <ExistingSharesList conversationId={conversationId} />
          </div>
        )}

        <DialogFooter>
          {createdUrl ? (
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                onClick={handleCreate}
                disabled={
                  createMutation.isPending ||
                  (shareMode === 'visible_thread' && !currentLeafMessageId)
                }
              >
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
