"use client";

import ChatSidebar from "@/components/sidebar";
import Header from '@/components/header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SidebarProvider>
      <ChatSidebar />
      <SidebarInset className="flex h-dvh flex-col overflow-hidden">
        <Header />
        <div className="grow overflow-y-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
