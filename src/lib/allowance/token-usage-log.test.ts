import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase-client.server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { createMockSupabaseClient, getInsertedRow } from "@/test/mocks/supabase";
import { logMessageTokenUsage } from "./token-usage-log";
import type { TokenUsageLogParams } from "./token-usage-log";

const baseParams: TokenUsageLogParams = {
  messageId: "msg_42",
  tokenUsage: {
    totalUsedTokens: 600,
    totalInputTokens: 500,
    totalOutputTokens: 100,
  } as TokenUsageLogParams["tokenUsage"],
  modelInfo: {
    provider: "openrouter",
    UIModelId: "fast",
    internalModelId: "deepseek/deepseek-v3.2",
  },
  totalCost: 2.5,
  pricingUsed: { input: 0.4, output: 0.7 },
};

function captureInsertRow() {
  const client = createMockSupabaseClient({
    tables: { message_token_usage_log: { data: null, error: null } },
  });
  vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);
  return client;
}

describe("logMessageTokenUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("inserts a row with the expected shape into message_token_usage_log", async () => {
    const client = captureInsertRow();

    await logMessageTokenUsage(baseParams);

    expect(client.from).toHaveBeenCalledWith("message_token_usage_log");
    const inserted = getInsertedRow(client, "message_token_usage_log") as Record<string, unknown> & { estimated_cost_detail: Record<string, unknown> };
    expect(inserted).toMatchObject({
      message_id: "msg_42",
      estimated_total_cost: 2.5,
      token_usage: {
        totalTokens: 600,
        inputTokens: 500,
        outputTokens: 100,
      },
      model_info: {
        provider: "openrouter",
        UIModelId: "fast",
        internalModelId: "deepseek/deepseek-v3.2",
      },
    });
  });

  it("computes cost-detail input/output cost using /10000 (per-10k-token pricing)", async () => {
    // NOTE: this divides by 10000, not 1_000_000. This differs from
    // allowance/pricing.ts which uses USD-per-1M-token pricing. The two
    // `pricingUsed` values here are therefore interpreted as USD-per-10k-tokens.
    // Pinning the current behaviour; flag as a footgun for future review.
    const client = captureInsertRow();

    await logMessageTokenUsage(baseParams);

    const inserted = getInsertedRow(client, "message_token_usage_log") as Record<string, unknown> & { estimated_cost_detail: Record<string, unknown> };
    // inputCost = 500 * 0.4 / 10000 = 0.02
    expect(inserted.estimated_cost_detail.inputCost).toBeCloseTo(0.02, 10);
    // outputCost = 100 * 0.7 / 10000 = 0.007
    expect(inserted.estimated_cost_detail.outputCost).toBeCloseTo(0.007, 10);
    expect(inserted.estimated_cost_detail.totalCost).toBe(2.5);
    expect(inserted.estimated_cost_detail.pricingPerMillion).toEqual({
      input: 0.4,
      output: 0.7,
    });
  });

  it("logs an error but does not throw when the insert returns an error", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      createMockSupabaseClient({
        tables: {
          message_token_usage_log: {
            data: null,
            error: { code: "XX", message: "constraint violation" },
          },
        },
      }) as never,
    );

    await expect(logMessageTokenUsage(baseParams)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to insert token usage log:",
      expect.objectContaining({ message: "constraint violation" }),
    );
  });

  it("never throws even when getSupabaseAdminClient throws", async () => {
    vi.mocked(getSupabaseAdminClient).mockImplementation(() => {
      throw new Error("unexpected");
    });

    await expect(logMessageTokenUsage(baseParams)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "Unexpected error logging token usage:",
      expect.any(Error),
    );
  });
});
