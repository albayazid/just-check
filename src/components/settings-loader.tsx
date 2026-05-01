"use client";

import { usePrivacySettings } from '@/hooks/use-privacy-settings';
import { useAICustomizationSettings } from '@/hooks/use-ai-customization-settings';
import { useOnboardedAuth } from '@/hooks/use-onboarded-auth';
import { useEffect } from 'react';
import { toast } from 'sonner';

export function SettingsLoader({ children }: { children: React.ReactNode }) {
  const { isSignedInAndOnboarded } = useOnboardedAuth();
  const privacyQuery = usePrivacySettings();
  const aiQuery = useAICustomizationSettings();

  const isError = privacyQuery.isError || aiQuery.isError;

  useEffect(() => {
    if (isError && isSignedInAndOnboarded) {
      toast.error('Settings failed to load', {
        description: (
          <span>
            Please refresh the page. If this persists,{' '}
            <a href="/feedback" className="underline hover:text-foreground/80">
              please provide feedback
            </a>
            .
          </span>
        ),
        action: {
          label: 'Refresh',
          onClick: () => window.location.reload()
        },
        duration: 8000,
      });
    }
  }, [isError, isSignedInAndOnboarded]);

  return <>{children}</>;
}
