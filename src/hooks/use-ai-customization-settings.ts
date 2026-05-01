import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AICustomizationSettings, DEFAULT_AI_CUSTOMIZATION_SETTINGS } from '@/types/settings';
import { useOnboardedAuth } from './use-onboarded-auth';

async function fetchAICustomizationSettings(): Promise<AICustomizationSettings> {
  const response = await fetch('/api/settings/ai-customization', {
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error('Failed to fetch AI customization settings');
  }

  const data = await response.json();
  return data.aiCustomizationSettings;
}

async function updateAICustomizationSettingsAPI(settings: Partial<AICustomizationSettings>): Promise<AICustomizationSettings> {
  const response = await fetch('/api/settings/ai-customization', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ aiCustomizationSettings: settings })
  });

  if (!response.ok) {
    throw new Error('Failed to update AI customization settings');
  }

  const data = await response.json();
  return data.aiCustomizationSettings;
}

export function useAICustomizationSettings() {
  const { isSignedInAndOnboarded } = useOnboardedAuth();

  return useQuery({
    queryKey: ['aiCustomizationSettings'],
    queryFn: fetchAICustomizationSettings,
    enabled: isSignedInAndOnboarded,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useUpdateAICustomizationSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateAICustomizationSettingsAPI,
    onMutate: async (newSettings) => {
      await queryClient.cancelQueries({ queryKey: ['aiCustomizationSettings'] });

      const previousSettings = queryClient.getQueryData<AICustomizationSettings>(['aiCustomizationSettings']);

      queryClient.setQueryData(['aiCustomizationSettings'], (old: AICustomizationSettings | undefined) => {
        if (!old) return { ...DEFAULT_AI_CUSTOMIZATION_SETTINGS, ...newSettings };
        return { ...old, ...newSettings };
      });

      return { previousSettings };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['aiCustomizationSettings'], context.previousSettings);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['aiCustomizationSettings'] });
    }
  });
}

export function useAICustomizationSettingsValue() {
  const { data } = useAICustomizationSettings();
  return data || DEFAULT_AI_CUSTOMIZATION_SETTINGS;
}
