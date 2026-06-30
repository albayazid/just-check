import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase-client.server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { createMockSupabaseClient, pgError } from "@/test/mocks/supabase";
import { buildStoredConversation } from "@/test/factories";
import {
  listConversations,
  pinConversation,
  unpinConversation,
  archiveConversation,
  archiveAllConversations,
  deleteAllConversations,
  getPinnedCount,
  forkConversation,
} from "./conversations";
import { PIN_LIMIT } from "./types";

function installSupabase(tables: Record<string, unknown> = {}, rpc: Record<string, unknown> = {}) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({ tables, rpc } as never) as never,
  );
}

describe("listConversations — pagination", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the page, hasMore=false and a null nextCursor when results fit within the limit", async () => {
    const page = [buildStoredConversation({ id: "c1" })];
    installSupabase({ conversations: { data: page, error: null, count: 1 } });

    const result = await listConversations({ clerkUserId: "user-1", limit: 10 });

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.conversations).toEqual(page);
    expect(result.totalCount).toBe(1);
  });

  it("sets hasMore=true and builds a nextCursor from the last item when the over-fetch returns limit+1", async () => {
    // limit=2, DB returns 3 (the +1 over-fetch signals more exist).
    const overFetched = [
      buildStoredConversation({ id: "c1", updated_at: "2026-01-03T00:00:00Z" }),
      buildStoredConversation({ id: "c2", updated_at: "2026-01-02T00:00:00Z" }),
      buildStoredConversation({ id: "c3", updated_at: "2026-01-01T00:00:00Z" }),
    ];
    installSupabase({ conversations: { data: overFetched, error: null, count: 3 } });

    const result = await listConversations({ clerkUserId: "user-1", limit: 2 });

    expect(result.hasMore).toBe(true);
    expect(result.conversations).toHaveLength(2); // sliced to the limit
    // nextCursor built from the LAST item of the SLICED page (c2).
    expect(result.nextCursor).toBe(
      JSON.stringify({ updated_at: "2026-01-02T00:00:00Z", id: "c2" }),
    );
  });

  it("throws 'Invalid cursor format' when the cursor is not valid JSON", async () => {
    installSupabase({ conversations: { data: [], error: null } });

    await expect(
      listConversations({ clerkUserId: "user-1", cursor: "{not-json" }),
    ).rejects.toThrowError(/Invalid cursor format/);
  });

  it("rethrows DB errors with context", async () => {
    installSupabase({ conversations: { data: null, error: pgError("XX", "boom") } });

    await expect(listConversations({ clerkUserId: "user-1" })).rejects.toThrowError(
      /Failed to fetch conversations: boom/,
    );
  });

  it("defaults totalCount to 0 when count is absent", async () => {
    installSupabase({ conversations: { data: [], error: null } });
    const result = await listConversations({ clerkUserId: "user-1" });
    expect(result.totalCount).toBe(0);
  });
});

describe("pinConversation — pin limit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when the user already has PIN_LIMIT pinned conversations", async () => {
    // First query (count check) returns count at the limit.
    installSupabase({
      conversations: { data: null, error: null, count: PIN_LIMIT },
    });

    await expect(pinConversation("c1", "user-1")).rejects.toThrowError(
      new RegExp(`Pin limit reached \\(max ${PIN_LIMIT}\\)`),
    );
  });

  it("performs the pin update when under the limit", async () => {
    installSupabase({
      conversations: [
        { data: null, error: null, count: 1 }, // count check (under limit)
        { data: null, error: null }, // update
      ],
    });

    await expect(pinConversation("c1", "user-1")).resolves.toBeUndefined();
  });

  it("rethrows a count-check error", async () => {
    installSupabase({
      conversations: { data: null, error: pgError("XX", "count failed") },
    });

    await expect(pinConversation("c1", "user-1")).rejects.toThrowError(/count failed/);
  });
});

describe("unpinConversation / archiveConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unpin resolves when the update succeeds", async () => {
    installSupabase({ conversations: { data: null, error: null } });
    await expect(unpinConversation("c1", "user-1")).resolves.toBeUndefined();
  });

  it("unpin throws on error", async () => {
    installSupabase({ conversations: { data: null, error: pgError("XX", "nope") } });
    await expect(unpinConversation("c1", "user-1")).rejects.toThrowError(/Failed to unpin/);
  });

  it("archive resolves when the update succeeds", async () => {
    installSupabase({ conversations: { data: null, error: null } });
    await expect(archiveConversation("c1", "user-1")).resolves.toBeUndefined();
  });
});

describe("archiveAllConversations / deleteAllConversations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the affected count from the bulk archive", async () => {
    installSupabase({ conversations: { data: null, error: null, count: 7 } });
    await expect(archiveAllConversations("user-1")).resolves.toEqual({ count: 7 });
  });

  it("returns the affected count from the bulk delete", async () => {
    installSupabase({ conversations: { data: null, error: null, count: 3 } });
    await expect(deleteAllConversations("user-1")).resolves.toEqual({ count: 3 });
  });

  it("defaults to count 0 when none returned", async () => {
    installSupabase({ conversations: { data: null, error: null } });
    await expect(archiveAllConversations("user-1")).resolves.toEqual({ count: 0 });
  });
});

describe("getPinnedCount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports canPin=true when under the limit", async () => {
    installSupabase({ conversations: { data: null, error: null, count: 2 } });
    const result = await getPinnedCount("user-1");
    expect(result).toEqual({ count: 2, limit: PIN_LIMIT, canPin: true });
  });

  it("reports canPin=false when at the limit", async () => {
    installSupabase({ conversations: { data: null, error: null, count: PIN_LIMIT } });
    const result = await getPinnedCount("user-1");
    expect(result.canPin).toBe(false);
  });
});

describe("forkConversation — error mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the new conversation id on success", async () => {
    installSupabase({}, { fork_conversation: { data: "new-conv-id", error: null } });
    await expect(forkConversation("src-1", "user-1")).resolves.toEqual({ conversationId: "new-conv-id" });
  });

  it("maps a 'not found' RPC error to 'Conversation not found'", async () => {
    installSupabase(
      {},
      { fork_conversation: { data: null, error: pgError("P0001", "Conversation not found") } },
    );
    await expect(forkConversation("src-1", "user-1")).rejects.toThrowError(/Conversation not found/);
  });

  it("maps a 'No messages' RPC error to 'No messages to fork'", async () => {
    installSupabase(
      {},
      { fork_conversation: { data: null, error: pgError("P0001", "No messages to fork") } },
    );
    await expect(forkConversation("src-1", "user-1")).rejects.toThrowError(/No messages to fork/);
  });

  it("rethrows other RPC errors with context", async () => {
    installSupabase(
      {},
      { fork_conversation: { data: null, error: pgError("XX", "unexpected") } },
    );
    await expect(forkConversation("src-1", "user-1")).rejects.toThrowError(/Failed to fork conversation: unexpected/);
  });
});
