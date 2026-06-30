import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("pdf2json", () => ({
  default: function PDFParser(this: {
    _cb?: (v: unknown) => void;
    once: (e: string, fn: (v: unknown) => void) => void;
    parseBuffer: () => void;
    destroy: () => void;
  }) {
    this.once = (event: string, fn: (v: unknown) => void) => {
      if (event === "pdfParser_dataReady") this._cb = fn;
    };
    this.parseBuffer = () => {
      this._cb?.({ Pages: [{ Texts: [{ R: [{ T: "pdf page text" }] }] }] });
    };
    this.destroy = () => {};
  } as never,
}));

import mammoth from "mammoth";
import {
  isTextExtractableMimeType,
  isStructuredExtractableMimeType,
  isImageMimeType,
  inferProcessableMimeTypeFromFilename,
  getModelProcessableMimeType,
  extractFileForModel,
  formatExtractedFileForModel,
  PDF_MIME_TYPE,
  DOCX_MIME_TYPE,
} from "./file-extraction";

function file(name: string, type: string, content = "hello"): File {
  return new File([content], name, { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("isTextExtractableMimeType", () => {
  it.each(["text/plain", "text/markdown", "application/json", "text/csv"])("returns true for %s", (mt) => {
    expect(isTextExtractableMimeType(mt)).toBe(true);
  });
  it("returns false for non-text types", () => {
    expect(isTextExtractableMimeType("image/png")).toBe(false);
    expect(isTextExtractableMimeType("application/octet-stream")).toBe(false);
  });
});

describe("isStructuredExtractableMimeType", () => {
  it("returns true for PDF and DOCX", () => {
    expect(isStructuredExtractableMimeType(PDF_MIME_TYPE)).toBe(true);
    expect(isStructuredExtractableMimeType(DOCX_MIME_TYPE)).toBe(true);
  });
  it("returns false for plain text", () => {
    expect(isStructuredExtractableMimeType("text/plain")).toBe(false);
  });
});

describe("isImageMimeType", () => {
  it("returns true for any image/* prefix", () => {
    for (const mt of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(isImageMimeType(mt), mt).toBe(true);
    }
  });
  it("returns false for non-image", () => {
    expect(isImageMimeType("application/pdf")).toBe(false);
  });
});

describe("inferProcessableMimeTypeFromFilename", () => {
  it("infers from common extensions", () => {
    expect(inferProcessableMimeTypeFromFilename("a.txt")).toBe("text/plain");
    expect(inferProcessableMimeTypeFromFilename("a.json")).toBe("application/json");
    expect(inferProcessableMimeTypeFromFilename("a.pdf")).toBe(PDF_MIME_TYPE);
    expect(inferProcessableMimeTypeFromFilename("a.docx")).toBe(DOCX_MIME_TYPE);
  });
  it("returns null for unknown extensions or no extension", () => {
    expect(inferProcessableMimeTypeFromFilename("a.xyz")).toBeNull();
    expect(inferProcessableMimeTypeFromFilename("noext")).toBeNull();
  });
  it("is case-insensitive on the extension", () => {
    expect(inferProcessableMimeTypeFromFilename("A.TXT")).toBe("text/plain");
  });
});

describe("getModelProcessableMimeType", () => {
  it("returns the file.type when it is set and not octet-stream", () => {
    expect(getModelProcessableMimeType(file("a.png", "image/png"))).toBe("image/png");
  });
  it("falls back to filename inference when type is octet-stream", () => {
    expect(getModelProcessableMimeType(file("notes.txt", "application/octet-stream"))).toBe("text/plain");
  });
  it("falls back to filename inference when type is empty", () => {
    expect(getModelProcessableMimeType(file("data.json", ""))).toBe("application/json");
  });
  it("returns the original type when no inference is possible", () => {
    expect(getModelProcessableMimeType(file("mystery", "application/octet-stream"))).toBe("application/octet-stream");
  });
});

// ---------------------------------------------------------------------------
// extractFileForModel dispatch
// ---------------------------------------------------------------------------

describe("extractFileForModel — dispatch", () => {
  it("returns not_applicable for images", async () => {
    const result = await extractFileForModel(file("a.png", "image/png"));
    expect(result.status).toBe("not_applicable");
    expect(result.strategy).toBe("image");
  });

  it("returns unsupported for unrecognized types", async () => {
    const result = await extractFileForModel(file("a.xyz", "application/x-custom"));
    expect(result.status).toBe("unsupported");
    expect(result.strategy).toBe("none");
    expect(result.error).toContain("Unsupported");
  });

  it("extracts text content for text files", async () => {
    const result = await extractFileForModel(file("a.txt", "text/plain", "hello world"));
    expect(result.status).toBe("extracted");
    expect(result.strategy).toBe("text");
    expect(result.text).toBe("hello world");
  });

  it("strips NUL characters from extracted text", async () => {
    const result = await extractFileForModel(file("a.txt", "text/plain", "he\u0000llo"));
    expect(result.text).toBe("hello");
  });

  it("extracts text from DOCX via mammoth", async () => {
    vi.mocked(mammoth.extractRawText).mockResolvedValue({ value: "docx content" } as never);
    const result = await extractFileForModel(file("a.docx", DOCX_MIME_TYPE));
    expect(result.status).toBe("extracted");
    expect(result.strategy).toBe("docx");
    expect(result.text).toBe("docx content");
  });

  it("extracts text from PDF via pdf2json", async () => {
    const result = await extractFileForModel(file("a.pdf", PDF_MIME_TYPE));
    expect(result.status).toBe("extracted");
    expect(result.strategy).toBe("pdf");
    expect(result.pages?.[0]?.text).toBe("pdf page text");
  });

  it("returns failed (never throws) when mammoth errors", async () => {
    vi.mocked(mammoth.extractRawText).mockRejectedValue(new Error("corrupt docx"));
    const result = await extractFileForModel(file("a.docx", DOCX_MIME_TYPE));
    expect(result.status).toBe("failed");
    expect(result.error).toContain("corrupt docx");
  });
});

// ---------------------------------------------------------------------------
// formatExtractedFileForModel (pure — builds the LLM string)
// ---------------------------------------------------------------------------

describe("formatExtractedFileForModel", () => {
  it("builds the extracted-text block with content", () => {
    const out = formatExtractedFileForModel({
      filename: "notes.txt",
      mimeType: "text/plain",
      extraction: { status: "extracted", strategy: "text", text: "hello" },
    });
    expect(out).toContain("<attached_file>");
    expect(out).toContain("name: notes.txt");
    expect(out).toContain("mime_type: text/plain");
    expect(out).toContain("<content>");
    expect(out).toContain("hello");
    expect(out).toContain("</attached_file>");
  });

  it("builds the multi-page block for PDF pages", () => {
    const out = formatExtractedFileForModel({
      filename: "doc.pdf",
      mimeType: PDF_MIME_TYPE,
      extraction: {
        status: "extracted",
        strategy: "pdf",
        pages: [{ pageNumber: 1, text: "page one" }, { pageNumber: 2, text: "page two" }],
      },
    });
    expect(out).toContain("<page=1>");
    expect(out).toContain("page one");
    expect(out).toContain("<page=2>");
    expect(out).toContain("page two");
  });

  it("builds the unavailable block when extraction is missing or not extracted", () => {
    const out = formatExtractedFileForModel({
      filename: "broken.pdf",
      mimeType: PDF_MIME_TYPE,
      extraction: { status: "failed", strategy: "pdf", error: "parse error" },
    });
    expect(out).toContain("status: unavailable");
    expect(out).toContain("error: parse error");
  });

  it("omits the error line when there is no error", () => {
    const out = formatExtractedFileForModel({
      filename: "empty.txt",
      mimeType: "text/plain",
      extraction: undefined,
    });
    expect(out).toContain("status: unavailable");
    expect(out).not.toContain("error:");
  });
});
