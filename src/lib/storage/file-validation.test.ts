import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("file-type", () => ({ fileTypeFromBlob: vi.fn() }));

import { fileTypeFromBlob } from "file-type";
import {
  validateFileSize,
  validateFileCount,
  validateMimeType,
  validateFileContent,
  validateFile,
  validateFiles,
  FileValidationErrorType,
  SUPPORTED_FILE_TYPES,
} from "./file-validation";

function file(name: string, type: string, content: string | Blob = "hello"): File {
  return new File([content], name, { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("validateFileSize", () => {
  it("returns null when the file is within the limit", () => {
    expect(validateFileSize(file("a.txt", "text/plain"), 10 * 1024 * 1024)).toBeNull();
  });

  it("returns FILE_TOO_LARGE when the file exceeds the limit", () => {
    const big = file("big.bin", "application/octet-stream", "x".repeat(11));
    const err = validateFileSize(big, 10);
    expect(err?.type).toBe(FileValidationErrorType.FILE_TOO_LARGE);
    expect(err?.fileName).toBe("big.bin");
  });

  it("accepts the file when exactly at the limit", () => {
    const exact = file("exact.txt", "text/plain", "x".repeat(10));
    expect(validateFileSize(exact, 10)).toBeNull();
  });
});

describe("validateFileCount", () => {
  it("returns null when at or under the limit", () => {
    expect(validateFileCount(5, 5)).toBeNull();
    expect(validateFileCount(3, 5)).toBeNull();
  });

  it("returns TOO_MANY_FILES when over the limit", () => {
    const err = validateFileCount(6, 5);
    expect(err?.type).toBe(FileValidationErrorType.TOO_MANY_FILES);
    expect(err?.details).toContain("6 files");
  });
});

describe("validateMimeType", () => {
  it("returns null for an allowed type", () => {
    expect(validateMimeType(file("a.png", "image/png"), SUPPORTED_FILE_TYPES)).toBeNull();
  });

  it("returns UNSUPPORTED_MIME_TYPE for a disallowed type", () => {
    const err = validateMimeType(file("a.exe", "application/x-msdownload"), SUPPORTED_FILE_TYPES);
    expect(err?.type).toBe(FileValidationErrorType.UNSUPPORTED_MIME_TYPE);
  });
});

// ---------------------------------------------------------------------------
// validateFileContent (magic-number security check — mocked file-type)
// ---------------------------------------------------------------------------

describe("validateFileContent", () => {
  it("returns null for a valid text file (UTF-8 check, skips file-type)", async () => {
    const result = await validateFileContent(file("a.txt", "text/plain", "hello world"), SUPPORTED_FILE_TYPES);
    expect(result).toBeNull();
    expect(fileTypeFromBlob).not.toHaveBeenCalled();
  });

  it("returns INVALID_FILE_CONTENT for invalid UTF-8 in a text file", async () => {
    // 0xFF 0xFE is not valid UTF-8 on its own.
    const bad = new File([new Uint8Array([0xff, 0xfe, 0x00])], "bad.txt", { type: "text/plain" });
    const err = await validateFileContent(bad, SUPPORTED_FILE_TYPES);
    expect(err?.type).toBe(FileValidationErrorType.INVALID_FILE_CONTENT);
    expect(err?.message).toMatch(/not valid UTF-8/);
  });

  it("returns null when file-type detects an allowed type", async () => {
    vi.mocked(fileTypeFromBlob).mockResolvedValue({ mime: "image/png", ext: "png" } as never);
    const result = await validateFileContent(file("a.png", "image/png"), SUPPORTED_FILE_TYPES);
    expect(result).toBeNull();
  });

  it("returns INVALID_FILE_CONTENT when file-type cannot identify the file", async () => {
    vi.mocked(fileTypeFromBlob).mockResolvedValue(null as never);
    const err = await validateFileContent(file("mystery", "application/octet-stream"), SUPPORTED_FILE_TYPES);
    expect(err?.type).toBe(FileValidationErrorType.INVALID_FILE_CONTENT);
    expect(err?.details).toMatch(/file signature/);
  });

  it("returns INVALID_FILE_CONTENT when the detected type is not in the allowed list", async () => {
    vi.mocked(fileTypeFromBlob).mockResolvedValue({ mime: "application/x-shockwave-flash", ext: "swf" } as never);
    const err = await validateFileContent(file("a.swf", "application/octet-stream"), SUPPORTED_FILE_TYPES);
    expect(err?.type).toBe(FileValidationErrorType.INVALID_FILE_CONTENT);
    expect(err?.message).toContain("Detected: application/x-shockwave-flash");
  });

  it("warns (but does NOT reject) when the extension does not match the detected type", async () => {
    vi.mocked(fileTypeFromBlob).mockResolvedValue({ mime: "image/png", ext: "png" } as never);
    const err = await validateFileContent(file("photo.jpeg", "image/png"), SUPPORTED_FILE_TYPES);
    expect(err).toBeNull(); // not rejected
    expect(console.warn).toHaveBeenCalled();
  });

  it("does not warn for extension aliases (jpg → jpeg)", async () => {
    vi.mocked(fileTypeFromBlob).mockResolvedValue({ mime: "image/jpeg", ext: "jpeg" } as never);
    await validateFileContent(file("photo.jpg", "image/jpeg"), SUPPORTED_FILE_TYPES);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// validateFile (orchestrator)
// ---------------------------------------------------------------------------

describe("validateFile", () => {
  it("short-circuits on size before checking content", async () => {
    vi.mocked(fileTypeFromBlob).mockResolvedValue({ mime: "image/png", ext: "png" } as never);
    const big = file("big.png", "image/png", "x".repeat(101));
    const err = await validateFile(big, { maxSize: 100, allowedTypes: SUPPORTED_FILE_TYPES });
    expect(err?.type).toBe(FileValidationErrorType.FILE_TOO_LARGE);
    // Content check should not have run (short-circuit).
    expect(fileTypeFromBlob).not.toHaveBeenCalled();
  });

  it("returns null for a valid file within all limits", async () => {
    vi.mocked(fileTypeFromBlob).mockResolvedValue({ mime: "image/png", ext: "png" } as never);
    const err = await validateFile(file("a.png", "image/png"), { maxSize: 10_000_000, allowedTypes: SUPPORTED_FILE_TYPES });
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateFiles (batch)
// ---------------------------------------------------------------------------

describe("validateFiles", () => {
  it("returns immediately with a count error when over the limit (no per-file validation)", async () => {
    vi.mocked(fileTypeFromBlob).mockResolvedValue({ mime: "image/png", ext: "png" } as never);
    const files = Array.from({ length: 6 }, (_, i) => file(`f${i}.png`, "image/png"));
    const result = await validateFiles(files, { maxSize: 10_000_000, maxFiles: 5, allowedTypes: SUPPORTED_FILE_TYPES });
    expect(result.validFiles).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].type).toBe(FileValidationErrorType.TOO_MANY_FILES);
    // No per-file content checks were performed.
    expect(fileTypeFromBlob).not.toHaveBeenCalled();
  });

  it("separates valid from invalid files", async () => {
    vi.mocked(fileTypeFromBlob).mockResolvedValue({ mime: "image/png", ext: "png" } as never);

    const good = file("good.png", "image/png");
    // bad.exe fails at MIME-type validation (before content check) — deterministic,
    // no dependency on fileTypeFromBlob call ordering under Promise.allSettled.
    const bad = file("bad.exe", "application/x-msdownload");
    const result = await validateFiles([good, bad], { maxSize: 10_000_000, maxFiles: 5, allowedTypes: SUPPORTED_FILE_TYPES });

    expect(result.validFiles).toHaveLength(1);
    expect(result.validFiles[0].name).toBe("good.png");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].type).toBe(FileValidationErrorType.UNSUPPORTED_MIME_TYPE);
  });
});
