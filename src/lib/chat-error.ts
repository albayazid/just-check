/**
 * Chat failure recovery — pure helpers.
 *
 * The AI SDK pushes the user message optimistically and leaves it (plus any
 * partial assistant reply) in the list when a generation fails, with status
 * stuck at 'error'. These functions contain all the decisions about what to do
 * with that broken state so the component layer stays thin and the logic is
 * unit-testable.
 *
 * The HTTP status code is lost by the time `onError` fires (the transport
 * throws `new Error(response.text())`), so we classify from the JSON body that
 * lands in `error.message` — backed by keyword fallbacks for non-JSON errors.
 */
import type { UIMessage } from 'ai';

export type ChatErrorKind =
  | 'allowance'
  | 'auth'
  | 'not-found'
  | 'rate-limit'
  | 'network'
  | 'generic';

/** Machine-readable codes emitted by the /api/chat route in its error body. */
export const ChatErrorCode = {
  INSUFFICIENT_ALLOWANCE: 'INSUFFICIENT_ALLOWANCE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_PARENT: 'INVALID_PARENT',
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export interface ParsedChatError {
  code?: string;
  message?: string;
}

/**
 * Try to read a structured `{ code, error }` body out of an Error whose message
 * is the raw HTTP response text. Returns null for non-JSON messages (e.g. the
 * TypeError thrown by a real network failure).
 */
export function parseChatErrorBody(
  error: Error | null | undefined,
): ParsedChatError | null {
  const raw = error?.message;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const message =
        typeof record.error === 'string'
          ? record.error
          : typeof record.message === 'string'
            ? record.message
            : undefined;
      return {
        code: typeof record.code === 'string' ? record.code : undefined,
        message,
      };
    }
  } catch {
    // Not JSON — fall through to keyword classification.
  }
  return null;
}

export function classifyChatError(
  error: Error | null | undefined,
): ChatErrorKind {
  const parsed = parseChatErrorBody(error);

  // If we got structured JSON, classify by code only. Unknown codes get
  // generic — don't fall through to keyword matching on the raw JSON string
  // (which contains field names, syntax, and error text mashed together).
  if (parsed) {
    switch (parsed.code) {
      case ChatErrorCode.INSUFFICIENT_ALLOWANCE:
        return 'allowance';
      case ChatErrorCode.UNAUTHORIZED:
        return 'auth';
      case ChatErrorCode.CONVERSATION_NOT_FOUND:
        return 'not-found';
      case ChatErrorCode.RATE_LIMITED:
        return 'rate-limit';
      default:
        return 'generic';
    }
  }

  // Keyword fallback — only for non-JSON error messages (e.g. Safari's
  // "Load failed", Chrome's "Failed to fetch", or plain-text provider errors).
  const lower = (error?.message ?? '').toLowerCase();

  if (
    (error instanceof TypeError && (lower.includes('fetch') || lower.includes('network'))) ||
    lower.includes('failed to fetch') ||
    lower.includes('load failed') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed')
  ) {
    return 'network';
  }
  if (lower.includes('insufficient allowance')) return 'allowance';
  if (lower.includes('too many requests')) return 'rate-limit';
  if (lower.includes('unauthorized') || lower.includes('not authenticated')) {
    return 'auth';
  }
  if (lower.includes('not found') || lower.includes('access denied')) {
    return 'not-found';
  }
  return 'generic';
}

export function chatErrorMessage(kind: ChatErrorKind): string {
  switch (kind) {
    case 'allowance':
      return "You've used all your messages for today.";
    case 'auth':
      return 'Your session expired — please sign in again.';
    case 'network':
      return 'Connection lost. Check your internet and try again.';
    case 'rate-limit':
      return 'Too many messages — please wait a moment.';
    case 'not-found':
      return 'This conversation is no longer available.';
    default:
      return 'Something went wrong sending your message.';
  }
}

type AnyPart = UIMessage['parts'][number];

/** True if the assistant produced any substantive content before failing. */
export function assistantMessageHasContent(
  message: { parts?: AnyPart[] } | undefined | null,
): boolean {
  const parts = message?.parts;
  if (!parts || parts.length === 0) return false;
  return parts.some((part) => {
    if (part.type === 'text') return part.text.trim().length > 0;
    if (part.type === 'reasoning') return (part.text ?? '').trim().length > 0;
    if (part.type === 'file') return true;
    if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) return true;
    return false;
  });
}

export type FailureRecovery =
  | { kind: 'failed-user-message'; failedUserId: string }
  | { kind: 'cutoff'; failedAssistantId: string }
  | { kind: 'failed-generate' };

export function computeFailureRecovery(args: {
  messages: UIMessage[];
  assistantMessage: UIMessage | undefined;
  trigger: 'submit-message' | 'regenerate-message' | null;
}): FailureRecovery {
  const { messages, assistantMessage, trigger } = args;

  if (assistantMessageHasContent(assistantMessage)) {
    return { kind: 'cutoff', failedAssistantId: assistantMessage!.id };
  }

  if (trigger === 'regenerate-message') {
    return { kind: 'failed-generate' };
  }

  if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
    return {
      kind: 'failed-user-message',
      failedUserId: messages[messages.length - 1].id,
    };
  }

  return { kind: 'failed-generate' };
}
