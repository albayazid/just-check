'use client';

import React, { useState, useEffect } from 'react';
import { memo } from 'react';
import { UIMessage } from 'ai';
import type { ClientMessageMetadata } from '@/lib/conversation-history/types';
import { Response } from '@/components/response';
import { UIModels } from '@/lib/models';
import { Brain, ThumbsUp, ThumbsDown, Copy, Check, MoreVertical, X, Info, RefreshCw } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { renderToolPart } from '@/lib/tools/renderers';
import { useMessageFeedback, useMessageFeedbackMutation } from '@/hooks/use-message-feedback';
import { useIsTouchDevice } from '@/hooks/use-touch-device';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/utils/clipboard';
import type { ChatErrorKind } from '@/lib/chat-error';
import { BranchIndicator } from './BranchIndicator';
import { AIMessageSkeleton } from './ChatHistorySkeleton';
import { ResponseFailureNotice } from './ResponseFailureNotice';

interface AIMessageProps {
  message: UIMessage;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  branchCurrentIndex?: number;
  branchTotalSiblings?: number;
  onBranchPrevious?: () => void;
  onBranchNext?: () => void;
  isLoading?: boolean;
  isGenerating?: boolean;
  /** When true, hides feedback (like/dislike), regenerate, and info buttons */
  readOnly?: boolean;
  /** Delivery status — 'failed' shows a recovery notice below the message. */
  status?: 'normal' | 'failed';
  /** Error classification for notice styling. Only meaningful when status is 'failed'. */
  failureKind?: ChatErrorKind | null;
  /** Clears the failure marker (Dismiss on the notice). */
  onDismissFailure?: () => void;
}

type FeedbackType = 'like' | 'dislike';

const PRESETS: Record<FeedbackType, { id: string; label: string }[]> = {
  like: [
    { id: 'accurate', label: 'Accurate' },
    { id: 'helpful', label: 'Helpful' },
    { id: 'well-explained', label: 'Well explained' },
    { id: 'creative', label: 'Creative' },
  ],
  dislike: [
    { id: 'incorrect', label: 'Incorrect' },
    { id: 'unhelpful', label: 'Unhelpful' },
    { id: 'confusing', label: 'Confusing' },
    { id: 'inappropriate', label: 'Inappropriate' },
  ],
};

