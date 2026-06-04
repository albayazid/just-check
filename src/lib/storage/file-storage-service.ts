import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import type { UploadedFile } from '@/lib/conversation-history/types';
import { v4 as uuidv4 } from 'uuid';

const BUCKET_NAME = 'user-assets';
const URL_EXPIRY_SECONDS = 86400; // 24 hours

/**
 * Generates a storage path for a file
 * Format: private/chat-file-upload/{userId}/{uuid}-{sanitizedFilename}
 */
export function generateStoragePath(
  userId: string,
  filename: string
): string {
  const uuid = uuidv4();
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `private/chat-file-upload/${userId}/${uuid}-${sanitized}`;
}

/**
 * Generates a storage path for a feedback image attachment.
 * Format: private/feedback/{userId}/{feedbackId}/{uuid}-{sanitizedFilename}
 */
export function generateFeedbackStoragePath(
  userId: string,
  feedbackId: string,
  filename: string
): string {
  const uuid = uuidv4();
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `private/feedback/${userId}/${feedbackId}/${uuid}-${sanitized}`;
}

/**
 * Uploads a file to Supabase Storage
 * Returns the storage path
 */
export async function uploadFileToStorage(
  userId: string,
  file: File,
  contentType = file.type
): Promise<string> {
  const supabase = getSupabaseAdminClient();

  const storagePath = generateStoragePath(userId, file.name);

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, file, {
      contentType,
      upsert: false, // Never overwrite
    });

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  return storagePath;
}

/**
 * Uploads a feedback image attachment to Supabase Storage.
 * Returns the storage path.
 */
export async function uploadFeedbackFileToStorage(
  userId: string,
  feedbackId: string,
  file: File,
  contentType = file.type
): Promise<string> {
  const supabase = getSupabaseAdminClient();
  const storagePath = generateFeedbackStoragePath(userId, feedbackId, file.name);

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, file, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload feedback image: ${error.message}`);
  }

  return storagePath;
}

/**
 * Creates a signed URL for a storage path
 * URL expires after 24 hours
 */
export async function createSignedUrl(storagePath: string): Promise<string> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, URL_EXPIRY_SECONDS);

  if (error) {
    throw new Error(`Failed to create signed URL: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Gets cached signed URL from database
 * Returns null if not found or expired
 */
async function getCachedSignedUrl(fileId: string): Promise<string | null> {
  const supabase = getSupabaseAdminClient();
  
  const { data, error } = await supabase
    .from('signed_url_cache')
    .select('signed_url, expires_at')
    .eq('file_id', fileId)
    .single();
  
  if (error || !data) return null;
  
  // Check if cached URL is still valid
  if (new Date(data.expires_at) > new Date()) {
    return data.signed_url;
  }
  
  return null; // Expired
}

/**
 * Caches a signed URL in the database
 */
async function cacheSignedUrl(fileId: string, signedUrl: string, expiresInSeconds: number): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  
  await supabase
    .from('signed_url_cache')
    .upsert({
      file_id: fileId,
      signed_url: signedUrl,
      expires_at: expiresAt.toISOString(),
      cached_at: new Date().toISOString()
    }, { onConflict: 'file_id' });
}

/**
 * @deprecated Use resolveAttachmentUrlForConversation instead.
 * This function uses user-owner-scoped access which doesn't support
 * shared/group chat scenarios.
 */
export async function resolveAttachmentUrl(
  fileId: string,
  requestingUserId: string
): Promise<string> {
  const supabase = getSupabaseAdminClient();

  // Fetch file metadata WITH ownership check in the query
  // This prevents information leakage about file existence and ownership
  const { data: file, error } = await supabase
    .from('file_uploads')
    .select('*')
    .eq('id', fileId)
    .eq('user_id', requestingUserId) // Filter by user in query - no separate check needed
    .single();

  if (error || !file) {
    // Log error for debugging but return generic message to avoid information leakage
    console.error('Attachment resolution failed:', { fileId, error });
    throw new Error('File not found or access denied');
  }

  // Check if file was soft-deleted
  if (file.deleted_at) {
    throw new Error('File has been deleted');
  }

  // Try to get cached URL first
  const cachedUrl = await getCachedSignedUrl(fileId);
  if (cachedUrl) {
    return cachedUrl;
  }

  // Generate fresh signed URL if not cached
  const signedUrl = await createSignedUrl(file.storage_path);
  
  // Cache the new URL
  await cacheSignedUrl(fileId, signedUrl, URL_EXPIRY_SECONDS);
  
  return signedUrl;
}

/**
 * Records file metadata in database after upload
 */
