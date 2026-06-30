import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase-client.server", () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock("uuid", () => ({ v4: vi.fn(() => "fixed-uuid") }));

import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { createMockSupabaseClient, pgError } from "@/test/mocks/supabase";
import {
  generateStoragePath,
  uploadFileToStorage,
  createSignedUrl,
  resolveFromStoragePath,
  validateFileAccess,
  deleteFileFromStorage,
} from "./file-storage-service";

function installSupabase(config: { tables?: Record<string, unknown>; rpc?: Record<string, unknown>; storage?: Record<string, unknown> } = {}) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient(config as never) as never,
  );
}

const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 3600_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// generateStoragePath (pure)
// ---------------------------------------------------------------------------

describe("generateStoragePath", () => {
  it("produces the expected path format with sanitized filename", () => {
    const path = generateStoragePath("user-1", "my file (1).png");
    expect(path).toBe("private/chat-file-upload/user-1/fixed-uuid-my_file__1_.png");
  });

  it("replaces every non-alphanumeric/dot/dash char with underscore", () => {
    expect(generateStoragePath("u", "a@b#c$d.txt")).toBe("private/chat-file-upload/u/fixed-uuid-a_b_c_d.txt");
  });

  it("preserves dots and dashes in the filename", () => {
    expect(generateStoragePath("u", "archive-1.0.json")).toBe("private/chat-file-upload/u/fixed-uuid-archive-1.0.json");
  });
});

// ---------------------------------------------------------------------------
// validateFileAccess (SECURITY — fail-closed)
// ---------------------------------------------------------------------------

describe("validateFileAccess", () => {
  it("returns true immediately for an empty fileIds list (no RPC)", async () => {
    installSupabase();
    expect(await validateFileAccess([], "user-1", "conv-1")).toBe(true);
    // validateFileAccess short-circuits before touching supabase at all.
    expect(getSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("returns true when the RPC confirms access (data === true, strict equality)", async () => {
    installSupabase({ rpc: { validate_file_access_for_conversation: { data: true, error: null } } });
    expect(await validateFileAccess(["file-1"], "user-1", "conv-1")).toBe(true);
  });

  it("returns false when data is truthy but not strictly true (e.g. 'true' string)", async () => {
    installSupabase({ rpc: { validate_file_access_for_conversation: { data: "true", error: null } } });
    expect(await validateFileAccess(["file-1"], "user-1", "conv-1")).toBe(false);
  });

  it("FAILS CLOSED: returns false when the RPC errors", async () => {
    installSupabase({ rpc: { validate_file_access_for_conversation: { data: null, error: pgError("XX", "rpc down") } } });
    expect(await validateFileAccess(["file-1"], "user-1", "conv-1")).toBe(false);
  });

  it("returns false when the RPC returns null/false", async () => {
    installSupabase({ rpc: { validate_file_access_for_conversation: { data: false, error: null } } });
    expect(await validateFileAccess(["file-1"], "user-1", "conv-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveFromStoragePath (cache logic)
// ---------------------------------------------------------------------------

describe("resolveFromStoragePath", () => {
  it("returns the cached URL when the cache is valid (not expired)", async () => {
    installSupabase({
      tables: { signed_url_cache: { data: { signed_url: "https://cached", expires_at: FUTURE }, error: null } },
    });

    const url = await resolveFromStoragePath("file-1", "private/path");
    expect(url).toBe("https://cached");
    // Should NOT have called storage.createSignedUrl (cache hit).
    const client = vi.mocked(getSupabaseAdminClient).mock.results[0]?.value;
    expect(client.storage.from().createSignedUrl).not.toHaveBeenCalled();
  });

  it("generates a fresh URL when the cache is expired", async () => {
    installSupabase({
      tables: {
        signed_url_cache: [
          { data: { signed_url: "https://expired", expires_at: PAST }, error: null }, // cache read (expired)
          { data: null, error: null }, // cache write (upsert)
        ],
      },
      storage: { createSignedUrl: { data: { signedUrl: "https://fresh" }, error: null } },
    });

    const url = await resolveFromStoragePath("file-1", "private/path");
    expect(url).toBe("https://fresh");
    const client = vi.mocked(getSupabaseAdminClient).mock.results[0]?.value;
    expect(client.storage.from().createSignedUrl).toHaveBeenCalledWith("private/path", expect.any(Number));
  });

  it("generates a fresh URL when there is no cache row", async () => {
    installSupabase({
      tables: {
        signed_url_cache: [
          { data: null, error: pgError("PGRST116") }, // no cache row
          { data: null, error: null }, // cache write
        ],
      },
      storage: { createSignedUrl: { data: { signedUrl: "https://fresh" }, error: null } },
    });

    const url = await resolveFromStoragePath("file-1", "private/path");
    expect(url).toBe("https://fresh");
  });
});

// ---------------------------------------------------------------------------
// uploadFileToStorage
// ---------------------------------------------------------------------------

describe("uploadFileToStorage", () => {
  it("returns the storage path on success", async () => {
    installSupabase({ storage: { upload: { data: { path: "ok" }, error: null } } });
    const f = new File(["x"], "test.txt", { type: "text/plain" });
    const path = await uploadFileToStorage("user-1", f);
    expect(path).toContain("fixed-uuid-test.txt");
  });

  it("throws when the upload errors", async () => {
    installSupabase({ storage: { upload: { data: null, error: pgError("X", "quota exceeded") } } });
    const f = new File(["x"], "test.txt");
    await expect(uploadFileToStorage("user-1", f)).rejects.toThrowError(/quota exceeded/);
  });
});

// ---------------------------------------------------------------------------
// createSignedUrl
// ---------------------------------------------------------------------------

describe("createSignedUrl", () => {
  it("returns the signed URL on success", async () => {
    installSupabase({ storage: { createSignedUrl: { data: { signedUrl: "https://signed" }, error: null } } });
    expect(await createSignedUrl("private/path")).toBe("https://signed");
  });

  it("throws on error", async () => {
    installSupabase({ storage: { createSignedUrl: { data: null, error: pgError("X", "not found") } } });
    await expect(createSignedUrl("private/path")).rejects.toThrowError(/not found/);
  });
});

// ---------------------------------------------------------------------------
// deleteFileFromStorage (swallows errors)
// ---------------------------------------------------------------------------

describe("deleteFileFromStorage", () => {
  it("resolves silently on success", async () => {
    installSupabase({ storage: { remove: { data: null, error: null } } });
    await expect(deleteFileFromStorage("private/path")).resolves.toBeUndefined();
  });

  it("swallows errors (only logs, never throws)", async () => {
    installSupabase({ storage: { remove: { data: null, error: pgError("X", "delete failed") } } });
    await expect(deleteFileFromStorage("private/path")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
