/**
 * Env-stubbing helpers.
 *
 * `vi.stubEnv(key, value)` sets `process.env[key]` and restores it after the
 * test. These helpers group related env vars so tests don't sprinkle raw
 * string keys everywhere.
 *
 * Use inside `beforeEach` (restoration is automatic via Vitest's
 * `unstubGlobals: true` + `restoreMocks: true` config).
 */
import { PRODUCT_IDS } from "@/lib/subscription-utils";

/**
 * Stubs the three `DODO_PRODUCT_ID_*` env vars so `subscription-utils.server`
 * mappers (`getDodoProductIds`, `getDodoProductId`, `getPlanIdFromDodoProductId`)
 * work in tests.
 *
 * Returns a map of productId → fake Dodo id for assertions.
 */
export function stubDodoProductEnvs(vitest: { stubEnv: (k: string, v: string) => void }) {
  const ids = {
    [PRODUCT_IDS.GO_MONTHLY]: "dodo_go_test",
    [PRODUCT_IDS.PLUS_MONTHLY]: "dodo_plus_test",
    [PRODUCT_IDS.PRO_MONTHLY]: "dodo_pro_test",
  } as Record<string, string>;
  vitest.stubEnv("DODO_PRODUCT_ID_GO_MONTHLY", ids[PRODUCT_IDS.GO_MONTHLY]);
  vitest.stubEnv("DODO_PRODUCT_ID_PLUS_MONTHLY", ids[PRODUCT_IDS.PLUS_MONTHLY]);
  vitest.stubEnv("DODO_PRODUCT_ID_PRO_MONTHLY", ids[PRODUCT_IDS.PRO_MONTHLY]);
  return ids;
}
