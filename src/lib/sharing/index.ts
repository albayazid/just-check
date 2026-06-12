/**
 * Sharing Module
 *
 * Public API for the frozen snapshot sharing system.
 */

export type {
  ShareMode,
  CreateShareInput,
  CreateShareResult,
  ShareListItem,
  SharedMessageView,
  PublicShareView,
  StoredSharedConversation,
  StoredSharedMessage,
} from './types';

export {
  createShareSnapshot,
  getPublicShare,
  listSharesForConversation,
  revokeShare,
  forkSharedConversation,
  resolveShareAttachment,
} from './share-service';
