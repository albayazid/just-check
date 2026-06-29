import { describe, it, expect } from "vitest";
import { UUID_REGEX } from "./uuid-utils";

// A canonical UUIDv4 used across happy-path cases.
const VALID = "550e8400-e29b-41d4-a716-446655440000";

describe("UUID_REGEX", () => {
  describe("valid inputs", () => {
    it("matches a canonical lowercase UUID", () => {
      expect(UUID_REGEX.test(VALID)).toBe(true);
    });

    it("matches an uppercase UUID (case-insensitive)", () => {
      expect(UUID_REGEX.test(VALID.toUpperCase())).toBe(true);
    });

    it("matches a UUIDv1-style value (any hex is allowed)", () => {
      expect(UUID_REGEX.test("00000000-0000-1000-8000-000000000000")).toBe(true);
    });

    it("matches all-f hex digits", () => {
      expect(UUID_REGEX.test("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe(true);
    });

    it("matches all-0 nil UUID", () => {
      expect(UUID_REGEX.test("00000000-0000-0000-0000-000000000000")).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    it.each([
      ["empty string", ""],
      ["missing dashes", "550e8400e29b41d4a716446655440000"],
      ["wrong segment lengths", "550e8400-e29b-41d4-a716-44665544000"],
      ["non-hex character", "550e8400-e29b-41d4-a716-44665544000g"],
      ["trailing newline", `${VALID}\n`],
      ["trailing space", `${VALID} `],
      ["braced form", `{${VALID}}`],
      ["urn form", `urn:uuid:${VALID}`],
      ["random string", "not-a-uuid"],
    ])("rejects %s", (_label, value) => {
      expect(UUID_REGEX.test(value)).toBe(false);
    });
  });
});
