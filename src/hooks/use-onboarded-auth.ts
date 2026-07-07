import { useAuth } from '@clerk/nextjs';

export function useOnboardedAuth() {
  const auth = useAuth();

  const isOnboarded = !!((auth.sessionClaims?.publicMetadata as { profileComplete?: boolean } | undefined)?.profileComplete);
  const isSignedInAndOnboarded = auth.isSignedIn && isOnboarded;

  return {
    ...auth,
    isOnboarded,
    isSignedInAndOnboarded
  };
}
