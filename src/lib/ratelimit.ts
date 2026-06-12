import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// TODO: Rate limiting is neccessary. But I am new to it. Good to take a look and learn more about.
// TODO: Notice. Some limiter is being shared in multiple endpoint. Not bug, but it's better to take a look.

export const chatRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1m"),
});

export const conversationsRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1m"),
});

export const weatherRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1m"),
});

export const subscriptionGetRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(300, "1m"),
});

export const subscriptionRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1m"),
});

export const subscriptionPreviewRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "1m"),
});

export const checkoutRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1m"),
});

export const onboardingRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1m"),
});

export const userSettingsPostRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "1m"),
});

export const userSettingsGetRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1m"),
});

export const userMemoryGetRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1m"),
});

export const userMemoryChangeRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "1m"),
});

export const userProfileGetRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1m"),
});

export const userProfilePatchRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "1m"),
});

export const messageFeedbackGetRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(200, "1m"),
});

export const messageFeedbackChangeRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1m"),
});

export const feedbackSubmitRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1m"),
});

export const uploadRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1m"),
});

export const attachmentResolveRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1m"),
});

// ============================================================================
// SHARING RATE LIMITERS
// ============================================================================

export const shareCreateRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1m"),
});

export const shareGetRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1m"),
});

export const shareRevokeRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1m"),
});

// Public endpoints — use IP-based keys since no auth is required
export const shareViewRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(200, "1m"),
});

export const shareForkRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1m"),
});

export const shareAttachmentRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1m"),
});
