import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./service", () => ({
  deductAllowance: vi.fn(),
}));
vi.mock("@/lib/supabase-client.server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { deductAllowance } from "./service";
import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { createMockSupabaseClient } from "@/test/mocks/supabase";
import { chargeAndLogToolAllowance } from "./tool-charging";

const args = {
  toolName: "web_search",
  args: { query: "test" },
  result: { hits: 3 },
  cost: 0.5,
  clerkUserId: "user_1",
  messageId: "msg_1",
  metadata: { latency_ms: 120 },
};

function installSupabase(tables: object) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({ tables } as never) as never,
  );
}

describe("chargeAndLogToolAllowance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    installSupabase({ tool_usage_log: { data: null, error: null } });
  });

  describe("cost gating", () => {
    it("is a total no-op when cost <= 0 (no deduction, no insert)", async () => {
      await chargeAndLogToolAllowance({ ...args, cost: 0 });

      expect(deductAllowance).not.toHaveBeenCalled();
      const client = vi.mocked(getSupabaseAdminClient).mock.results[0]?.value;
      // The supabase client was never even requested when cost <= 0.
      expect(getSupabaseAdminClient).not.toHaveBeenCalled();
      expect(client).toBeUndefined();
    });

    it("skips for negative cost too", async () => {
      await chargeAndLogToolAllowance({ ...args, cost: -1 });
      expect(deductAllowance).not.toHaveBeenCalled();
    });
  });

  describe("happy path", () => {
    it("deducts the allowance and inserts a tool_usage_log row", async () => {
      vi.mocked(deductAllowance).mockResolvedValue(3.5);

      await chargeAndLogToolAllowance(args);

      expect(deductAllowance).toHaveBeenCalledWith("user_1", 0.5);
      const client = vi.mocked(getSupabaseAdminClient).mock.results[0]?.value;
      expect(client.from).toHaveBeenCalledWith("tool_usage_log");
      // The insert chain was invoked with the expected row shape.
      const insertCall = client.from("tool_usage_log").insert.mock.calls[0]?.[0];
      expect(insertCall).toMatchObject({
        clerk_user_id: "user_1",
        message_id: "msg_1",
        tool_name: "web_search",
        estimated_cost_cents: 0.5,
        metadata: { latency_ms: 120 },
      });
    });

    it("falls back to null message_id when none is provided", async () => {
      vi.mocked(deductAllowance).mockResolvedValue(1);

      const { messageId: _omitted, ...withoutId } = args;
      void _omitted;
      await chargeAndLogToolAllowance(withoutId);

      const client = vi.mocked(getSupabaseAdminClient).mock.results[0]?.value;
      const insertCall = client.from("tool_usage_log").insert.mock.calls[0]?.[0];
      expect(insertCall.message_id).toBeNull();
    });
  });

  describe("best-effort error handling", () => {
    it("still logs usage when deduction fails", async () => {
      vi.mocked(deductAllowance).mockRejectedValue(new Error("db down"));

      await chargeAndLogToolAllowance(args);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to deduct allowance"),
        expect.any(Error),
      );
      // The insert still happened.
      expect(getSupabaseAdminClient).toHaveBeenCalled();
      const client = vi.mocked(getSupabaseAdminClient).mock.results[0]?.value;
      expect(client.from).toHaveBeenCalledWith("tool_usage_log");
    });

    it("does not throw when the supabase insert fails", async () => {
      vi.mocked(deductAllowance).mockResolvedValue(1);
      // Make the insert chain reject by overriding the table result to throw.
      vi.mocked(getSupabaseAdminClient).mockImplementation(() => {
        throw new Error("supabase exploded");
      });

      await expect(chargeAndLogToolAllowance(args)).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith(
        "Failed to log tool usage:",
        expect.any(Error),
      );
    });
  });
});
