import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — boundary modules only. Route logic + extracted helpers run real.
// ---------------------------------------------------------------------------
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({ chatRatelimit: { limit: vi.fn() } }));
vi.mock("@/lib/supabase-client.server", () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock("ai", () => ({
  streamText: vi.fn(),
  convertToModelMessages: vi.fn(() => []),
  consumeStream: vi.fn(),
}));
vi.mock("@/lib/models", () => ({
  resolveModelRoute: vi.fn(() => ({
    provider: "openrouter",
    id: "deepseek/deepseek-v3.2",
    providerOptions: { openrouter: { reasoning: { enabled: false } } },
  })),
  getLanguageModel: vi.fn(() => ({})),
}));
vi.mock("@/lib/allowance", () => ({
  getRemainingAllowance: vi.fn(),
  deductAllowance: vi.fn(),
  getModelPricing: vi.fn(() => null),
  calculateCost: vi.fn(() => 0),
  logMessageTokenUsage: vi.fn(),
}));
vi.mock("@/lib/conversation-history", () => ({
  saveUserMessage: vi.fn(),
  saveAssistantMessage: vi.fn(),
  getLastMessageFromDB: vi.fn(),
  updateMessage: vi.fn(),
}));
vi.mock("@/lib/validation/validate-chat-messages", () => ({
  validateChatMessages: vi.fn(),
}));
vi.mock("@/lib/storage/message-attachment-preprocessor", () => ({
  preprocessMessagesAttachmentsForModel: vi.fn(),
}));
vi.mock("@/lib/storage/file-storage-service", () => ({
  validateFileAccess: vi.fn(),
}));
vi.mock("@/lib/memory", () => ({ getUserMemories: vi.fn() }));
vi.mock("@/lib/tools", () => ({
  getTimeTool: { description: "time", parameters: {}, execute: vi.fn() },
  getWeatherTool: { description: "weather", parameters: {}, execute: vi.fn() },
  webSearchTool: { description: "search", parameters: {}, execute: vi.fn() },
  viewWebsiteTool: { description: "view", parameters: {}, execute: vi.fn() },
  manageMemoryTool: { description: "memory", parameters: {}, execute: vi.fn() },
}));
vi.mock("@/lib/tools/executor/web-search-executor", () => ({ executeWebSearch: vi.fn() }));
vi.mock("@/lib/tools/executor/view-website-executor", () => ({ executeViewWebsite: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { auth } from "@clerk/nextjs/server";
import { chatRatelimit } from "@/lib/ratelimit";
import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { streamText, convertToModelMessages } from "ai";
import { getRemainingAllowance, getModelPricing } from "@/lib/allowance";
import { saveUserMessage, saveAssistantMessage, getLastMessageFromDB } from "@/lib/conversation-history";
import { validateChatMessages } from "@/lib/validation/validate-chat-messages";
import { resolveModelRoute } from "@/lib/models";
import { createMockSupabaseClient, pgError } from "@/test/mocks/supabase";
import { setAuthenticated, setUnauthenticated } from "@/test/mocks/clerk";
import { POST } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const UUID = "550e8400-e29b-41d4-a716-446655440000";

function chatRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request("https://app.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ id: "msg-1", role: "user", parts: [{ type: "text", text: "hello" }] }],
      id: UUID,
      UIModelId: "fast",
      ...overrides,
    }),
  });
}

/** Re-arm the streamText mock after restoreMocks wipes it. Returns a spy that
 *  tracks whether the toUIMessageStreamResponse onFinish callback fired. */
function wireStreamText(opts: { fireOnFinish?: boolean } = {}): { onFinishFired: () => boolean } {
  let onFinishFired = false;
  vi.mocked(streamText).mockReturnValue({
    toUIMessageStreamResponse: (uiOpts: { onFinish?: (args: unknown) => void }) => {
      if (opts.fireOnFinish !== false && uiOpts.onFinish) {
        onFinishFired = true;
        uiOpts.onFinish({
          messages: [
            { id: "msg-1", role: "user", parts: [{ type: "text", text: "hello" }] },
            { id: "asst-1", role: "assistant", parts: [{ type: "text", text: "response" }], metadata: {} },
          ],
          isContinuation: false,
          finishReason: "stop",
          isAborted: false,
        });
      }
      return new Response(null, { status: 200 });
    },
  } as never);
  vi.mocked(convertToModelMessages).mockReturnValue([] as never);
  return { onFinishFired: () => onFinishFired };
}

