import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase-client.server", () => ({
  getSupabaseAdminClient: vi.fn(),
}));
// Note: @/lib/subscription-utils.server is NOT mocked — getFolderLimit is a
// pure table lookup (no env read at module load), so it runs real.
import { getSupabaseAdminClient } from "@/lib/supabase-client.server";
import { createMockSupabaseClient, pgError } from "@/test/mocks/supabase";
import { buildFolder } from "@/test/factories";
import {
  getFolderLimitInfo,
  createFolder,
  updateFolder,
  deleteFolder,
  listFolders,
  moveConversationToFolder,
  getFolder,
} from "./folders";

function installSupabase(tables: Record<string, unknown> = {}, rpc: Record<string, unknown> = {}) {
  vi.mocked(getSupabaseAdminClient).mockReturnValue(
    createMockSupabaseClient({ tables, rpc } as never) as never,
  );
}

describe("getFolderLimitInfo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns count, plan limit, and canCreate=true when under the limit", async () => {
    installSupabase({ conversation_folders: { data: null, error: null, count: 3 } });
    const result = await getFolderLimitInfo("user-1", "go_monthly");
    expect(result).toEqual({ count: 3, limit: 10, canCreate: true });
  });

  it("reports canCreate=false when count equals the limit", async () => {
    installSupabase({ conversation_folders: { data: null, error: null, count: 10 } });
    const result = await getFolderLimitInfo("user-1", "go_monthly");
    expect(result.canCreate).toBe(false);
  });

  it("falls back to the free limit for an unknown plan", async () => {
    installSupabase({ conversation_folders: { data: null, error: null, count: 0 } });
    const result = await getFolderLimitInfo("user-1", "mystery_plan");
    expect(result.limit).toBe(2); // free fallback
  });

  it("rethrows count errors", async () => {
    installSupabase({ conversation_folders: { data: null, error: pgError("XX", "count fail") } });
    await expect(getFolderLimitInfo("user-1", "free")).rejects.toThrowError(/count fail/);
  });
});

describe("createFolder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the fetched folder on success", async () => {
    const folder = buildFolder({ id: "f1", name: "Personal" });
    installSupabase(
      { conversation_folders: { data: folder, error: null } },
      { create_folder_with_limit: { data: "f1", error: null } },
    );

    const result = await createFolder({ clerkUserId: "user-1", name: "Personal", planId: "free" });
    expect(result).toEqual(folder);
  });

  it("throws the limit-reached message verbatim when the RPC reports it", async () => {
    installSupabase(
      { conversation_folders: { data: null, error: null } },
      { create_folder_with_limit: { data: null, error: pgError("P0001", "Folder limit reached") } },
    );
    await expect(
      createFolder({ clerkUserId: "user-1", name: "X", planId: "free" }),
    ).rejects.toThrowError(/Folder limit reached/);
  });

  it("maps a 23505 unique violation to 'A folder with this name already exists'", async () => {
    installSupabase(
      { conversation_folders: { data: null, error: null } },
      { create_folder_with_limit: { data: null, error: pgError("23505", "dup") } },
    );
    await expect(
      createFolder({ clerkUserId: "user-1", name: "dup", planId: "free" }),
    ).rejects.toThrowError(/A folder with this name already exists/);
  });
});

describe("updateFolder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates and returns the folder", async () => {
    const updated = buildFolder({ name: "Renamed" });
    installSupabase({ conversation_folders: { data: updated, error: null } });

    const result = await updateFolder({ folderId: "f1", clerkUserId: "user-1", name: "Renamed" });
    expect(result).toEqual(updated);
  });

  it("throws 'Folder not found' when the update returns no data", async () => {
    installSupabase({ conversation_folders: { data: null, error: null } });
    await expect(
      updateFolder({ folderId: "ghost", clerkUserId: "user-1", name: "X" }),
    ).rejects.toThrowError(/Folder not found/);
  });

  it("maps a 23505 on update to the duplicate-name message", async () => {
    installSupabase({ conversation_folders: { data: null, error: pgError("23505", "dup") } });
    await expect(
      updateFolder({ folderId: "f1", clerkUserId: "user-1", name: "dup" }),
    ).rejects.toThrowError(/A folder with this name already exists/);
  });
});

describe("deleteFolder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("soft-deletes the folder then its conversations", async () => {
    installSupabase({
      conversation_folders: { data: null, error: null },
      conversations: { data: null, error: null },
    });

    await expect(deleteFolder("f1", "user-1")).resolves.toBeUndefined();
    const client = vi.mocked(getSupabaseAdminClient).mock.results[0]?.value as ReturnType<typeof createMockSupabaseClient>;
    expect(client.from).toHaveBeenCalledWith("conversation_folders");
    expect(client.from).toHaveBeenCalledWith("conversations");
  });

  it("throws when the folder delete errors", async () => {
    installSupabase({
      conversation_folders: { data: null, error: pgError("XX", "nope") },
    });
    await expect(deleteFolder("f1", "user-1")).rejects.toThrowError(/Failed to delete folder/);
  });
});

describe("listFolders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the folders array, defaulting to [] when data is null", async () => {
    installSupabase({ conversation_folders: { data: null, error: null } });
    expect(await listFolders({ clerkUserId: "user-1" })).toEqual([]);
  });

  it("returns the fetched folders", async () => {
    const folders = [buildFolder({ id: "a" }), buildFolder({ id: "b" })];
    installSupabase({ conversation_folders: { data: folders, error: null } });
    expect(await listFolders({ clerkUserId: "user-1" })).toEqual(folders);
  });
});

describe("moveConversationToFolder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws 'Folder not found' when the target folder does not exist", async () => {
    installSupabase({
      conversation_folders: { data: null, error: pgError("PGRST116") },
      conversations: { data: null, error: null },
    });

    await expect(
      moveConversationToFolder({ conversationId: "c1", folderId: "ghost", clerkUserId: "user-1" }),
    ).rejects.toThrowError(/Folder not found/);
  });

  it("moves to null (removes from folder) without a folder-ownership check", async () => {
    installSupabase({ conversations: { data: null, error: null } });

    await expect(
      moveConversationToFolder({ conversationId: "c1", folderId: null, clerkUserId: "user-1" }),
    ).resolves.toBeUndefined();

    const client = vi.mocked(getSupabaseAdminClient).mock.results[0]?.value as ReturnType<typeof createMockSupabaseClient>;
    // conversation_folders is never queried when folderId is null.
    expect(client.from).not.toHaveBeenCalledWith("conversation_folders");
  });
});

describe("getFolder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the folder when found", async () => {
    const folder = buildFolder();
    installSupabase({ conversation_folders: { data: folder, error: null } });
    expect(await getFolder("f1", "user-1")).toEqual(folder);
  });

  it("returns null when not found (error or missing data)", async () => {
    installSupabase({ conversation_folders: { data: null, error: pgError("PGRST116") } });
    expect(await getFolder("ghost", "user-1")).toBeNull();
  });
});
