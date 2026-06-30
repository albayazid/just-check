import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./file-storage-service", () => ({
  getFileUploadForConversation: vi.fn(),
  resolveFromStoragePath: vi.fn(),
}));

import { getFileUploadForConversation, resolveFromStoragePath } from "./file-storage-service";
import { preprocessMessagesAttachmentsForModel } from "./message-attachment-preprocessor";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const ATTACHMENT_URL = `attachment://${UUID}`;

function userMessage(parts: unknown[]) {
  return { id: "m1", role: "user", parts, metadata: {} } as never;
}
function assistantMessage(parts: unknown[]) {
  return { id: "m2", role: "assistant", parts, metadata: {} } as never;
}
function textPart(text = "hi") {
  return { type: "text", text };
}
function filePart(mediaType = "image/png", url = ATTACHMENT_URL, filename?: string) {
  return { type: "file", mediaType, url, filename };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("preprocessMessagesAttachmentsForModel — passthrough", () => {
  it("passes non-user messages through unchanged", async () => {
    const msg = assistantMessage([textPart()]);
    const [result] = await preprocessMessagesAttachmentsForModel([msg] as never, "user-1", "conv-1");
    expect(result).toEqual(msg);
    expect(getFileUploadForConversation).not.toHaveBeenCalled();
  });

  it("passes non-file parts through unchanged", async () => {
    const msg = userMessage([textPart("hello"), { type: "reasoning", text: "thinking" }]);
    const [result] = await preprocessMessagesAttachmentsForModel([msg] as never, "user-1", "conv-1");
    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]).toEqual(textPart("hello"));
  });
});

describe("preprocessMessagesAttachmentsForModel — file dispatch", () => {
  it("resolves a signed URL for an image attachment", async () => {
    vi.mocked(getFileUploadForConversation).mockResolvedValue({
      id: UUID, storage_path: "private/path", mime_type: "image/png", original_filename: "photo.png",
    } as never);
    vi.mocked(resolveFromStoragePath).mockResolvedValue("https://signed");

    const [result] = await preprocessMessagesAttachmentsForModel(
      [userMessage([filePart("image/png")])] as never, "user-1", "conv-1",
    );

    expect(resolveFromStoragePath).toHaveBeenCalledWith(UUID, "private/path");
    expect(result.parts[0]).toMatchObject({ type: "file", url: "https://signed" });
  });

  it("formats extracted content for a text attachment", async () => {
    vi.mocked(getFileUploadForConversation).mockResolvedValue({
      id: UUID, storage_path: "private/path", mime_type: "text/plain", original_filename: "notes.txt",
      extracted_data: { status: "extracted", strategy: "text", text: "file content here" },
    } as never);

    const [result] = await preprocessMessagesAttachmentsForModel(
      [userMessage([filePart("text/plain")])] as never, "user-1", "conv-1",
    );

    // The file part is replaced with a text part containing the formatted extraction.
    expect(result.parts[0].type).toBe("text");
    expect((result.parts[0] as { text: string }).text).toContain("file content here");
    expect((result.parts[0] as { text: string }).text).toContain("<attached_file>");
    expect(resolveFromStoragePath).not.toHaveBeenCalled();
  });

  it("keeps non-attachment image parts as-is (inline images)", async () => {
    const [result] = await preprocessMessagesAttachmentsForModel(
      [userMessage([filePart("image/png", "data:image/png;base64,abc")])] as never, "user-1", "conv-1",
    );
    expect(result.parts[0]).toMatchObject({ type: "file", url: "data:image/png;base64,abc" });
    expect(getFileUploadForConversation).not.toHaveBeenCalled();
  });

  it("synthesizes an unavailable block for non-attachment non-image files", async () => {
    const [result] = await preprocessMessagesAttachmentsForModel(
      [userMessage([filePart("application/pdf", "https://external.com/doc.pdf", "doc.pdf")])] as never, "user-1", "conv-1",
    );
    expect(result.parts[0].type).toBe("text");
    expect((result.parts[0] as { text: string }).text).toContain("status: unavailable");
    expect((result.parts[0] as { text: string }).text).toContain("not available as a persisted attachment");
  });
});

describe("preprocessMessagesAttachmentsForModel — failure isolation", () => {
  it("silently drops a part whose preprocessing throws (does not crash the message)", async () => {
    vi.mocked(getFileUploadForConversation).mockRejectedValue(new Error("file lookup failed"));

    const [result] = await preprocessMessagesAttachmentsForModel(
      [userMessage([textPart("keep me"), filePart("image/png")])] as never, "user-1", "conv-1",
    );

    // The text part survives; the failed file part is dropped.
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toEqual(textPart("keep me"));
    expect(console.warn).toHaveBeenCalled();
  });
});
