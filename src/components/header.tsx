// src/components/header.tsx
"use client";

import Image from "next/image";
import { APP_BRAND_LOGO_URL, APP_BRAND_NAME } from "@/lib/branding-constants";
import { MessageCircleDashed, MessageCirclePlus, Menu } from 'lucide-react';
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircleDashedCheck } from "@/components/icons/message-circle-dashed-check";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebar } from "@/components/ui/sidebar";

export default function Header() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const { toggleSidebar } = useSidebar();
  const isMainPage = pathname === "/";
  const isTemporaryPage = pathname === "/chats/temporary";
  const isChatPage = pathname.startsWith("/chats/");
  const showNewChatIconAtHeader = isChatPage && !isTemporaryPage && isMobile;

  return (
    <header className="shrink-0 bg-background h-header-height text-foreground px-1 sm:px-2 flex items-center">
      <div className="flex justify-between items-center w-full">

        {/* Left Group: Sidebar toggle + Brand */}
        <div className="flex items-center gap-2">
          {/* Toggles desktop collapse and the mobile drawer (via SidebarProvider) */}
          <button
            type="button"
            onClick={toggleSidebar}
            className="md:hidden p-2 text-foreground hover:text-foreground/80"
            aria-label="Toggle Sidebar"
          >
            <Menu size={24} />
          </button>

          {/* Brand Logo and Name */}
          <Link href="/" className="flex items-center gap-2 hover:bg-accent hover:text-accent-foreground bg-transparent px-2 py-1 rounded-lg select-none transition-colors">
            <Image
              src={APP_BRAND_LOGO_URL}
              alt={`${APP_BRAND_NAME} Logo`}
              width={32}
              height={32}
              className="h-8 w-8"
              priority
            />
            <div className="text-xl text-foreground/90 transition-colors cursor-pointer md:text-2xl font-bold">{APP_BRAND_NAME}</div>
          </Link>
        </div>

        {/* Right Group: Temporary Entry/Indicator */}
        {isMainPage && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/chats/temporary"
                  className="p-2 text-foreground hover:text-foreground/80 hover:bg-accent rounded-lg transition-colors"
                  aria-label="Start temporary chat"
                >
                  <MessageCircleDashed size={20} />
                </Link>
              </TooltipTrigger>
              <TooltipContent>
                <p>Temporary Chat</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {isTemporaryPage && (
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="p-2 text-foreground rounded-lg"
                    aria-label="Temporary chat active"
                  >
                    <MessageCircleDashedCheck size={20} />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Temporary Chat Enabled</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {isMobile && (
              <Link
                href="/"
                className="p-2 text-foreground hover:text-foreground/80 hover:bg-accent rounded-lg transition-colors"
                aria-label="New chat"
              >
                <MessageCirclePlus size={20} />
              </Link>
            )}
          </div>
        )}
        {showNewChatIconAtHeader && (
          <Link
            href="/"
            className="p-2 text-foreground hover:text-foreground/80 hover:bg-accent rounded-lg transition-colors"
            aria-label="New chat"
          >
            <MessageCirclePlus size={20} />
          </Link>
        )}
      </div>
    </header>
  );
};
