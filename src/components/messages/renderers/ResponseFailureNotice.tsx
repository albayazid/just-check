'use client';

import { memo } from 'react';
import { AlertTriangle, WifiOff, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatErrorKind } from '@/lib/chat-error';

interface ResponseFailureNoticeProps {
  /** Classified error kind — drives the colour scheme (transient vs destructive). */
  kind: ChatErrorKind;
  /** Ready-to-display message text. */
  message: string;
  /** Optional Regenerate action. Omitted when regeneration isn't applicable. */
  onRegenerate?: () => void;
  /** Optional Dismiss action — clears the failure marker. */
  onDismiss?: () => void;
  /** Disables the Regenerate button (e.g. while a stream is in-flight). */
  disabled?: boolean;
}

/**
 * Inline failure notice rendered *below* a failed assistant message.
 *
 * Transient failures (network / rate-limit) use an amber palette so the user
 * reads them as "temporary hiccup"; persistent failures use the destructive
 * palette. Announced to assistive tech via `role="alert"`.
 */
function ResponseFailureNoticeBase({
  kind,
  message,
  onRegenerate,
  onDismiss,
  disabled,
}: ResponseFailureNoticeProps) {
  const isTransient = kind === 'network' || kind === 'rate-limit';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'mt-3 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
        isTransient
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'
          : 'border-destructive/30 bg-destructive/5 text-destructive dark:bg-destructive/10',
      )}
    >
      <div className='mt-0.5 shrink-0'>
        {kind === 'network' ? (
          <WifiOff className='h-4 w-4' />
        ) : (
          <AlertTriangle className='h-4 w-4' />
        )}
      </div>

      <span className='min-w-0 flex-1 leading-relaxed'>{message}</span>

      <div className='flex shrink-0 items-center gap-1.5'>
        {onRegenerate && (
          <Button
            size='xs'
            variant='outline'
            onClick={onRegenerate}
            disabled={disabled}
          >
            <RefreshCw className='h-3 w-3' />
            Regenerate
          </Button>
        )}
        {onDismiss && (
          <Button
            size='icon-xs'
            variant='ghost'
            onClick={onDismiss}
            aria-label='Dismiss failure notice'
          >
            <X className='h-3.5 w-3.5' />
          </Button>
        )}
      </div>
    </div>
  );
}

export const ResponseFailureNotice = memo(ResponseFailureNoticeBase);
