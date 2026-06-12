'use client';

import { memo, useState, useCallback } from 'react';
import { UIMessage, type TextUIPart, type FileUIPart } from 'ai';
import { Copy, Check, Pencil, X, Loader2, ArrowUp, FileText, XIcon, Download } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Overlay, OverlayClose, OverlayContent, OverlayDescription, OverlayTitle } from '@/components/custom-ui/overlay';
import { useIsTouchDevice } from '@/hooks/use-touch-device';
import { useAttachmentUrl } from '@/hooks/use-attachment-url';
import { useShareAttachmentUrl } from '@/hooks/use-share-attachment-url';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/utils/clipboard';
import { toast } from 'sonner';
import { BranchIndicator } from './BranchIndicator';
import { ChatInput } from '@/components/chat-input';

export type EditMessagePart = TextUIPart | FileUIPart;

interface UserMessageProps {
  message: UIMessage;
  conversationId: string;
  /** Parent resolves on the chat page (tree / siblingInfo); do not rely on stream metadata alone. */
  onEdit?: (parts: EditMessagePart[]) => void;
  branchCurrentIndex?: number;
  branchTotalSiblings?: number;
  onBranchPrevious?: () => void;
  onBranchNext?: () => void;
  isGenerating?: boolean;
  isLoading?: boolean;
  selectedUIModelId: string;
  onUIModelChange: (uiModelId: string) => void;
  hasAllowance?: boolean;
  isLoadingAllowance?: boolean;
  /** When provided, resolves attachments via the public share endpoint instead of the authenticated one. Also enables readOnly mode. */
  shareToken?: string;
}

/**
 * Individual image component that handles URL resolution.
 * Clicking opens a full-size view in a dialog overlay.
 */
const MessageImage = memo(function MessageImage({
  url,
  filename,
  conversationId,
  shareToken,
}: {
  url: string;
  filename?: string;
  conversationId: string;
  shareToken?: string;
}) {
  // When shareToken is present, disable the auth hook (pass empty conversationId) and use the share hook.
  // Both hooks have internal `enabled` guards, so the disabled one creates an idle observer with no network request.
  const authResult = useAttachmentUrl(url, shareToken ? '' : conversationId);
  const shareResult = useShareAttachmentUrl(url, shareToken ?? '');
  const { resolvedUrl, isResolving, error } = shareToken ? shareResult : authResult;
  const [open, setOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const canClick = !isResolving && !error && resolvedUrl;

  return (
    <>
      <button
        type="button"
        onClick={canClick ? () => setOpen(true) : undefined}
        className={cn(
          'relative rounded-lg overflow-hidden border border-border/50 shadow-sm',
          canClick && 'cursor-pointer hover:opacity-90 transition-opacity'
        )}
      >
        {isResolving ? (
          <div className="w-24 h-24 flex items-center justify-center bg-muted">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="w-24 h-24 flex items-center justify-center bg-muted text-destructive text-xs p-2">
            Failed to load image
          </div>
        ) : (
          <img
            src={resolvedUrl}
            alt={filename || 'Uploaded image'}
            className="w-24 h-24 object-cover"
          />
        )}
      </button>
      <Overlay open={open} onOpenChange={setOpen}>
        <OverlayContent
          onClick={() => setOpen(false)}
          showCloseButton={false}
          onOpenAutoFocus={(e) => {
            // Prevent auto-focus on the download button (which shows its tooltip).
            // Instead, focus the content container itself to keep keyboard trap working.
            e.preventDefault();
            const container = e.currentTarget as HTMLElement;
            container.tabIndex = -1;
            container.focus();
          }}
        >
          <OverlayTitle className="sr-only">{filename || 'Image preview'}</OverlayTitle>
          <OverlayDescription className="sr-only">Full-size image preview</OverlayDescription>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolvedUrl}
            alt={filename || 'Uploaded image'}
            className="max-h-[90vh] max-w-[90vw] object-contain select-none"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!resolvedUrl || isDownloading) return;
                    setIsDownloading(true);
                    try {
                      const response = await fetch(resolvedUrl);
                      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
                      const blob = await response.blob();
                      const blobUrl = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = blobUrl;
                      a.download = filename || 'image';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(blobUrl);
                    } catch (err) {
                      toast.error('Failed to download image. Please retry.');
                    } finally {
                      setIsDownloading(false);
                    }
                  }}
                  disabled={isDownloading}
                  className="rounded-full bg-white/10 p-2 text-white/80 hover:text-white hover:bg-white/20 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDownloading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{isDownloading ? 'Downloading...' : 'Download image'}</p>
              </TooltipContent>
            </Tooltip>
            <OverlayClose className="rounded-full bg-white/10 p-2 text-white/80 hover:text-white hover:bg-white/20 transition-colors flex items-center justify-center">
              <XIcon className="size-4" />
            </OverlayClose>
          </div>
        </OverlayContent>
      </Overlay>
    </>
  );
});