/** Supabase config for the happy path: conversation exists, no settings row. */
function installHappySupabase() {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({
      tables: {
        conversations: { data: { id: UUID, is_temporary: false }, error: null },
        user_settings: { data: null, error: pgError("PGRST116") },
        messages: { data: null, error: null },
      },
    } as never) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});

  // Defaults: authenticated, rate-limit passes, valid messages, allowance > 0.
  setAuthenticated(auth as never, "user_1");
  vi.mocked(chatRatelimit.limit).mockResolvedValue({ success: true } as never);
  vi.mocked(validateChatMessages).mockResolvedValue({
    success: true,
    messages: [{ id: "msg-1", role: "user", parts: [{ type: "text", text: "hello" }] }] as never,
  } as never);
  vi.mocked(getRemainingAllowance).mockResolvedValue(100);
  vi.mocked(getLastMessageFromDB).mockResolvedValue(null);
  vi.mocked(saveUserMessage).mockResolvedValue({ id: "msg-1" } as never);
  vi.mocked(saveAssistantMessage).mockResolvedValue({ id: "asst-1" } as never);
  vi.mocked(getModelPricing).mockReturnValue(null);

  wireStreamText();
});

// ---------------------------------------------------------------------------
// Short-circuit tests
// ---------------------------------------------------------------------------
describe("POST /api/chat — short-circuits", () => {
  it("returns 401 when unauthenticated", async () => {
    setUnauthenticated(auth as never);
    const res = await POST(chatRequest());
    expect(res.status).toBe(401);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    vi.mocked(chatRatelimit.limit).mockResolvedValue({ success: false } as never);
    const res = await POST(chatRequest());
    expect(res.status).toBe(429);
  });

  it("returns 400 when the body fails zod validation (missing required fields)", async () => {
    const res = await POST(chatRequest({ UIModelId: undefined }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request body");
  });

  it("returns 400 when the conversation id is not a valid UUID", async () => {
    const res = await POST(chatRequest({ id: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when message validation fails", async () => {
    vi.mocked(validateChatMessages).mockResolvedValue({
      success: false,
      error: "Message validation failed",
      details: ["bad attachment"],
    } as never);
    const res = await POST(chatRequest());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Message validation failed");
  });

  it("returns 404 when the conversation is not found or not owned", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      createMockSupabaseClient({
        tables: { conversations: { data: null, error: pgError("PGRST116") } },
      } as never) as never,
    );
    const res = await POST(chatRequest());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("not found");
  });

  it("returns 402 when the user has insufficient allowance (new user turn)", async () => {
    installHappySupabase();
    vi.mocked(getRemainingAllowance).mockResolvedValue(0);
    const res = await POST(chatRequest());
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("Insufficient allowance");
  });
});

// ---------------------------------------------------------------------------
// Shallow happy path
// ---------------------------------------------------------------------------
describe("POST /api/chat — happy path", () => {
  beforeEach(() => {
    installHappySupabase();
  });

  it("returns 200 and calls streamText", async () => {
    const res = await POST(chatRequest());
    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("passes detectRoutingContext result to resolveModelRoute", async () => {
    // Text-only messages → hasImages=false. resolveModelRoute is mocked but we
    // can assert it was called with { hasImages: false }.
    await POST(chatRequest());
    expect(resolveModelRoute).toHaveBeenCalledWith("fast", { hasImages: false });
  });

  it("routes images to the vision-capable model variant", async () => {
    vi.mocked(validateChatMessages).mockResolvedValue({
      success: true,
      messages: [{
        id: "msg-1", role: "user",
        parts: [{ type: "file", mediaType: "image/png", url: "attachment://550e8400-e29b-41d4-a716-446655440000" }],
      }] as never,
    } as never);

    await POST(chatRequest());

    const callArgs = vi.mocked(resolveModelRoute).mock.calls[0];
    expect(callArgs?.[1]).toMatchObject({ hasImages: true });
  });

  it("saves the user message before streaming (new user turn)", async () => {
    await POST(chatRequest());
    expect(saveUserMessage).toHaveBeenCalledTimes(1);
  });

  it("fires the toUIMessageStreamResponse onFinish callback", async () => {
    const { onFinishFired } = wireStreamText({ fireOnFinish: true });
    await POST(chatRequest());
    expect(onFinishFired()).toBe(true);
  });

  it("does not check allowance for continuation turns (assistant last message)", async () => {
    vi.mocked(validateChatMessages).mockResolvedValue({
      success: true,
      messages: [{ id: "msg-1", role: "assistant", parts: [{ type: "text", text: "prev" }] }] as never,
    } as never);

    await POST(chatRequest());

    // Allowance check is skipped for non-user turns.
    expect(getRemainingAllowance).not.toHaveBeenCalled();
  });
});
