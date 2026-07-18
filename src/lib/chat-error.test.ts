import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import {
  classifyChatError,
  parseChatErrorBody,
  chatErrorMessage,
  assistantMessageHasContent,
  extractUserDraft,
  removeFailedUserTurn,
  computeFailureRecovery,
  ChatErrorCode,
} from './chat-error';

// The transport throws `new Error(response.text())`, so the JSON body the route
// emits arrives verbatim in `error.message`. These fixtures mirror that shape.
function routeError(body: unknown, name = 'Error'): Error {
  return Object.assign(new Error(JSON.stringify(body)), { name });
}

function userMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  } as UIMessage;
}

function assistantMessage(id: string, text: string | null): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: text === null ? [] : [{ type: 'text', text }],
  } as UIMessage;
}

describe('parseChatErrorBody', () => {
  it('reads code + message from a JSON route body', () => {
    expect(parseChatErrorBody(routeError({ error: 'Insufficient allowance', code: 'INSUFFICIENT_ALLOWANCE' })))
      .toEqual({ code: 'INSUFFICIENT_ALLOWANCE', message: 'Insufficient allowance' });
  });

  it('returns null for a non-JSON network error message', () => {
    expect(parseChatErrorBody(new TypeError('Failed to fetch'))).toBeNull();
  });

  it('returns null when there is no message', () => {
    expect(parseChatErrorBody(null)).toBeNull();
  });
});

describe('classifyChatError', () => {
  it('classifies via the route code first', () => {
    expect(classifyChatError(routeError({ code: ChatErrorCode.INSUFFICIENT_ALLOWANCE }))).toBe('allowance');
    expect(classifyChatError(routeError({ code: ChatErrorCode.UNAUTHORIZED }))).toBe('auth');
    expect(classifyChatError(routeError({ code: ChatErrorCode.CONVERSATION_NOT_FOUND }))).toBe('not-found');
    expect(classifyChatError(routeError({ code: ChatErrorCode.RATE_LIMITED }))).toBe('rate-limit');
  });

  it('detects network failures (TypeError) without a code', () => {
    expect(classifyChatError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyChatError(new TypeError('Network request failed'))).toBe('network');
  });

  it('falls back to keyword matching on plain-string bodies', () => {
    expect(classifyChatError(new Error('Insufficient allowance'))).toBe('allowance');
    expect(classifyChatError(new Error('Too many requests. Please wait.'))).toBe('rate-limit');
    expect(classifyChatError(new Error('Unauthorized'))).toBe('auth');
    expect(classifyChatError(new Error('Conversation not found'))).toBe('not-found');
  });

  it('defaults to generic for unknown errors', () => {
    expect(classifyChatError(new Error('Failed to process chat'))).toBe('generic');
    expect(classifyChatError(null)).toBe('generic');
  });
});

describe('chatErrorMessage', () => {
  it('returns a non-empty message for every kind', () => {
    const kinds = ['allowance', 'auth', 'network', 'rate-limit', 'not-found', 'generic'] as const;
    for (const kind of kinds) {
      expect(chatErrorMessage(kind).length).toBeGreaterThan(0);
    }
  });
});

describe('assistantMessageHasContent', () => {
  it('is false for undefined / empty / whitespace-only parts', () => {
    expect(assistantMessageHasContent(undefined)).toBe(false);
    expect(assistantMessageHasContent({ parts: [] })).toBe(false);
    expect(assistantMessageHasContent({ parts: [{ type: 'text', text: '   ' }] })).toBe(false);
  });

  it('is true when text, reasoning, a tool call, or a file is present', () => {
    expect(assistantMessageHasContent({ parts: [{ type: 'text', text: 'hi' }] })).toBe(true);
    expect(assistantMessageHasContent({ parts: [{ type: 'reasoning', text: 'thinking' }] })).toBe(true);
    // AI SDK v7 uses tool-${toolName} (e.g. tool-webSearch) for static tool parts.
    const toolPart = { type: 'tool-webSearch', state: 'output-available' } as unknown as UIMessage['parts'][number];
    expect(assistantMessageHasContent({ parts: [toolPart] })).toBe(true);
    const dynamicToolPart = { type: 'dynamic-tool', state: 'output-available' } as unknown as UIMessage['parts'][number];
    expect(assistantMessageHasContent({ parts: [dynamicToolPart] })).toBe(true);
  });
});

