import { describe, it, expect } from "vitest";
import {
  ATTACHMENT_URL_PREFIX,
  isAttachmentUrl,
  extractFileIdFromAttachmentUrl,
} from "./attachment-url-utils";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_URL = `${ATTACHMENT_URL_PREFIX}${UUID}`;

describe("ATTACHMENT_URL_PREFIX", () => {
  it("is the attachment:// scheme", () => {
    expect(ATTACHMENT_URL_PREFIX).toBe("attachment://");
  });
});

describe("isAttachmentUrl", () => {
  describe("valid attachment URLs", () => {
    it("accepts a canonical attachment://{uuid} URL", () => {
      expect(isAttachmentUrl(VALID_URL)).toBe(true);
    });

    it("accepts an uppercase UUID", () => {
      expect(isAttachmentUrl(`attachment://${UUID.toUpperCase()}`)).toBe(true);
    });
  });

  describe("invalid attachment URLs", () => {
    it.each([
      ["wrong scheme", `https://${UUID}`],
      ["missing uuid", "attachment://"],
      ["non-uuid file id", "attachment://not-a-uuid"],
      ["uuid with extra characters", `attachment://${UUID}extra`],
      ["uuid without enough segments", "attachment://550e8400-e29b-41d4-a716"],
      ["bare uuid without prefix", UUID],
      ["empty string", ""],
      ["http url", "http://example.com/file"],
    ])("rejects %s", (_label, url) => {
      expect(isAttachmentUrl(url)).toBe(false);
    });
  });
});

describe("extractFileIdFromAttachmentUrl", () => {
  it("returns the UUID for a valid attachment URL", () => {
    expect(extractFileIdFromAttachmentUrl(VALID_URL)).toBe(UUID);
  });

  it("returns the uppercase UUID verbatim (no normalisation)", () => {
    const upper = UUID.toUpperCase();
    expect(extractFileIdFromAttachmentUrl(`attachment://${upper}`)).toBe(upper);
  });

  it.each([
    ["a url with the wrong scheme", `https://${UUID}`],
    ["an attachment url with a non-uuid id", "attachment://nope"],
    ["an empty string", ""],
  ])("throws for %s", (_label, url) => {
    expect(() => extractFileIdFromAttachmentUrl(url)).toThrowError(
      /Invalid attachment URL/,
    );
  });
});