export const AIMessage = memo(function AIMessage({
  message,
  isStreaming = false,
  onRegenerate,
  branchCurrentIndex,
  branchTotalSiblings,
  onBranchPrevious,
  onBranchNext,
  isLoading = false,
  isGenerating = false,
  readOnly = false,
  status = 'normal',
  failureKind = null,
  onDismissFailure,
}: AIMessageProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [popoverType, setPopoverType] = useState<'like' | 'dislike' | null>(null);
  const [selectedPresets, setSelectedPresets] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const isTouchDevice = useIsTouchDevice();

  // readOnly → null suppresses the (authenticated) feedback fetch on the public share view.
  const { data: feedbackData } = useMessageFeedback(readOnly ? null : message.id);

  // Mutation for creating/updating/deleting feedback
  const submitFeedback = useMessageFeedbackMutation(message.id);

  const currentFeedback = feedbackData?.feedback || null;

  // Sync state with existing feedback when popover opens or feedbackType changes
  useEffect(() => {
    if (popoverType && currentFeedback?.type === popoverType) {
      setSelectedPresets(currentFeedback.presets || []);
      setComment(currentFeedback.comment || '');
    }
  }, [popoverType, currentFeedback]);

  const handleCopy = async () => {
    const textContent = message.parts
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n\n');

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

  const handleLikeClick = (e: React.MouseEvent) => {
    if (currentFeedback?.type === 'like') {
      e.stopPropagation();
      submitFeedback.mutate(null);
      setPopoverType(null);
    } else {
      submitFeedback.mutate({ type: 'like' });
      setPopoverType('like');
    }
  };

  const handleDislikeClick = (e: React.MouseEvent) => {
    if (currentFeedback?.type === 'dislike') {
      e.stopPropagation();
      submitFeedback.mutate(null);
      setPopoverType(null);
    } else {
      submitFeedback.mutate({ type: 'dislike' });
      setPopoverType('dislike');
    }
  };

  const togglePreset = (presetId: string) => {
    setSelectedPresets((prev) =>
      prev.includes(presetId) ? prev.filter((id) => id !== presetId) : [...prev, presetId]
    );
  };

  const handlePopoverSubmit = () => {
    if (!popoverType) return;
    submitFeedback.mutate({
      type: popoverType,
      presets: selectedPresets,
      comment,
    });
    setPopoverType(null);
  };

  const isLikeActive = currentFeedback?.type === 'like';
  const isDislikeActive = currentFeedback?.type === 'dislike';
  const presets = popoverType ? PRESETS[popoverType] : [];
  const [showMetadataPopover, setShowMetadataPopover] = useState(false);

  const isEmpty = message.parts.length === 0;

  if (isStreaming && isEmpty) {
    return <AIMessageSkeleton />;
  }

  if (isEmpty) {
    if (status === 'failed') {
      return (
        <div className="w-full mb-4">
          <ResponseFailureNotice
            kind={failureKind ?? 'generic'}
            message="No response was generated."
            onRegenerate={readOnly ? undefined : onRegenerate}
            onDismiss={onDismissFailure}
            disabled={isStreaming || isLoading || isGenerating}
          />
        </div>
      );
    }
    return (
      <div className="w-full mb-4 group text-muted-foreground prose prose-sm italic">
        <Response className='wrap-anywhere'>No response generated. Please try again.</Response>
      </div>
    );
  }

  return (
    <div className="w-full mb-4 group">
      <div className="space-y-3">
        {message.parts.map((part, index) => {
          switch (part.type) {
            case 'text':
              return (
                <div key={index} className="text-foreground prose prose-sm max-w-none">
                  <Response className='wrap-break-word'>{part.text}</Response>
                </div>
              );

            case 'reasoning': {
              const itemId = `reasoning-${index}`;
              // Determine if this reasoning part is the last part in the message and still streaming
              const isLastPart = index === message.parts.length - 1;
              const label = (isLastPart && isStreaming) ? 'Thinking' : 'Thought';
              return (
                <div key={index}>
                  <Accordion type="single" collapsible>
                    <AccordionItem value={itemId} className="border-none">
                      <AccordionTrigger className="py-0 hover:no-underline hover:bg-transparent transition-colors duration-200 group w-fit flex-none">
                        <div className="flex items-start space-x-2 text-muted-foreground hover:text-foreground transition-colors">
                          <Brain className="h-4 w-4 shrink-0 mt-0.5" />
                          <span className="text-sm">
                            {label}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-0 pt-2">
                        <div className="ml-1.5 border-l-2 border-border pl-4">
                          <Response className="text-sm text-muted-foreground leading-relaxed">
                            {part.text}
                          </Response>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              );
            }

            default:
              // Try to render using the tool renderer registry
              const toolRender = renderToolPart(part, isStreaming);
              if (toolRender !== null) {
                return toolRender;
              }
              return null;
          }
        })}
      </div>

      {status === 'failed' && (
        <ResponseFailureNotice
          kind={failureKind ?? 'generic'}
          message="Response interrupted. Try regenerating."
          onRegenerate={readOnly ? undefined : onRegenerate}
          onDismiss={onDismissFailure}
          disabled={isStreaming || isLoading || isGenerating}
        />
      )}

      {/* Action buttons below the message */}
      <div className={cn('flex items-center gap-1 mt-2', isTouchDevice && 'opacity-100')}>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCopy}
              className={cn(
                'transition-opacity duration-200 p-2 rounded-md hover:bg-muted/80 text-foreground/70 hover:text-foreground',
                isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : copyFailed ? (
                <X className="h-4 w-4 text-red-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Copy</p>
          </TooltipContent>
        </Tooltip>

        {!readOnly && onRegenerate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onRegenerate}
                disabled={isStreaming || isLoading || isGenerating}
                className={cn(
                  'transition-opacity duration-200 p-2 rounded-md hover:bg-muted/80 text-foreground/70 hover:text-foreground',
                  'disabled:cursor-not-allowed',
                  isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-hover:disabled:opacity-50'
                )}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Regenerate</p>
            </TooltipContent>
          </Tooltip>
        )}

        {!readOnly && (
        <Tooltip>
          <Popover open={popoverType === 'like'} onOpenChange={(open) => {
            if (open && currentFeedback?.type === 'like') return;
            setPopoverType(open ? 'like' : null);
          }}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  onClick={handleLikeClick}
                  className={cn(
                    'transition-opacity duration-200 p-2 rounded-md hover:bg-muted/80 text-foreground/70 hover:text-foreground',
                    isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    isLikeActive && 'text-primary',
                    popoverType === 'like' && 'opacity-100'
                  )}
                >
                  <ThumbsUp className={cn('h-4 w-4', isLikeActive && 'fill-current')} />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{isLikeActive ? 'Remove like' : 'Like'}</p>
            </TooltipContent>
            <PopoverContent className="w-80" align="start" side="top">
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-sm">What did you like?</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Select any that apply (optional)
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPopoverType(null)}
                    className="h-6 w-6"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => togglePreset(preset.id)}
                      className={cn(
                        'px-3 py-1.5 text-xs rounded-full border transition-colors',
                        'hover:bg-accent hover:text-accent-foreground',
                        selectedPresets.includes(preset.id)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border'
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div>
                  <Textarea
                    placeholder="Add a comment (optional)..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="min-h-20 resize-none text-sm"
                    rows={3}
                  />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={handlePopoverSubmit}>
                    Submit
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </Tooltip>
        )}

        {!readOnly && (
        <Tooltip>
          <Popover open={popoverType === 'dislike'} onOpenChange={(open) => {
            if (open && currentFeedback?.type === 'dislike') return;
            setPopoverType(open ? 'dislike' : null);
          }}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  onClick={handleDislikeClick}
                  className={cn(
                    'transition-opacity duration-200 p-2 rounded-md hover:bg-muted/80 text-foreground/70 hover:text-foreground',
                    isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    isDislikeActive && 'text-destructive',
                    popoverType === 'dislike' && 'opacity-100'
                  )}
                >
                  <ThumbsDown className={cn('h-4 w-4', isDislikeActive && 'fill-current')} />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{isDislikeActive ? 'Remove dislike' : 'Dislike'}</p>
            </TooltipContent>
            <PopoverContent className="w-80" align="start" side="top">
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-sm">What can we improve?</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Select any that apply (optional)
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPopoverType(null)}
                    className="h-6 w-6"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => togglePreset(preset.id)}
                      className={cn(
                        'px-3 py-1.5 text-xs rounded-full border transition-colors',
                        'hover:bg-accent hover:text-accent-foreground',
                        selectedPresets.includes(preset.id)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border'
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div>
                  <Textarea
                    placeholder="Add a comment (optional)..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="min-h-20 resize-none text-sm"
                    rows={3}
                  />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={handlePopoverSubmit}>
                    Submit
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </Tooltip>
        )}

        <Tooltip>
          <Popover open={showMetadataPopover} onOpenChange={setShowMetadataPopover}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMetadataPopover(true);
                  }}
                  className={cn(
                    'transition-opacity duration-200 p-2 rounded-md hover:bg-muted/80 text-foreground/70 hover:text-foreground',
                    isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <Info className="h-4 w-4" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Message info</p>
            </TooltipContent>
            <PopoverContent className="w-72" align="start" side="top">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-sm">Message Details</h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowMetadataPopover(false)}
                    className="h-6 w-6"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {(() => {
                  const meta = message.metadata as ClientMessageMetadata | undefined;
                  if (!meta) return null;
                  // Find the friendly model name from UIModelId
                  const model = UIModels.find(m => m.id === meta.model_data?.UIModelId);
                  const displayName = model?.name || meta.model_data?.UIModelId || 'Unknown';
                  return (
                    <div className="space-y-2 text-sm">
                      {meta.model_data?.UIModelId && (
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Model</span>
                          <span className="font-mono text-xs">{displayName}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </PopoverContent>
          </Popover>
        </Tooltip>

        {!readOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button className={cn(
              'transition-opacity duration-200 p-2 rounded-md hover:bg-muted/80 text-foreground/70 hover:text-foreground',
              isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}>
              <MoreVertical className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>More options</p>
          </TooltipContent>
        </Tooltip>
        )}

        {branchTotalSiblings !== undefined && branchTotalSiblings > 1 && onBranchPrevious && onBranchNext && branchCurrentIndex !== undefined && (
          <div className={cn(
            'transition-opacity duration-200',
            isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}>
            <BranchIndicator
              currentIndex={branchCurrentIndex}
              totalSiblings={branchTotalSiblings}
              onPrevious={onBranchPrevious}
              onNext={onBranchNext}
              isLoading={isLoading || isGenerating}
            />
          </div>
        )}
      </div>
    </div>
  );
});
