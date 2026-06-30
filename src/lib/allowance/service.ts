import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isFreeTierEnabled } from '@/lib/app-config.server';
import { PLAN_ALLOWANCES } from '@/lib/subscription-utils.server';

const getSupabase = (): SupabaseClient => {
  return getSupabaseAdminClient();
};

export interface AllowanceStatus {
  periodStart: string | null;
  periodEnd: string | null;
  remainingAllowance: number;
  allotedAllowance: number;
  hasAllowance: boolean;
  remainingPercentage: number;
}

export function getCurrentUtcDailyAllowanceWindow(now = new Date()) {
  const periodStart = new Date(now);
  periodStart.setUTCHours(0, 0, 0, 0);

  const periodEnd = new Date(periodStart);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}

type AllowanceInput = {
  remainingAllowance: number;
  allotedAllowance: number;
  periodStart?: string | null;
  periodEnd?: string | null;
};

function makeAllowanceStatus(input: AllowanceInput): AllowanceStatus {
  const { remainingAllowance, allotedAllowance, ...rest } = input;
  return {
    hasAllowance: remainingAllowance > 0,
    remainingPercentage: allotedAllowance > 0
      ? Number(Math.max(0, (remainingAllowance / allotedAllowance) * 100).toFixed(6))
      : 0,
    ...rest,
    periodStart: rest.periodStart ?? null,
    periodEnd: rest.periodEnd ?? null,
    remainingAllowance,
    allotedAllowance,
  };
}

async function getUserPlanId(clerkUserId: string): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_user_subscription', { p_clerk_user_id: clerkUserId });
  if (error) throw error;
  const subscription = Array.isArray(data) ? data[0] : data;
  return subscription?.plan_id ?? 'free';
}

/**
 * Retrieves the allowance status for a user.
 *
 * Paid: reads allowance row, resets from config if period expired. Same as before.
 * Free: checks kill switch first. If OFF, returns zero immediately.
 *   If ON, reads/creates row and handles daily reset from config.
 */
