import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PrivacySettings, DEFAULT_PRIVACY_SETTINGS } from '@/types/settings';
import { useOnboardedAuth } from './use-onboarded-auth';

async function fetchPrivacySettings(): Promise<PrivacySettings> {
  const response = await fetch('/api/settings/privacy', {
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error('Failed to fetch privacy settings');
  }

  const data = await response.json();
  return data.privacySettings;
}

async function updatePrivacySettingsAPI(settings: Partial<PrivacySettings>): Promise<PrivacySettings> {
  const response = await fetch('/api/settings/privacy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ privacySettings: settings })
  });

  if (!response.ok) {
    throw new Error('Failed to update privacy settings');
  }

  const data = await response.json();
  return data.privacySettings;
}

export function usePrivacySettings() {
  const { isSignedInAndOnboarded } = useOnboardedAuth();

  return useQuery({
    queryKey: ['privacySettings'],
    queryFn: fetchPrivacySettings,
    enabled: isSignedInAndOnboarded,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useUpdatePrivacySettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updatePrivacySettingsAPI,
    onMutate: async (newSettings) => {
      await queryClient.cancelQueries({ queryKey: ['privacySettings'] });

      const previousSettings = queryClient.getQueryData<PrivacySettings>(['privacySettings']);

      queryClient.setQueryData(['privacySettings'], (old: PrivacySettings | undefined) => {
        if (!old) return { ...DEFAULT_PRIVACY_SETTINGS, ...newSettings };
        return { ...old, ...newSettings };
      });

      return { previousSettings };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['privacySettings'], context.previousSettings);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['privacySettings'] });
    }
  });
}

export function usePrivacySettingsValue() {
  const { data } = usePrivacySettings();
  return data || DEFAULT_PRIVACY_SETTINGS;
}
