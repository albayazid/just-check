import { useQuery } from '@tanstack/react-query';

interface UsageData {
  periodStart: string | null;
  periodEnd: string | null;
  hasAllowance: boolean;
  remainingPercentage: number;
}

async function fetchUsage(): Promise<UsageData> {
  const response = await fetch('/api/usage');
  if (!response.ok) {
    throw new Error('Failed to fetch usage data');
  }
  return response.json();
}

export function useUsage() {
  return useQuery({
    queryKey: ['usage'],
    queryFn: fetchUsage,
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: true,
  });
}
