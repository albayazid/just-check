"use client";

import ChatSidebar from "@/components/sidebar";
import BrandHeader from "@/components/common/brand-header";
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { usePathname } from 'next/navigation';

/**
 * Routes whose pages render their own header. The chat page owns its header so
 * it can bridge live chat context (for "share visible thread"); the home and
 * temporary pages own theirs to supply header actions. Every other route falls
 * back to the default brand header below.
 */
function routeOwnsHeader(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === '/' ||
    pathname === '/chats/temporary' ||
    /^\/chats\/[a-f0-9-]{36}$/i.test(pathname)
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();

  return (
    <SidebarProvider>
      <ChatSidebar />
      <SidebarInset className="flex h-dvh flex-col overflow-hidden">
        {routeOwnsHeader(pathname) ? (
          /*
           * The page renders its own header as the first child of a full-height
           * flex column and owns the scroll area below it.
           */
          children
        ) : (
          <>
            <BrandHeader />
            <div className="grow overflow-y-auto">{children}</div>
          </>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
