import { describe, it, expect, beforeEach, vi } from "vitest";

// Control the structural-validation pass + the supported-types list. The
// attachment:// URL check (isAttachmentUrl) runs real — it's pure and already
// unit-tested in storage/attachment-url-utils.test.ts.
vi.mock("ai", () => ({
  safeValidateUIMessages: vi.fn(),
}));
vi.mock("@/lib/storage/file-validation", () => ({
  SUPPORTED_FILE_TYPES: ["image/jpeg", "image/png", "image/webp", "text/plain", "application/pdf"],
}));

import { safeValidateUIMessages } from "ai";
import { validateChatMessages } from "./validate-chat-messages";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_ATTACHMENT_URL = `attachment://${UUID}`;

/** Builds a validated UIMessage the way the (mocked) structural pass would return. */
function validatedMessages(msgs: Array<{ role: "user" | "assistant"; parts: unknown[] }>) {
  return msgs.map((m, i) => ({ id: `m${i}`, role: m.role, parts: m.parts }));
}

function mockStructuralSuccess(msgs: Array<{ role: "user" | "assistant"; parts: unknown[] }>) {
  vi.mocked(safeValidateUIMessages).mockResolvedValue({
    success: true,
    data: validatedMessages(msgs) as never,
  });
}

function filePart(url: string, mediaType = "image/jpeg") {
  return { type: "file", url, mediaType };
}
function textPart(text = "hi") {
  return { type: "text", text };
}

describe("validateChatMessages — structural pass (pass 1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a structural-failure result when safeValidateUIMessages fails", async () => {
    vi.mocked(safeValidateUIMessages).mockResolvedValue({
      success: false,
      error: { message: "bad shape" },
    } as never);

    const result = await validateChatMessages([]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invalid message structure");
      expect(result.details).toEqual(["bad shape"]);
    }
  });

  it("passes through to pass 2 when structural validation succeeds", async () => {
    mockStructuralSuccess([{ role: "user", parts: [textPart()] }]);

    const result = await validateChatMessages([{ id: "m0", role: "user", parts: [textPart()] }]);

    expect(result.success).toBe(true);
  });
});

describe("validateChatMessages — application constraints (pass 2)", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("file URL format", () => {
    it("accepts a file part with a valid attachment://{uuid} URL", async () => {
      mockStructuralSuccess([
        { role: "user", parts: [filePart(VALID_ATTACHMENT_URL, "image/jpeg")] },
      ]);

      const result = await validateChatMessages([]);

      expect(result.success).toBe(true);
    });

    it("rejects a file part whose URL is not an attachment:// URL", async () => {
      mockStructuralSuccess([
        { role: "user", parts: [filePart("https://example.com/x.png", "image/jpeg")] },
      ]);

      const result = await validateChatMessages([]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.details?.some((d) => d.includes("attachment://{uuid}"))).toBe(true);
      }
    });

    it("rejects a file part whose attachment URL has a non-UUID id", async () => {
      mockStructuralSuccess([
        { role: "user", parts: [filePart("attachment://not-a-uuid", "image/jpeg")] },
      ]);

      const result = await validateChatMessages([]);
      expect(result.success).toBe(false);
    });
  });

  describe("mediaType membership", () => {
    it("rejects a file part with an unsupported mediaType even when the URL is valid", async () => {
      mockStructuralSuccess([
        { role: "user", parts: [filePart(VALID_ATTACHMENT_URL, "application/x-bogus")] },
      ]);

      const result = await validateChatMessages([]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.details?.some((d) => d.includes("Unsupported media type"))).toBe(true);
      }
    });

    it("accepts each supported media type", async () => {
      for (const mt of ["image/jpeg", "image/png", "image/webp", "text/plain", "application/pdf"]) {
        mockStructuralSuccess([{ role: "user", parts: [filePart(VALID_ATTACHMENT_URL, mt)] }]);
        const result = await validateChatMessages([]);
        expect(result.success, `mediaType ${mt}`).toBe(true);
      }
    });
  });

  describe("file count cap (MAX_FILES_PER_MESSAGE = 5, last user message only)", () => {
    it("rejects when the last user message has more than 5 files", async () => {
      const files = Array.from({ length: 6 }, () => filePart(VALID_ATTACHMENT_URL));
      mockStructuralSuccess([{ role: "user", parts: files }]);

      const result = await validateChatMessages([]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.details?.some((d) => d.includes("6 files, maximum is 5"))).toBe(true);
      }
    });

    it("accepts exactly 5 files in the last user message", async () => {
      const files = Array.from({ length: 5 }, () => filePart(VALID_ATTACHMENT_URL));
      mockStructuralSuccess([{ role: "user", parts: files }]);

      const result = await validateChatMessages([]);
      expect(result.success).toBe(true);
    });

    it("only enforces the cap on the LAST user message (earlier over-cap messages are not counted)", async () => {
      // First user message has 6 files (over cap), but the LAST user message has 1.
      // The cap check targets only the last user message, so this should pass the
      // count rule. (URL/mediaType still apply to every user message.)
      const sixFiles = Array.from({ length: 6 }, () => filePart(VALID_ATTACHMENT_URL));
      mockStructuralSuccess([
        { role: "user", parts: sixFiles },
        { role: "assistant", parts: [textPart()] },
        { role: "user", parts: [filePart(VALID_ATTACHMENT_URL)] },
      ]);

      const result = await validateChatMessages([]);
      // No "Too many files" error — all 7 files have valid URLs/mediaTypes.
      expect(result.success).toBe(true);
    });

    it("skips the count check entirely when there is no user message", async () => {
      mockStructuralSuccess([{ role: "assistant", parts: [textPart()] }]);

      const result = await validateChatMessages([]);
      expect(result.success).toBe(true);
    });
  });

  it("aggregates multiple errors into details (URL + mediaType)", async () => {
    mockStructuralSuccess([
      { role: "user", parts: [{ type: "file", url: "https://x/y", mediaType: "application/x-bogus" }] },
    ]);

    const result = await validateChatMessages([]);

    expect(result.success).toBe(false);
    if (!result.success) {
      // Both the URL-format error and the mediaType error are reported.
      expect(result.details?.length).toBeGreaterThanOrEqual(2);
    }
  });
});
