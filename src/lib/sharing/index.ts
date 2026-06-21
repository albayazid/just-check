/**
 * Sharing Module
 *
 * Public API for the frozen snapshot sharing system.
 */

export type {
  ShareMode,
  CreateShareInput,
  CreateShareResult,
  RefreshShareInput,
  ShareConversationView,
  SharedMessageView,
  PublicShareView,
  StoredSharedConversation,
  StoredSharedMessage,
} from './types';

export {
  createShareSnapshot,
  refreshShare,
  getPublicShare,
  getShareForConversation,
  revokeShare,
  forkSharedConversation,
  resolveShareAttachment,
} from './share-service';
