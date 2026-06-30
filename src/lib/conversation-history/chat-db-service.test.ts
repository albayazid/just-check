import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase-client.server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { createMockSupabaseClient, pgError, getInsertedRow } from "@/test/mocks/supabase";
import {
  roleToSenderRole,
  saveMessage,
  saveUserMessage,
  saveAssistantMessage,
  updateMessage,
  getLastMessageFromDB,
  getMessagesForConversation,
} from "./chat-db-service";
import { buildStoredMessage, buildUIMessage } from "@/test/factories";

function installSupabase(tables: Record<string, unknown> = {}, rpc: Record<string, unknown> = {}) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({ tables, rpc } as never) as never,
  );
}

describe("roleToSenderRole (pure)", () => {
  it("maps 'user' to 'user'", () => {
    expect(roleToSenderRole("user")).toBe("user");
  });

  it("maps 'assistant' to 'assistant'", () => {
    expect(roleToSenderRole("assistant")).toBe("assistant");
  });

  it("throws for 'system'", () => {
    expect(() => roleToSenderRole("system" as never)).toThrowError(/System messages cannot be stored/);
  });
});

describe("saveMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts the row and returns the saved message", async () => {
    const saved = buildStoredMessage({ id: "msg-2", sender_type: "user" });
    installSupabase({ messages: { data: saved, error: null } });

    const result = await saveMessage({
      id: "msg-2",
      conversation_id: "conv-1",
      previous_message_id: null,
      sender_type: "user",
      content: [{ type: "text", text: "hi" }] as never,
    });

    expect(result).toEqual(saved);
    const inserted = getInsertedRow(
      vi.mocked(getSupabaseAdminClient).mock.results[0]?.value as never,
      "messages",
    );
    expect(inserted).toMatchObject({ id: "msg-2", sender_type: "user", conversation_id: "conv-1" });
  });

  it("throws when the insert errors", async () => {
    installSupabase({ messages: { data: null, error: pgError("XX000", "write failed") } });

    await expect(
      saveMessage({
        id: "x",
        conversation_id: "c",
        previous_message_id: null,
        sender_type: "user",
        content: [] as never,
      }),
    ).rejects.toThrowError(/Failed to save message: write failed/);
  });
});

describe("saveUserMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves a user message via saveMessage with sender_type 'user'", async () => {
    const saved = buildStoredMessage({ sender_type: "user" });
    installSupabase({ messages: { data: saved, error: null } });

    await saveUserMessage({
      conversationId: "conv-1",
      userMessage: buildUIMessage({ role: "user" }) as never,
      previousMessageId: null,
    });

    const inserted = getInsertedRow(
      vi.mocked(getSupabaseAdminClient).mock.results[0]?.value as never,
      "messages",
    );
    expect(inserted.sender_type).toBe("user");
    expect(inserted.previous_message_id).toBeNull();
  });

  it("passes through a non-null previousMessageId", async () => {
    installSupabase({ messages: { data: buildStoredMessage(), error: null } });

    await saveUserMessage({
      conversationId: "conv-1",
      userMessage: buildUIMessage() as never,
      previousMessageId: "prev-msg",
    });

    const inserted = getInsertedRow(
      vi.mocked(getSupabaseAdminClient).mock.results[0]?.value as never,
      "messages",
    );
    expect(inserted.previous_message_id).toBe("prev-msg");
  });
});

describe("saveAssistantMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves with sender_type 'assistant' and prefers explicit metadata over the message's", async () => {
    installSupabase({ messages: { data: buildStoredMessage({ sender_type: "assistant" }), error: null } });

    const explicitMetadata = { custom: "value" } as never;
    await saveAssistantMessage({
      conversationId: "conv-1",
      assistantMessage: buildUIMessage({ role: "assistant", metadata: { old: 1 } }) as never,
      metadata: explicitMetadata,
      previousMessageId: "user-msg-1",
    });

    const inserted = getInsertedRow(
      vi.mocked(getSupabaseAdminClient).mock.results[0]?.value as never,
      "messages",
    );
    expect(inserted.sender_type).toBe("assistant");
    expect(inserted.metadata).toEqual(explicitMetadata);
  });
});

describe("updateMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates by id and returns the updated row", async () => {
    const updated = buildStoredMessage({ metadata: { patched: true } as never });
    installSupabase({ messages: { data: updated, error: null } });

    const result = await updateMessage("msg-1", { metadata: { patched: true } as never });
    expect(result).toEqual(updated);
  });

  it("throws when the update errors", async () => {
    installSupabase({ messages: { data: null, error: pgError("XX", "nope") } });
    await expect(updateMessage("msg-1", {} as never)).rejects.toThrowError(/Failed to update message/);
  });
});

describe("getLastMessageFromDB", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the most recent message", async () => {
    const last = buildStoredMessage({ id: "last" });
    installSupabase({ messages: { data: last, error: null } });

    expect(await getLastMessageFromDB("conv-1")).toEqual(last);
  });

  it("returns null when no rows exist (PGRST116)", async () => {
    installSupabase({ messages: { data: null, error: pgError("PGRST116") } });
    expect(await getLastMessageFromDB("empty-conv")).toBeNull();
  });

  it("rethrows non-PGRST116 errors", async () => {
    installSupabase({ messages: { data: null, error: pgError("XX000", "boom") } });
    await expect(getLastMessageFromDB("conv-1")).rejects.toThrowError(/boom/);
  });
});

describe("getMessagesForConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the messages array", async () => {
    const msgs = [buildStoredMessage({ id: "a" }), buildStoredMessage({ id: "b" })];
    installSupabase({ messages: { data: msgs, error: null } });

    expect(await getMessagesForConversation("conv-1")).toEqual(msgs);
  });

  it("rethrows on error", async () => {
    installSupabase({ messages: { data: null, error: pgError("XX", "fail") } });
    await expect(getMessagesForConversation("conv-1")).rejects.toThrowError(/Failed to retrieve messages/);
  });
});
