import { useMemo } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Returns the active chat UUID from the URL (`/chats/[uuid]`), or null when
 * not on a chat route. `/chats/temporary` is intentionally excluded — it is
 * not a UUID and has no persisted conversation.
 *
 * Shared so the sidebar, header, and any other consumer stay in sync about
 * which conversation is active without each re-implementing the URL parse.
 */
export function useActiveChatId(): string | null {
  const pathname = usePathname();
  return useMemo(() => {
    const match = pathname?.match(/^\/chats\/([a-f0-9-]{36})$/i);
    return match ? match[1] : null;
  }, [pathname]);
}
