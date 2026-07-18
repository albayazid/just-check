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
  switch (parsed?.code) {
    case ChatErrorCode.INSUFFICIENT_ALLOWANCE:
      return 'allowance';
    case ChatErrorCode.UNAUTHORIZED:
      return 'auth';
    case ChatErrorCode.CONVERSATION_NOT_FOUND:
      return 'not-found';
    case ChatErrorCode.RATE_LIMITED:
      return 'rate-limit';
  }

  const lower = (error?.message ?? '').toLowerCase();

  if (
    (error instanceof TypeError && (lower.includes('fetch') || lower.includes('network'))) ||
    lower.includes('failed to fetch') ||
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

/** Attachment shape reconstructed from a failed user message's file parts. */
export interface RestoredAttachment {
  url: string;
  originalName: string;
  mimeType: string;
}

export interface RestoredDraft {
  text: string;
  attachments: RestoredAttachment[];
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
    // AI SDK v7 uses `tool-${toolName}` (e.g. tool-webSearch) for static tool
    // parts and `dynamic-tool` for dynamic ones. Both count as content.
    if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) return true;
    return false;
  });
}

/** Extract text + attachments from the last user message, for composer restore. */
export function extractUserDraft(
  messages: UIMessage[],
): RestoredDraft | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    const parts = messages[i].parts as AnyPart[];
    const text = parts
      .filter((p): p is Extract<AnyPart, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim();
    const attachments: RestoredAttachment[] = parts
      .filter(
        (p): p is Extract<AnyPart, { type: 'file' }> => p.type === 'file',
      )
      .map((p) => ({
        url: p.url,
        originalName: p.filename ?? '',
        mimeType: p.mediaType,
      }));
    if (!text && attachments.length === 0) return null;
    return { text, attachments };
  }
  return null;
}

/**
 * Remove the last user message and anything after it (a trailing empty
 * assistant placeholder). Only call this when there is no partial assistant
 * content worth preserving — the caller decides that via the recovery below.
 */
export function removeFailedUserTurn(messages: UIMessage[]): UIMessage[] {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex === -1) return messages;
  return messages.slice(0, lastUserIndex);
}

export type FailureRecovery =
  | { kind: 'failed-send'; draft: RestoredDraft; messageIdsToRemove: string[] }
  | { kind: 'cutoff'; failedAssistantId: string }
  | { kind: 'failed-generate' };

/**
 * Decide how to clean up after a failed generation.
 *
 * Detection is based on the position of messages in the authoritative
 * `finalMessages` array from `onFinish`:
 *
 * - Assistant has partial content → `cutoff`: keep everything, offer Regenerate.
 * - Regeneration (any state) → `failed-generate`: keep everything, just toast.
 *   The user message is always real (saved in a previous turn).
 * - Last message in the list is a user message → `failed-send`: the SDK pushed
 *   the user optimistically but the fetch failed before any stream chunk
 *   arrived (the assistant was never written into the message list). Remove the
 *   ghost user message and restore its text to the composer.
 * - Everything else (mid-stream failure with empty assistant, etc.) →
 *   `failed-generate`: keep the ghost — it's good UX, the user sees what was
 *   attempted and can retry.
 *
 * Removal is expressed as specific message IDs (derived from the authoritative
 * `finalMessages`) so the caller can safely apply the same filter to both the
 * SDK state and the React Query cache without re-deriving from potentially
 * stale cache state.
 */
export function computeFailureRecovery(args: {
  messages: UIMessage[];
  assistantMessage: UIMessage | undefined;
  trigger: 'submit-message' | 'regenerate-message' | null;
}): FailureRecovery {
  const { messages, assistantMessage, trigger } = args;

  // Cutoff: partial content exists. Keep it, offer Regenerate.
  if (assistantMessageHasContent(assistantMessage)) {
    return { kind: 'cutoff', failedAssistantId: assistantMessage!.id };
  }

  // Regeneration failure → never remove. The user message is always real.
  if (trigger === 'regenerate-message') {
    return { kind: 'failed-generate' };
  }

  // Pre-stream failure: the SDK pushed the user optimistically but the fetch
  // failed before any stream chunk arrived — the assistant was never written
  // into the message list. The last message IS the user's ghost.
  if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
    const lastMessage = messages[messages.length - 1];
    const draft = extractUserDraft(messages);
    if (draft) {
      return {
        kind: 'failed-send',
        draft,
        messageIdsToRemove: [lastMessage.id],
      };
    }
  }

  // Everything else (mid-stream failure with empty assistant, etc.):
  // keep the ghost — the user sees what was attempted and can retry.
  return { kind: 'failed-generate' };
}
