import { vi } from "vitest";

/**
 * Mock module factory for `@/lib/ratelimit`.
 *
 * The real module instantiates Upstash clients at module load (throws without
 * `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`), so importing it in
 * tests without env set crashes. Mock it instead:
 *
 *   vi.mock("@/lib/ratelimit", () => rateLimitModuleMock());
 *   import { subscriptionRatelimit } from "@/lib/ratelimit";
 *
 * All limiters succeed by default. To simulate a 429:
 *   vi.mocked(subscriptionRatelimit.limit).mockResolvedValue({ success: false });
 */

const ALL_LIMITERS = [
  "chatRatelimit",
  "conversationsRatelimit",
  "weatherRatelimit",
  "subscriptionGetRatelimit",
  "subscriptionRatelimit",
  "subscriptionPreviewRatelimit",
  "checkoutRatelimit",
  "onboardingRatelimit",
  "userSettingsPostRatelimit",
  "userSettingsGetRatelimit",
  "userMemoryGetRatelimit",
  "userMemoryChangeRatelimit",
  "userProfileGetRatelimit",
  "userProfilePatchRatelimit",
  "messageFeedbackGetRatelimit",
  "messageFeedbackChangeRatelimit",
  "feedbackSubmitRatelimit",
  "uploadRatelimit",
  "attachmentResolveRatelimit",
  "shareCreateRatelimit",
  "shareGetRatelimit",
  "shareRevokeRatelimit",
  "shareViewRatelimit",
  "shareForkRatelimit",
  "shareAttachmentRatelimit",
] as const;

const succeedingLimiter = () => ({
  limit: vi.fn(() => Promise.resolve({ success: true })),
});

/** Module factory: every limiter succeeds by default. */
export function rateLimitModuleMock(): Record<string, { limit: ReturnType<typeof vi.fn> }> {
  const mocks: Record<string, { limit: ReturnType<typeof vi.fn> }> = {};
  for (const name of ALL_LIMITERS) {
    mocks[name] = succeedingLimiter();
  }
  return mocks;
}

/**
 * Cast helpers for `.mockResolvedValue(...)`. The real `RatelimitResponse`
 * from `@upstash/ratelimit` carries extra fields (remaining, limit, reset);
 * routes only read `.success`, but TS checks against the full type. These
 * helpers return `never` so they're assignable to `RatelimitResponse` without
 * scattering `as never` casts across every route test.
 */
export function rateLimitAllowed() {
  return { success: true } as never;
}

export function rateLimitBlocked() {
  return { success: false } as never;
}