async function getAllowanceStatusFromDatabase(clerkUserId: string): Promise<AllowanceStatus> {
  const planId = await getUserPlanId(clerkUserId);
  const supabase = getSupabase();
  const isFree = planId === 'free';

  // ---------------------------------------------------------------------------
  // FREE USER — check kill switch first, then read row
  // ---------------------------------------------------------------------------
  if (isFree) {
    const freeEnabled = await isFreeTierEnabled();
    if (!freeEnabled) {
      return makeAllowanceStatus({ remainingAllowance: 0, allotedAllowance: 0 });
    }

    // Kill switch is ON — read row
    const { data, error } = await supabase
      .from('periodic_allowance')
      .select('remaining_allowance, alloted_allowance, period_start, period_end')
      .eq('clerk_user_id', clerkUserId)
      .single();

    // No row — create one with free allowance
    if (error) {
      if (error.code === 'PGRST116') {
        const freeAmount = PLAN_ALLOWANCES.free;
        const { periodStart, periodEnd } = getCurrentUtcDailyAllowanceWindow();

        // Concurrent requests may both reach here — onConflict deduplicates.
        // Both writes are identical values so the extra upsert is harmless.
        // Alternative: a Postgres function with INSERT ... ON CONFLICT DO NOTHING RETURNING *
        // to avoid the redundant write entirely. 
        // Acceptable as-is for now.
        await supabase.from('periodic_allowance').upsert({
          clerk_user_id: clerkUserId,
          alloted_allowance: freeAmount,
          remaining_allowance: freeAmount,
          period_start: periodStart,
          period_end: periodEnd,
          last_reset_at: new Date().toISOString(),
        }, { onConflict: 'clerk_user_id' });

        return makeAllowanceStatus({
          periodStart,
          periodEnd,
          remainingAllowance: freeAmount,
          allotedAllowance: freeAmount,
        });
      }
      throw error;
    }

    // Row exists — parse values
    const remaining = Number(data?.remaining_allowance ?? 0);
    const allotted = Number(data?.alloted_allowance ?? 0);
    const periodEnd = data?.period_end ? new Date(data.period_end) : null;
    const freeAmount = PLAN_ALLOWANCES.free;

    // Period expired — reset from config
    if (periodEnd && new Date() > periodEnd) {
      const resetTime = new Date().toISOString();
      const { periodStart, periodEnd: newPeriodEnd } = getCurrentUtcDailyAllowanceWindow();

      const { data: updateData, error: updateError } = await supabase
        .from('periodic_allowance')
        .update({
          remaining_allowance: freeAmount,
          alloted_allowance: freeAmount,
          period_start: periodStart,
          period_end: newPeriodEnd,
          last_reset_at: resetTime,
        })
        .eq('clerk_user_id', clerkUserId)
        .select('remaining_allowance, alloted_allowance, period_start, period_end')
        .single();

      if (updateError) throw updateError;

      const updatedRemaining = Number(updateData?.remaining_allowance ?? freeAmount);
      const updatedAllotted = Number(updateData?.alloted_allowance ?? freeAmount);

      return makeAllowanceStatus({
        periodStart: updateData?.period_start ?? periodStart,
        periodEnd: updateData?.period_end ?? newPeriodEnd,
        remainingAllowance: updatedRemaining,
        allotedAllowance: updatedAllotted,
      });
    }

    // Period still active — return current status
    return makeAllowanceStatus({
      periodStart: data?.period_start ?? null,
      periodEnd: data?.period_end ?? null,
      remainingAllowance: remaining,
      allotedAllowance: allotted,
    });
  }

  // ---------------------------------------------------------------------------
  // PAID USER — same logic as before
  // ---------------------------------------------------------------------------
  const { data, error } = await supabase
    .from('periodic_allowance')
    .select('remaining_allowance, alloted_allowance, period_start, period_end')
    .eq('clerk_user_id', clerkUserId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return makeAllowanceStatus({ remainingAllowance: 0, allotedAllowance: 0 });
    }
    throw error;
  }

  const remaining = Number(data?.remaining_allowance ?? 0);
  const allotted = Number(data?.alloted_allowance ?? 0);
  const periodEnd = data?.period_end ? new Date(data.period_end) : null;

  if (allotted > 0 && periodEnd && new Date() > periodEnd) {
    const configAmount = PLAN_ALLOWANCES[planId] ?? 0;
    const resetTime = new Date().toISOString();
    const { periodStart, periodEnd: newPeriodEnd } = getCurrentUtcDailyAllowanceWindow();

    const { data: updateData, error: updateError } = await supabase
      .from('periodic_allowance')
      .update({
        remaining_allowance: configAmount,
        alloted_allowance: configAmount,
        period_start: periodStart,
        period_end: newPeriodEnd,
        last_reset_at: resetTime,
      })
      .eq('clerk_user_id', clerkUserId)
      .select('remaining_allowance, alloted_allowance, period_start, period_end')
      .single();

    if (updateError) throw updateError;

    const updatedRemaining = Number(updateData?.remaining_allowance ?? configAmount);
    const updatedAllotted = Number(updateData?.alloted_allowance ?? configAmount);

    return makeAllowanceStatus({
      periodStart: updateData?.period_start ?? periodStart,
      periodEnd: updateData?.period_end ?? newPeriodEnd,
      remainingAllowance: updatedRemaining,
      allotedAllowance: updatedAllotted,
    });
  }

  return makeAllowanceStatus({
    periodStart: data?.period_start ?? null,
    periodEnd: data?.period_end ?? null,
    remainingAllowance: remaining,
    allotedAllowance: allotted,
  });
}

/**
 * Retrieves the remaining allowance (in cents) for a user.
 */
export async function getRemainingAllowance(clerkUserId: string): Promise<number> {
  const status = await getAllowanceStatusFromDatabase(clerkUserId);
  return status.remainingAllowance;
}

export async function getAllowanceStatus(clerkUserId: string): Promise<AllowanceStatus> {
  return getAllowanceStatusFromDatabase(clerkUserId);
}

/**
 * Atomically deducts the specified cost from the user's remaining allowance.
 */
export async function deductAllowance(clerkUserId: string, cost: number): Promise<number> {
  if (cost <= 0) {
    return getRemainingAllowance(clerkUserId);
  }

  const supabase = getSupabase();

  const { data, error } = await supabase.rpc('deduct_allowance', {
    p_clerk_user_id: clerkUserId,
    p_cost: cost,
  });

  if (error) {
    throw error;
  }

  return data ?? 0;
}
