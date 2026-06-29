import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Module mocks must be declared before the SUT import.
vi.mock("@/lib/supabase-client.server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/app-config.server", () => ({
  isFreeTierEnabled: vi.fn(),
}));

import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { isFreeTierEnabled } from "@/lib/app-config.server";
import { createMockSupabaseClient, pgError } from "@/test/mocks/supabase";
import {
  getAllowanceStatus,
  getRemainingAllowance,
  deductAllowance,
  getCurrentUtcDailyAllowanceWindow,
} from "./service";

// A consistent "now" for time-aware tests. UTC midnight so the daily window is
// exactly [today 00:00 UTC, today+1 00:00 UTC).
const NOW = new Date("2026-06-28T00:00:00Z");

function installSupabase(rpc: Record<string, never> | object, tables: object) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({ rpc, tables } as never) as never,
  );
}
function installFreeTier(enabled: boolean) {
  vi.mocked(isFreeTierEnabled).mockResolvedValue(enabled);
}

describe("getCurrentUtcDailyAllowanceWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("returns the UTC midnight window for the current day", () => {
    const { periodStart, periodEnd } = getCurrentUtcDailyAllowanceWindow();
    expect(periodStart).toBe("2026-06-28T00:00:00.000Z");
    expect(periodEnd).toBe("2026-06-29T00:00:00.000Z");
  });

  it("accepts an explicit `now` and returns the window containing it", () => {
    const afternoon = new Date("2026-06-28T17:45:00Z");
    const { periodStart, periodEnd } = getCurrentUtcDailyAllowanceWindow(afternoon);
    expect(periodStart).toBe("2026-06-28T00:00:00.000Z");
    expect(periodEnd).toBe("2026-06-29T00:00:00.000Z");
  });

  it("returns ISO strings in the correct order (start before end)", () => {
    const { periodStart, periodEnd } = getCurrentUtcDailyAllowanceWindow();
    expect(new Date(periodStart).getTime()).toBeLessThan(new Date(periodEnd).getTime());
  });
});

describe("getAllowanceStatus — free user", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("returns zero allowance when the free-tier kill switch is OFF", async () => {
    installSupabase(
      { get_user_subscription: { data: { plan_id: "free" }, error: null } },
      {},
    );
    installFreeTier(false);

    const status = await getAllowanceStatus("user_free");

    expect(status.hasAllowance).toBe(false);
    expect(status.remainingAllowance).toBe(0);
    expect(status.allotedAllowance).toBe(0);
    expect(status.remainingPercentage).toBe(0);
    expect(isFreeTierEnabled).toHaveBeenCalledTimes(1);
    // When the kill switch is off, the periodic_allowance table is never read.
    for (const result of vi.mocked(getSupabaseAdminClient).mock.results) {
      expect(result.value.from).not.toHaveBeenCalledWith("periodic_allowance");
    }
  });

  it("creates a fresh row at the free allowance when no row exists (PGRST116)", async () => {
    installSupabase(
      { get_user_subscription: { data: { plan_id: "free" }, error: null } },
      {
        periodic_allowance: { data: null, error: pgError("PGRST116") },
      },
    );
    installFreeTier(true);

    const status = await getAllowanceStatus("user_free");

    // PLAN_ALLOWANCES.free = 4
    expect(status.remainingAllowance).toBe(4);
    expect(status.allotedAllowance).toBe(4);
    expect(status.hasAllowance).toBe(true);
    expect(status.remainingPercentage).toBe(100);
  });

  it("returns the existing row unchanged when the period is still active", async () => {
    installSupabase(
      { get_user_subscription: { data: { plan_id: "free" }, error: null } },
      {
        periodic_allowance: {
          data: {
            remaining_allowance: 1,
            alloted_allowance: 4,
            period_start: "2026-06-28T00:00:00.000Z",
            period_end: "2026-06-29T00:00:00.000Z",
          },
          error: null,
        },
      },
    );
    installFreeTier(true);

    const status = await getAllowanceStatus("user_free");

    expect(status.remainingAllowance).toBe(1);
    expect(status.allotedAllowance).toBe(4);
    expect(status.hasAllowance).toBe(true);
    expect(status.remainingPercentage).toBe(25);
  });

  it("resets to the free allowance when the period has expired", async () => {
    // First query on periodic_allowance returns the expired row; the reset
    // `.update()...single()` returns the refreshed values. period_end is set
    // strictly before NOW so `new Date() > periodEnd` (strict >) is true.
    installSupabase(
      { get_user_subscription: { data: { plan_id: "free" }, error: null } },
      {
        periodic_allowance: [
          {
            data: {
              remaining_allowance: 0,
              alloted_allowance: 4,
              period_start: "2026-06-26T00:00:00.000Z",
              period_end: "2026-06-27T00:00:00.000Z", // strictly before NOW
            },
            error: null,
          },
          {
            data: {
              remaining_allowance: 4,
              alloted_allowance: 4,
              period_start: "2026-06-28T00:00:00.000Z",
              period_end: "2026-06-29T00:00:00.000Z",
            },
            error: null,
          },
        ],
      },
    );
    installFreeTier(true);

    const status = await getAllowanceStatus("user_free");

    expect(status.remainingAllowance).toBe(4);
    expect(status.allotedAllowance).toBe(4);
    expect(status.remainingPercentage).toBe(100);
  });

  it("rethrows unexpected database errors from the allowance read", async () => {
    installSupabase(
      { get_user_subscription: { data: { plan_id: "free" }, error: null } },
      {
        periodic_allowance: { data: null, error: pgError("XYZ999", "boom") },
      },
    );
    installFreeTier(true);

    await expect(getAllowanceStatus("user_free")).rejects.toThrowError(/boom/);
  });
});