describe('extractUserDraft', () => {
  it('extracts text + attachments from the last user message', () => {
    const msgs: UIMessage[] = [
      userMessage('u1', 'first'),
      assistantMessage('a1', 'reply'),
      {
        id: 'u2',
        role: 'user',
        parts: [
          { type: 'text', text: '  hello world  ' },
          { type: 'file', url: 'attachment://abc', mediaType: 'image/png', filename: 'cat.png' },
        ],
      } as UIMessage,
    ];
    expect(extractUserDraft(msgs)).toEqual({
      text: 'hello world',
      attachments: [{ url: 'attachment://abc', originalName: 'cat.png', mimeType: 'image/png' }],
    });
  });

  it('returns null when there is no user message', () => {
    expect(extractUserDraft([assistantMessage('a1', 'hi')])).toBeNull();
  });

  it('returns null when the last user message has no text or files', () => {
    expect(extractUserDraft([{ id: 'u', role: 'user', parts: [] } as UIMessage])).toBeNull();
  });
});

describe('removeFailedUserTurn', () => {
  it('drops the last user message and any trailing assistant placeholder', () => {
    const msgs: UIMessage[] = [
      userMessage('u1', 'first'),
      assistantMessage('a1', 'reply'),
      userMessage('u2', 'stuck'),
      assistantMessage('a2', null), // empty placeholder
    ];
    const cleaned = removeFailedUserTurn(msgs);
    expect(cleaned.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('is a no-op when there is no user message', () => {
    const msgs: UIMessage[] = [assistantMessage('a1', 'hi')];
    expect(removeFailedUserTurn(msgs)).toBe(msgs);
  });
});

describe('computeFailureRecovery', () => {
  const baseMessages: UIMessage[] = [userMessage('u1', 'hi')];

  it('preserves a partial assistant reply (cutoff)', () => {
    const result = computeFailureRecovery({
      messages: [...baseMessages, assistantMessage('a1', 'partial')],
      assistantMessage: assistantMessage('a1', 'partial'),
      trigger: 'submit-message',
    });
    expect(result).toEqual({ kind: 'cutoff', failedAssistantId: 'a1' });
  });

  it('removes the stuck user message + restores the draft on a pre-stream failed send (last message is user)', () => {
    // Pre-stream failure: the SDK pushed the user optimistically but the
    // fetch failed before any stream chunk arrived. The assistant was never
    // written into the message list — the last message IS the user's ghost.
    const result = computeFailureRecovery({
      messages: [...baseMessages, userMessage('u2', 'stuck')],
      assistantMessage: undefined,
      trigger: 'submit-message',
    });
    expect(result.kind).toBe('failed-send');
    if (result.kind !== 'failed-send') return;
    expect(result.draft.text).toBe('stuck');
    expect(result.messageIdsToRemove).toEqual(['u2']);
  });

  it('keeps everything for a mid-stream failure with empty assistant (last message is assistant)', () => {
    // Mid-stream failure: the stream started (assistant was pushed) but died
    // before any content. The ghost is good UX — keep it.
    const result = computeFailureRecovery({
      messages: [...baseMessages, assistantMessage('a2', null)],
      assistantMessage: assistantMessage('a2', null),
      trigger: 'submit-message',
    });
    expect(result.kind).toBe('failed-generate');
  });

  it('does not remove anything for a failed regeneration with no partial', () => {
    const result = computeFailureRecovery({
      messages: [...baseMessages, assistantMessage('a2', null)],
      assistantMessage: assistantMessage('a2', null),
      trigger: 'regenerate-message',
    });
    expect(result.kind).toBe('failed-generate');
  });

  it('returns cutoff for a failed regeneration that produced partial content', () => {
    const result = computeFailureRecovery({
      messages: [...baseMessages, assistantMessage('a2', 'partial')],
      assistantMessage: assistantMessage('a2', 'partial'),
      trigger: 'regenerate-message',
    });
    expect(result).toEqual({ kind: 'cutoff', failedAssistantId: 'a2' });
  });
});
