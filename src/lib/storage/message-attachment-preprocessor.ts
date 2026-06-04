import type { UIMessage, UIMessagePart, UploadedFile } from '@/lib/conversation-history/types';
import { getFileUploadForConversation, resolveFromStoragePath } from './file-storage-service';
import { extractFileIdFromAttachmentUrl, isAttachmentUrl } from './attachment-url-utils';
import {
  formatExtractedFileForModel,
  isImageMimeType,
  type FileExtractionMetadata,
} from './file-extraction';

type FileUIPart = Extract<UIMessagePart, { type: 'file' }>;
type TextUIPart = Extract<UIMessagePart, { type: 'text' }>;

function getModelContext(file: UploadedFile): FileExtractionMetadata | undefined {
  if (file.extracted_data && typeof file.extracted_data === 'object') {
    return file.extracted_data as FileExtractionMetadata;
  }

  // Backward compatibility for files uploaded before extracted_data existed.
  const metadata = file.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  const modelContext = metadata.modelContext;
  if (!modelContext || typeof modelContext !== 'object') {
    return undefined;
  }

  return modelContext as FileExtractionMetadata;
}

async function preprocessFilePart(
  part: FileUIPart,
  userId: string,
  conversationId: string
): Promise<FileUIPart | TextUIPart | null> {
  if (!isAttachmentUrl(part.url)) {
    if (part.mediaType.startsWith('image/')) {
      return part;
    }

    return {
      type: 'text',
      text: [
        '<attached_file>',
        `name: ${part.filename ?? 'unknown'}`,
        `mime_type: ${part.mediaType}`,
        'status: unavailable',
        'error: File content was not available as a persisted attachment.',
        '</attached_file>',
      ].join('\n'),
    };
  }

  try {
    const fileId = extractFileIdFromAttachmentUrl(part.url);
    const file = await getFileUploadForConversation(fileId, userId, conversationId);

    if (isImageMimeType(file.mime_type)) {
      // We already verified access via getFileUploadForConversation above,
      // so we can skip the redundant access RPC and resolve from the verified path.
      const resolvedUrl = await resolveFromStoragePath(fileId, file.storage_path);
      return {
        ...part,
        url: resolvedUrl,
        mediaType: file.mime_type,
        filename: file.original_filename,
      };
    }

    return {
      type: 'text',
      text: formatExtractedFileForModel({
        filename: file.original_filename,
        mimeType: file.mime_type,
        extraction: getModelContext(file),
      }),
    };
  } catch (error) {
    console.warn('Failed to preprocess attachment for model:', {
      url: part.url,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

export async function preprocessMessageAttachmentsForModel(
  message: UIMessage,
  userId: string,
  conversationId: string
): Promise<UIMessage> {
  if (message.role !== 'user') {
    return message;
  }

  const processedParts = await Promise.all(
    message.parts.map(async (part): Promise<UIMessagePart | null> => {
      if (part.type !== 'file') {
        return part;
      }

      return preprocessFilePart(part, userId, conversationId);
    })
  );

  return {
    ...message,
    parts: processedParts.filter((part): part is UIMessagePart => part !== null),
  };
}

export async function preprocessMessagesAttachmentsForModel(
  messages: UIMessage[],
  userId: string,
  conversationId: string
): Promise<UIMessage[]> {
  return Promise.all(messages.map((message) => preprocessMessageAttachmentsForModel(message, userId, conversationId)));
}
