import { safeValidateUIMessages, type UIMessage } from 'ai';
import { SUPPORTED_FILE_TYPES } from '@/lib/storage/file-validation';
import { isAttachmentUrl } from '@/lib/storage/attachment-url-utils';

const MAX_FILES_PER_MESSAGE = 5;

export interface MessageValidationSuccess {
  success: true;
  messages: UIMessage[];
}

export interface MessageValidationFailure {
  success: false;
  error: string;
  details?: string[];
}

export type MessageValidationResult = MessageValidationSuccess | MessageValidationFailure;

/**
 * Validates the messages array from a chat API request.
 *
 * Pass 1: Structural validation via AI SDK's safeValidateUIMessages.
 *         Ensures every message has correct shape (id, role, parts).
 *
 * Pass 2: Application constraints on user messages:
 *         - File part URLs must be valid attachment://{uuid} format
 *         - mediaType on file parts must be in SUPPORTED_FILE_TYPES
 *         - File count in last user message <= MAX_FILES_PER_MESSAGE
 */
export async function validateChatMessages(
  rawMessages: unknown,
): Promise<MessageValidationResult> {
  // Pass 1: Structural validation
  const structuralResult = await safeValidateUIMessages({
    messages: rawMessages,
  });

  if (!structuralResult.success) {
    return {
      success: false,
      error: 'Invalid message structure',
      details: [structuralResult.error.message],
    };
  }

  const messages = structuralResult.data;

  // Pass 2: Application constraints
  const errors: string[] = [];

  // Find the last user message index
  let lastUserMessageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserMessageIndex = i;
      break;
    }
  }

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];
    if (msg.role !== 'user') continue;

    for (let partIdx = 0; partIdx < msg.parts.length; partIdx++) {
      const part = msg.parts[partIdx];
      if (part.type !== 'file') continue;

      // Validate URL format: must be attachment://{uuid}
      if (!isAttachmentUrl(part.url)) {
        errors.push(
          `messages[${msgIdx}].parts[${partIdx}].url: File URL must be in attachment://{uuid} format, got "${part.url.substring(0, 50)}"`,
        );
      }

      // Validate mediaType is in the supported list
      if (!(SUPPORTED_FILE_TYPES as readonly string[]).includes(part.mediaType)) {
        errors.push(
          `messages[${msgIdx}].parts[${partIdx}].mediaType: Unsupported media type "${part.mediaType}"`,
        );
      }
    }
  }

  // Validate file count in last user message only
  if (lastUserMessageIndex >= 0) {
    const lastUserMsg = messages[lastUserMessageIndex];
    const fileCount = lastUserMsg.parts.filter(p => p.type === 'file').length;
    if (fileCount > MAX_FILES_PER_MESSAGE) {
      errors.push(
        `Too many files in message: ${fileCount} files, maximum is ${MAX_FILES_PER_MESSAGE}`,
      );
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      error: 'Message validation failed',
      details: errors,
    };
  }

  return { success: true, messages };
}
