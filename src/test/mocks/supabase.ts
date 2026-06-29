import { vi } from "vitest";

/**
 * Mock Supabase admin client.
 *
 * The real `@supabase/supabase-js` client returns chainable query builders:
 *   await supabase.from('t').select().eq('a', 1).single()  // → { data, error }
 *   await supabase.from('t').upsert(row)                    // → { data, error }
 *   await supabase.rpc('fn', args)                          // → { data, error }
 *
 * Every builder is thenable and resolves to `{ data, error }`. This mock
 * reproduces that: each `.from(table)` returns a chain where any method
 * (`select`/`eq`/`insert`/`update`/`upsert`/etc.) returns the same chain, and
 * awaiting it (or calling `.single()`) resolves to the per-table configured
 * result.
 *
 * Usage in a test file:
 *
 *   vi.mock("@/lib/supabase-client.server", () => ({
 *     getSupabaseAdminClient: vi.fn(),
 *   }));
 *   import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
 *   import { createMockSupabaseClient } from "@/test/mocks/supabase";
 *
 *   beforeEach(() => {
 *     vi.mocked(getSupabaseAdminClient).mockReturnValue(
 *       createMockSupabaseClient({
 *         rpc: { get_user_subscription: { data: [{ plan_id: "free" }], error: null } },
 *         tables: {
 *           periodic_allowance: { data: { remaining_allowance: 4 }, error: null },
 *         },
 *       }),
 *     );
 *   });
 */

export type SupabaseResult = { data: unknown; error: unknown };

export interface SupabaseMockConfig {
  /** Per-RPC-name return value. Default `{ data: null, error: null }`. */
  rpc?: Record<string, SupabaseResult>;
  /**
   * Per-table return value for queries on that table. Pass a single result to
   * return it for every query, or an array to return them in order (first
   * query gets `[0]`, second gets `[1]`, etc.; the last array element is
   * reused for any further queries). The order matches call order regardless
   * of which chain methods (`.select`/`.update`/`.upsert`/…) are used.
   */
  tables?: Record<string, SupabaseResult | SupabaseResult[]>;
}

const DEFAULT_RESULT: SupabaseResult = { data: null, error: null };

/** Returns a getter that handles both single-result and sequential-array config. */
function makeResultGetter(config: SupabaseResult | SupabaseResult[] | undefined) {
  if (Array.isArray(config)) {
    // Copy so repeated test runs don't drain the same array.
    const queue = [...config];
    return () => {
      if (queue.length > 1) return queue.shift()!;
      return queue[0] ?? DEFAULT_RESULT;
    };
  }
  const fixed = config ?? DEFAULT_RESULT;
  return () => fixed;
}

export function createMockSupabaseClient(config: SupabaseMockConfig = {}) {
  const rpcResults = config.rpc ?? {};
  const tableGetters: Record<string, () => SupabaseResult> = {};
  for (const tableName of Object.keys(config.tables ?? {})) {
    tableGetters[tableName] = makeResultGetter(config.tables![tableName]);
  }

  // Chains are memoized per table so repeated `client.from('t')` calls return
  // the SAME chain instance. This lets tests inspect accumulated call history:
  //   client.from('t').insert.mock.calls  // all inserts on 't', across calls
  const chainCache: Record<string, Record<string, unknown>> = {};

  const createChain = (tableName: string): Record<string, unknown> => {
    if (chainCache[tableName]) return chainCache[tableName];
    const getter = tableGetters[tableName] ?? (() => DEFAULT_RESULT);
    const result = () => getter();
    const chain: Record<string, unknown> = {};

    const selfReturning = vi.fn(() => chain);
    chain.select = selfReturning;
    chain.eq = selfReturning;
    chain.neq = selfReturning;
    chain.in = selfReturning;
    chain.order = selfReturning;
    chain.range = selfReturning;
    chain.limit = selfReturning;
    chain.insert = selfReturning;
    chain.update = selfReturning;
    chain.upsert = selfReturning;
    chain.delete = selfReturning;
    chain.maybeSingle = vi.fn(() => result());
    // `.single()` is terminal — returns the result object directly. Awaited
    // or destructured, both work since a plain object is "awaitable".
    chain.single = vi.fn(() => result());
    // Make the chain thenable so `await supabase.from('t').upsert(row)` works.
    // Each await pulls the next configured result (supports sequential calls).
    chain.then = (resolve: (v: SupabaseResult) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(result()).then(resolve, reject);

    chainCache[tableName] = chain;
    return chain;
  };

  const client = {
    from: vi.fn((table: string) => createChain(table)),
    rpc: vi.fn((name: string) => rpcResults[name] ?? DEFAULT_RESULT),
  };

  return client;
}

/**
 * Convenience: build a Postgrest-shaped error object. Several branches in the
 * codebase key off `error.code` (e.g. `'PGRST116'` = no row, `'23505'` = unique
 * violation). Tests need to construct these explicitly.
 */
export function pgError(code: string, message = ""): { code: string; message: string } {
  return { code, message };
}

/**
 * Extracts the row passed to the Nth `.insert()` call on a table. The chain is
 * typed loosely (`Record<string, unknown>`) so `.insert.mock` is `unknown` to
 * TS — this helper centralises the cast so tests don't scatter `as` everywhere.
 */
export function getInsertedRow(
  client: ReturnType<typeof createMockSupabaseClient>,
  table: string,
  index = 0,
): Record<string, unknown> {
  const chain = client.from(table) as unknown as {
    insert: ReturnType<typeof vi.fn>;
  };
  return chain.insert.mock.calls[index]?.[0] as Record<string, unknown>;
}
