import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import {
  classifyChatError,
  parseChatErrorBody,
  chatErrorMessage,
  assistantMessageHasContent,
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

  it('detects Safari network failures (plain Error: Load failed)', () => {
    expect(classifyChatError(new Error('Load failed'))).toBe('network');
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

  it('returns generic for JSON errors with unknown codes (does not keyword-match raw JSON)', () => {
    expect(classifyChatError(routeError({ error: 'Keyword not found in input', code: 'VALIDATION_ERROR' }))).toBe('generic');
    expect(classifyChatError(routeError({ error: 'File not found or access denied', code: 'FILE_ACCESS_DENIED' }))).toBe('generic');
    expect(classifyChatError(routeError({ error: 'Failed to process chat', code: 'INTERNAL_ERROR' }))).toBe('generic');
  });

  it('returns generic for JSON errors with no code (does not keyword-match raw JSON)', () => {
    expect(classifyChatError(routeError({ error: 'File not found or access denied' }))).toBe('generic');
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

  it('tags the stuck user message as failed on a pre-stream failed send', () => {
    const result = computeFailureRecovery({
      messages: [...baseMessages, userMessage('u2', 'stuck')],
      assistantMessage: undefined,
      trigger: 'submit-message',
    });
    expect(result).toEqual({ kind: 'failed-user-message', failedUserId: 'u2' });
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
