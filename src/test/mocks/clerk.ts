import { vi } from "vitest";

/**
 * Clerk `@clerk/nextjs/server` auth mock helpers.
 *
 * In each test file:
 *
 *   vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
 *   import { auth } from "@clerk/nextjs/server";
 *
 * Then call `setAuthenticated(auth, "user_123")` or `setUnauthenticated(auth)`
 * in `beforeEach` / per-test. `auth()` returns `Promise<{ userId: string|null }>`.
 */
export function setAuthenticated(
  auth: ReturnType<typeof vi.fn>,
  userId = "user_test_1",
): void {
  auth.mockResolvedValue({ userId });
}

export function setUnauthenticated(auth: ReturnType<typeof vi.fn>): void {
  auth.mockResolvedValue({ userId: null });
}
