'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import type { ReactNode } from 'react';
import { APP_BRAND_LOGO_URL, APP_BRAND_NAME } from '@/lib/branding-constants';
import { useSidebar } from '@/components/ui/sidebar';

interface BrandHeaderProps {
  /** Right-side content (page actions / indicators). */
  children?: ReactNode;
}

/**
 * Page-mounted header shell for non-chat pages: a mobile sidebar toggle plus
 * the brand (which links home), with arbitrary right-side content supplied by
 * the page.
 *
 * Layout: [toggle] [brand] ............. [children]
 *
 * The header lives inside the page (not the layout) so page-local context flows
 * in naturally; this shell just keeps the brand chrome consistent across the
 * home and temporary-chat pages.
 */
export default function BrandHeader({ children }: BrandHeaderProps) {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="flex h-header-height shrink-0 items-center bg-background px-1 text-foreground sm:px-2">
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleSidebar}
            className="p-2 text-foreground hover:text-foreground/80 md:hidden"
            aria-label="Toggle Sidebar"
          >
            <Menu size={24} />
          </button>

          <Link
            href="/"
            className="flex select-none items-center gap-2 rounded-lg bg-transparent px-2 py-1 transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Image
              src={APP_BRAND_LOGO_URL}
              alt={`${APP_BRAND_NAME} Logo`}
              width={32}
              height={32}
              className="h-8 w-8"
              priority
            />
            <div className="cursor-pointer text-xl font-bold text-foreground/90 transition-colors md:text-2xl">
              {APP_BRAND_NAME}
            </div>
          </Link>
        </div>

        {children && <div className="flex items-center gap-1">{children}</div>}
      </div>
    </header>
  );
}