const MessageFile = memo(function MessageFile({
  part,
  conversationId,
  shareToken,
}: {
  part: Extract<UIMessage['parts'][number], { type: 'file' }>;
  conversationId: string;
  shareToken?: string;
}) {
  const authResult = useAttachmentUrl(part.url, shareToken ? '' : conversationId);
  const shareResult = useShareAttachmentUrl(part.url, shareToken ?? '');
  const { resolvedUrl, isResolving, error } = shareToken ? shareResult : authResult;
  const href = resolvedUrl;
  const fileName = part.filename || 'Attached file';
  const [open, setOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const canClick = !isResolving && !error && href;

  const handleDownload = useCallback(async () => {
    if (!href || isDownloading) return;
    setIsDownloading(true);
    try {
      const response = await fetch(href);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('Failed to download file. Please retry.');
    } finally {
      setIsDownloading(false);
    }
  }, [href, isDownloading, fileName]);

  return (
    <>
      <button
        type="button"
        onClick={canClick ? () => setOpen(true) : undefined}
        className={cn(
          'flex h-24 w-24 flex-col overflow-hidden rounded-lg border border-border/60 bg-card p-2 text-card-foreground shadow-sm transition-colors',
          canClick ? 'cursor-pointer hover:bg-muted/70' : 'cursor-default'
        )}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {isResolving ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : error ? (
            <X className="h-6 w-6 text-destructive" />
          ) : (
            <FileText className="h-9 w-9 text-primary" />
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full truncate text-center text-xs font-medium text-muted-foreground">
              {fileName}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{error ? `${fileName} unavailable` : fileName}</p>
          </TooltipContent>
        </Tooltip>
      </button>
      <Overlay open={open} onOpenChange={setOpen}>
        <OverlayContent
          onClick={() => setOpen(false)}
          showCloseButton={false}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const container = e.currentTarget as HTMLElement;
            container.tabIndex = -1;
            container.focus();
          }}
        >
          <OverlayTitle className="sr-only">{fileName}</OverlayTitle>
          <OverlayDescription className="sr-only">File preview</OverlayDescription>
          <div
            className="flex flex-col items-center gap-4 rounded-2xl bg-muted backdrop-blur-md p-8 max-w-[90vw] select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <FileText className="h-20 w-20 text-muted-foreground/80" />
            <span className="text-sm font-medium text-foreground/90 text-center break-all leading-snug max-w-xs">
              {fileName}
            </span>
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex items-center gap-2 rounded-xl bg-muted-foreground/10 px-4 py-2 text-sm text-foreground/80 hover:text-foreground hover:bg-muted-foreground/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isDownloading ? 'Downloading...' : 'Download'}
            </button>
          </div>
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                  disabled={isDownloading}
                  className="rounded-full bg-white/10 p-2 text-white/80 hover:text-white hover:bg-white/20 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDownloading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{isDownloading ? 'Downloading...' : 'Download file'}</p>
              </TooltipContent>
            </Tooltip>
            <OverlayClose className="rounded-full bg-white/10 p-2 text-white/80 hover:text-white hover:bg-white/20 transition-colors flex items-center justify-center">
              <XIcon className="size-4" />
            </OverlayClose>
          </div>
        </OverlayContent>
      </Overlay>
    </>
  );
});

