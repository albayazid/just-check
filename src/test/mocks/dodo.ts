import { vi } from "vitest";

/**
 * Mock module factory for `@/lib/dodo-utils.server`.
 *
 * The real module reads `DODO_PAYMENTS_API_KEY` at module load (throws if
 * unset). Mock it with stable test constants:
 *
 *   vi.mock("@/lib/dodo-utils.server", () => dodoModuleMock());
 *
 * Tests that need to assert on `fetch` calls to Dodo should additionally
 * `vi.stubGlobal("fetch", vi.fn())` and configure the response.
 */
export const DODO_TEST_API_KEY = "dodo_test_key";
export const DODO_TEST_API_URL = "https://test.dodo.test";
export const DODO_TEST_RETURN_URL = "https://app.test/checkout/return";

export function dodoModuleMock() {
  return {
    DODO_API_KEY: DODO_TEST_API_KEY,
    DODO_API_URL: DODO_TEST_API_URL,
    DODO_RETURN_URL: DODO_TEST_RETURN_URL,
    DODO_ENVIRONMENT: "test_mode" as const,
  };
}

/**
 * Builds a `fetch` response stub. Chains match what the routes actually call:
 * `response.ok`, `await response.text()`, `await response.json()`.
 *
 * Pass `body` as an object to get JSON, or a string for raw text. `ok` derives
 * from `status` by default (status < 400 → ok).
 */
export function dodoResponse(
  body: unknown,
  init: { status?: number; ok?: boolean } = {},
): Response {
  const status = init.status ?? 200;
  const ok = init.ok ?? status < 400;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    text: vi.fn(() => Promise.resolve(text)),
    json: vi.fn(() =>
      Promise.resolve(typeof body === "string" ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : body),
    ),
  } as unknown as Response;
}