describe("getAllowanceStatus — paid user", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("returns zero when no allowance row exists (PGRST116)", async () => {
    installSupabase(
      { get_user_subscription: { data: { plan_id: "pro_monthly" }, error: null } },
      {
        periodic_allowance: { data: null, error: pgError("PGRST116") },
      },
    );

    const status = await getAllowanceStatus("user_pro");

    expect(status.remainingAllowance).toBe(0);
    expect(status.allotedAllowance).toBe(0);
    expect(status.hasAllowance).toBe(false);
    // The free-tier kill switch is irrelevant for paid users.
    expect(isFreeTierEnabled).not.toHaveBeenCalled();
  });

  it("returns the existing row unchanged when the period is still active", async () => {
    installSupabase(
      { get_user_subscription: { data: { plan_id: "pro_monthly" }, error: null } },
      {
        periodic_allowance: {
          data: {
            remaining_allowance: 100,
            alloted_allowance: 275,
            period_start: "2026-06-28T00:00:00.000Z",
            period_end: "2026-06-29T00:00:00.000Z",
          },
          error: null,
        },
      },
    );

    const status = await getAllowanceStatus("user_pro");

    expect(status.remainingAllowance).toBe(100);
    expect(status.allotedAllowance).toBe(275);
  });

  it("resets to the configured plan amount when the period has expired", async () => {
    // PLAN_ALLOWANCES.pro_monthly = 275
    installSupabase(
      { get_user_subscription: { data: { plan_id: "pro_monthly" }, error: null } },
      {
        periodic_allowance: [
          {
            data: {
              remaining_allowance: 0,
              alloted_allowance: 275,
              period_start: "2026-06-26T00:00:00.000Z",
              period_end: "2026-06-27T00:00:00.000Z", // strictly before NOW
            },
            error: null,
          },
          {
            data: {
              remaining_allowance: 275,
              alloted_allowance: 275,
              period_start: "2026-06-28T00:00:00.000Z",
              period_end: "2026-06-29T00:00:00.000Z",
            },
            error: null,
          },
        ],
      },
    );

    const status = await getAllowanceStatus("user_pro");

    expect(status.remainingAllowance).toBe(275);
    expect(status.remainingPercentage).toBe(100);
  });

  it("rethrows unexpected database errors", async () => {
    installSupabase(
      { get_user_subscription: { data: { plan_id: "pro_monthly" }, error: null } },
      {
        periodic_allowance: { data: null, error: pgError("XYZ888", "paid boom") },
      },
    );

    await expect(getAllowanceStatus("user_pro")).rejects.toThrowError(/paid boom/);
  });
});

