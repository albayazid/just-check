import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shared Conversation — Lumy',
  description: 'View a shared AI conversation on Lumy.',
  robots: { index: false, follow: false },
};

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharePageClient token={token} />;
}

import SharePageClient from './page-client';