export async function recordFileUpload(
  userId: string,
  storagePath: string,
  file: File,
  metadata: Record<string, unknown> = {},
  mimeType = file.type,
  extractedData?: Record<string, unknown>
): Promise<UploadedFile> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('file_uploads')
    .insert({
      user_id: userId,
      storage_path: storagePath,
      original_filename: file.name,
      mime_type: mimeType,
      file_size: file.size,
      metadata,
      extracted_data: extractedData ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to record file upload: ${error.message}`);
  }

  return data as UploadedFile;
}

/**
 * @deprecated Use getFileUploadForConversation instead.
 * This function uses user-owner-scoped access which doesn't support
 * shared/group chat scenarios.
 */
export async function getFileUploadForUser(
  fileId: string,
  requestingUserId: string
): Promise<UploadedFile> {
  const supabase = getSupabaseAdminClient();

  const { data: file, error } = await supabase
    .from('file_uploads')
    .select('*')
    .eq('id', fileId)
    .eq('user_id', requestingUserId)
    .single();

  if (error || !file) {
    console.error('File metadata lookup failed:', { fileId, error });
    throw new Error('File not found or access denied');
  }

  if (file.deleted_at) {
    throw new Error('File has been deleted');
  }

  return file as UploadedFile;
}

/**
 * Resolves an attachment URL scoped to conversation access.
 * Checks: does the requesting user own the conversation, and does
 * the conversation contain a message referencing this file?
 */
export async function resolveAttachmentUrlForConversation(
  fileId: string,
  requestingUserId: string,
  conversationId: string
): Promise<string> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .rpc('resolve_file_for_conversation', {
      p_file_id: fileId,
      p_clerk_user_id: requestingUserId,
      p_conversation_id: conversationId,
    })
    .single();

  const file = data as UploadedFile | null;

  if (error || !file) {
    console.error('Attachment resolution failed:', { fileId, conversationId, error });
    throw new Error('File not found or access denied');
  }

  return resolveFromStoragePath(fileId, file.storage_path);
}

/**
 * Resolves a signed URL for a previously authorized storage path.
 *
 * @remarks
 * Security-sensitive helper. The `storagePath` value must come only from a
 * trusted server-side source, such as a database row returned after an
 * access-controlled lookup.
 *
 * This function does not verify conversation membership or file ownership.
 * Callers must perform authorization before invoking it.
 *
 * Prefer `resolveAttachmentUrlForConversation` for user-facing attachment
 * requests, because it performs the required conversation-scoped access check.
 *
 * @param storagePath - A trusted storage path that has already passed authorization.
 * @returns A signed URL for accessing the object.
 */
export async function resolveFromStoragePath(
  fileId: string,
  storagePath: string
): Promise<string> {
  const cachedUrl = await getCachedSignedUrl(fileId);
  if (cachedUrl) {
    return cachedUrl;
  }

  const signedUrl = await createSignedUrl(storagePath);
  await cacheSignedUrl(fileId, signedUrl, URL_EXPIRY_SECONDS);

  return signedUrl;
}

/**
 * Fetches file metadata scoped to conversation access.
 * Same access check as resolveAttachmentUrlForConversation but returns
 * the full file record (needed for model preprocessing — mime_type, extracted_data).
 */
export async function getFileUploadForConversation(
  fileId: string,
  requestingUserId: string,
  conversationId: string
): Promise<UploadedFile> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .rpc('resolve_file_for_conversation', {
      p_file_id: fileId,
      p_clerk_user_id: requestingUserId,
      p_conversation_id: conversationId,
    })
    .single();

  const file = data as UploadedFile | null;

  if (error || !file) {
    console.error('File metadata lookup failed:', { fileId, conversationId, error });
    throw new Error('File not found or access denied');
  }

  return file;
}

/**
 * Soft deletes a file (marks as deleted, doesn't remove from storage)
 */
export async function softDeleteFile(fileId: string, userId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase
    .from('file_uploads')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', fileId)
    .eq('user_id', userId); // Ensure user can only delete their own

  if (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

/**
 * Validates that all file IDs are accessible by the user for a given conversation.
 * A file is accessible if:
 *   - The user uploaded it (file_uploads.user_id = clerkUserId)
 *   - OR it's already referenced in a message in this conversation (for group chat reuse)
 *
 * Returns true if ALL files are accessible, false otherwise.
 * Single batch query — one round trip regardless of file count.
 */
export async function validateFileAccess(
  fileIds: string[],
  clerkUserId: string,
  conversationId: string
): Promise<boolean> {
  if (fileIds.length === 0) return true;

  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .rpc('validate_file_access_for_conversation', {
      p_file_ids: fileIds,
      p_clerk_user_id: clerkUserId,
      p_conversation_id: conversationId,
    });

  if (error) {
    console.error('File access validation failed:', error);
    return false; // Fail closed
  }

  return data === true;
}

/**
 * Permanently removes a file from Supabase Storage
 * Use this for cleanup when upload fails midway
 */
export async function deleteFileFromStorage(storagePath: string): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([storagePath]);

  if (error) {
    console.error(`Failed to delete file from storage: ${error.message}`);
  }
}