describe("getRemainingAllowance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to getAllowanceStatus and returns remainingAllowance", async () => {
    installSupabase(
      { get_user_subscription: { data: { plan_id: "free" }, error: null } },
      {},
    );
    installFreeTier(false); // returns remaining 0

    expect(await getRemainingAllowance("user_free")).toBe(0);
  });
});

describe("deductAllowance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits and reads the remaining allowance when cost <= 0", async () => {
    installSupabase(
      { get_user_subscription: { data: { plan_id: "free" }, error: null } },
      {},
    );
    installFreeTier(false);

    const remaining = await deductAllowance("user_free", 0);

    expect(remaining).toBe(0);
    // No deduct_allowance RPC call — only the plan-id lookup.
    const clients = vi.mocked(getSupabaseAdminClient).mock.results.map(
      (r) => r.value as ReturnType<typeof createMockSupabaseClient>,
    );
    const allRpcCalls = clients.flatMap((c) => c.rpc.mock.calls.map((call: unknown[]) => call[0]));
    expect(allRpcCalls).not.toContain("deduct_allowance");
  });

  it("calls the deduct_allowance RPC and returns its result for a positive cost", async () => {
    installSupabase(
      {
        get_user_subscription: { data: { plan_id: "free" }, error: null },
        deduct_allowance: { data: 3.5, error: null },
      },
      {},
    );
    installFreeTier(false);

    const remaining = await deductAllowance("user_free", 0.5);

    expect(remaining).toBe(3.5);
    // cost > 0 short-circuits past getRemainingAllowance, so getSupabase is
    // called exactly once (directly inside deductAllowance).
    const deductClient = vi.mocked(getSupabaseAdminClient).mock.results[0]?.value;
    expect(deductClient.rpc).toHaveBeenCalledWith("deduct_allowance", {
      p_clerk_user_id: "user_free",
      p_cost: 0.5,
    });
  });

  it("throws when the deduct_allowance RPC errors", async () => {
    installSupabase(
      {
        get_user_subscription: { data: { plan_id: "free" }, error: null },
        deduct_allowance: { data: null, error: pgError("P0001", "insufficient") },
      },
      {},
    );
    installFreeTier(false);

    await expect(deductAllowance("user_free", 1)).rejects.toThrowError(/insufficient/);
  });

  it("returns 0 when the RPC returns null data without error", async () => {
    installSupabase(
      {
        get_user_subscription: { data: { plan_id: "free" }, error: null },
        deduct_allowance: { data: null, error: null },
      },
      {},
    );
    installFreeTier(false);

    expect(await deductAllowance("user_free", 1)).toBe(0);
  });
});

describe("AllowanceStatus shape", () => {
  it("computes remainingPercentage and clamps negatives to 0", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    installSupabase(
      { get_user_subscription: { data: [{ plan_id: "free" }], error: null } },
      {
        // remaining > allotted to prove clamping (Math.max(0, ...))
        periodic_allowance: {
          data: {
            remaining_allowance: -2,
            alloted_allowance: 4,
            period_start: "2026-06-28T00:00:00.000Z",
            period_end: "2026-06-29T00:00:00.000Z",
          },
          error: null,
        },
      },
    );
    installFreeTier(true);

    const status = await getAllowanceStatus("user_free");

    expect(status.remainingAllowance).toBe(-2);
    expect(status.remainingPercentage).toBe(0); // -50% clamped to 0
    vi.useRealTimers();
  });
});