export const UserMessage = memo(function UserMessage({
  message,
  conversationId,
  onEdit,
  branchCurrentIndex,
  branchTotalSiblings,
  onBranchPrevious,
  onBranchNext,
  isGenerating = false,
  isLoading = false,
  selectedUIModelId,
  onUIModelChange,
  hasAllowance,
  isLoadingAllowance,
  shareToken,
}: UserMessageProps) {
  const readOnly = !!shareToken;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const isTouchDevice = useIsTouchDevice();

  const messageCreatedAt = (message as UIMessage & { createdAt?: string | Date }).createdAt;

  const textParts = message.parts.filter(part => part.type === 'text');
  const imageParts = message.parts.filter(
    (part): part is Extract<UIMessage['parts'][number], { type: 'file' }> =>
      part.type === 'file' && part.mediaType?.startsWith('image/')
  );
  const fileParts = message.parts.filter(
    (part): part is Extract<UIMessage['parts'][number], { type: 'file' }> =>
      part.type === 'file' && !part.mediaType?.startsWith('image/')
  );

  const handleCopy = async () => {
    const textContent = textParts.map(part => part.text).join('\n');
    try {
      await copyToClipboard(textContent);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      setCopyFailed(true);
      setCopied(false);
      setTimeout(() => setCopyFailed(false), 2000);
    }
  };


  // Edit state
  const [isEditing, setIsEditing] = useState(false);

  const startEditing = useCallback(() => {
    setIsEditing(true);
  }, []);

  const hasBranch = branchTotalSiblings !== undefined && branchTotalSiblings > 1;

  // Inline edit mode using ChatInput
  if (isEditing) {
    return (
      <div className="mb-4">
        <div className="w-full">
          <ChatInput
            initialValue={textParts.map(p => p.text).join('\n')}
            conversationId={conversationId}
            existingAttachments={[...imageParts, ...fileParts].map(p => ({
              url: p.url,
              originalName: p.filename ?? 'file',
              mimeType: p.mediaType ?? 'application/octet-stream',
            }))}
            onSubmit={(text, attachments) => {
              const parts: EditMessagePart[] = [];
              if (text) parts.push({ type: 'text', text });
              attachments?.forEach(a => parts.push({ type: 'file', url: a.url, mediaType: a.mimeType, filename: a.originalName }));
              onEdit?.(parts);
              setIsEditing(false);
            }}
            onCancel={() => setIsEditing(false)}
            placeholder="Edit your message..."
            hasAllowance={hasAllowance}
            isLoadingAllowance={isLoadingAllowance}
            isLoading={isLoading || isGenerating}
            selectedUIModelId={selectedUIModelId}
            onUIModelChange={onUIModelChange}
          />
        </div>
      </div>
    );
  }

  // Normal display mode
  return (
    <div className="flex justify-end mb-4 group">
      <div className="max-w-[70%]">
        {/* Attachments displayed above and outside the bubble */}
        {(imageParts.length > 0 || fileParts.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-2 justify-end">
            {imageParts.map((part, index) => (
              <MessageImage
                key={`image-${index}`}
                url={part.url}
                filename={part.filename}
                conversationId={conversationId}
                shareToken={shareToken}
              />
            ))}
            {fileParts.map((part, index) => (
              <MessageFile
                key={`file-${index}`}
                part={part}
                conversationId={conversationId}
                shareToken={shareToken}
              />
            ))}
          </div>
        )}

        <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 shadow-sm w-fit max-w-full ml-auto">
          {message.parts.map((part, index) => {
            switch (part.type) {
              case 'text':
                return (
                  <div key={index} className="prose prose-sm max-w-none prose-invert">
                    <div className="whitespace-pre-wrap leading-relaxed wrap-anywhere">
                      {part.text}
                    </div>
                  </div>
                );
              default:
                return null;
            }
          })}
        </div>

        {/* Branch indicator and action buttons */}
        <div className={cn('flex items-center justify-end gap-1 mt-2', isTouchDevice && 'opacity-100')}>
          {messageCreatedAt && (
            <span className={cn(
              'hidden sm:inline text-sm text-primary-foreground/50 transition-opacity duration-200', // Hidden on narrower devices cause it cause broken layout. TODO || P8 : Engineer around it to solve.
              isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}>
              {new Date(messageCreatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {hasBranch && onBranchPrevious && onBranchNext && branchCurrentIndex !== undefined && (
            <div className={cn(
              'transition-opacity duration-200',
              isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}>
              <BranchIndicator
                currentIndex={branchCurrentIndex}
                totalSiblings={branchTotalSiblings!}
                onPrevious={onBranchPrevious}
                onNext={onBranchNext}
                isLoading={isLoading || isGenerating}
              />
            </div>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleCopy}
                className={cn(
                  'transition-opacity duration-200 p-2 rounded-md hover:bg-muted/80 text-primary-foreground/70 hover:text-primary-foreground',
                  isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-300" />
                ) : copyFailed ? (
                  <X className="h-4 w-4 text-red-300" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Copy message</p>
            </TooltipContent>
          </Tooltip>

          {!readOnly && onEdit && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={startEditing}
                  className={cn(
                    'transition-opacity duration-200 p-2 rounded-md hover:bg-muted/80 text-primary-foreground/70 hover:text-primary-foreground',
                    isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Edit message</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
});
