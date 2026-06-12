import Image from 'next/image';
import Link from 'next/link';
import { APP_BRAND_LOGO_URL, APP_BRAND_NAME, PARENT_COMPANY_NAME } from '@/lib/branding-constants';

export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/95 backdrop-blur-sm py-3 px-4">
        <Link href="/" className="inline-flex items-center gap-2">
          <Image
            src={APP_BRAND_LOGO_URL}
            alt={`${APP_BRAND_NAME} Logo`}
            width={28}
            height={28}
            className="h-7 w-7"
          />
          <span className="text-lg font-bold text-foreground/90">{APP_BRAND_NAME}</span>
        </Link>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
