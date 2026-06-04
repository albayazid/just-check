import { UUID_REGEX } from '@/lib/uuid-utils';

/**
 * Shared utilities for working with the attachment:// URL scheme.
 *
 * These are pure functions (no platform APIs) so they are safe to import
 * from both server and client code.
 */

export const ATTACHMENT_URL_PREFIX = 'attachment://';

/**
 * Checks if a URL is a valid attachment URL (attachment://{uuid})
 */
export function isAttachmentUrl(url: string): boolean {
  if (!url.startsWith(ATTACHMENT_URL_PREFIX)) return false;
  const fileId = url.slice(ATTACHMENT_URL_PREFIX.length);
  return UUID_REGEX.test(fileId);
}

/**
 * Extracts the file ID from an attachment URL
 * Format: attachment://{fileId}
 */
export function extractFileIdFromAttachmentUrl(url: string): string {
  if (!isAttachmentUrl(url)) {
    throw new Error('Invalid attachment URL');
  }
  return url.slice(ATTACHMENT_URL_PREFIX.length);
}
