import 'server-only';

import { getRequiredEnv } from '@/lib/env-utils.server';
import { PRODUCT_IDS, type ProductId } from '@/lib/subscription-utils';

function isProductId(productId: string): productId is ProductId {
  return Object.values(PRODUCT_IDS).includes(productId as ProductId);
}

export function getDodoProductIds(): Record<ProductId, string> {
  return {
    [PRODUCT_IDS.GO_MONTHLY]: getRequiredEnv('DODO_PRODUCT_ID_GO_MONTHLY'),
    [PRODUCT_IDS.PLUS_MONTHLY]: getRequiredEnv('DODO_PRODUCT_ID_PLUS_MONTHLY'),
    [PRODUCT_IDS.PRO_MONTHLY]: getRequiredEnv('DODO_PRODUCT_ID_PRO_MONTHLY'),
  };
}

export function getDodoProductId(productId: string): string | null {
  if (!isProductId(productId)) {
    return null;
  }

  return getDodoProductIds()[productId];
}

export function getPlanIdFromDodoProductId(dodoProductId: string): ProductId | null {
  const entry = Object.entries(getDodoProductIds()).find(
    ([, mappedDodoProductId]) => mappedDodoProductId === dodoProductId
  );

  return (entry?.[0] as ProductId | undefined) ?? null;
}

/**
 * Daily allowance by plan.
 * These values represent the per-day allowance budget used by billing/webhook sync.
 */
export const PLAN_ALLOWANCES: Record<string, number> = {
  free: 4,
  go_monthly: 13.2,
  plus_monthly: 54,
  pro_monthly: 275,
};

/**
 * Folder count limit by plan.
 * Maximum number of non-deleted folders a user can have.
 */
export const FOLDER_LIMITS: Record<string, number> = {
  free: 2,
  go_monthly: 10,
  plus_monthly: 50,
  pro_monthly: 200,
};

export function getFolderLimit(planId: string): number {
  return FOLDER_LIMITS[planId] ?? FOLDER_LIMITS.free;
}
