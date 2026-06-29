import { describe, it, expect } from "vitest";
import { getFaviconUrlFromGoogle } from "./favicon-utils";

describe("getFaviconUrlFromGoogle", () => {
  describe("valid URLs", () => {
    it("returns the Google S2 favicon URL for the hostname at the default size", () => {
      expect(getFaviconUrlFromGoogle("https://example.com")).toBe(
        "https://www.google.com/s2/favicons?domain=example.com&sz=32",
      );
    });

    it("extracts only the hostname from a URL with a path and query", () => {
      expect(
        getFaviconUrlFromGoogle("https://docs.example.com/guides/getting-started?v=2"),
      ).toBe("https://www.google.com/s2/favicons?domain=docs.example.com&sz=32");
    });

    it("honours a custom size", () => {
      expect(getFaviconUrlFromGoogle("https://example.com", 64)).toBe(
        "https://www.google.com/s2/favicons?domain=example.com&sz=64",
      );
    });

    it("accepts an http URL", () => {
      expect(getFaviconUrlFromGoogle("http://example.com")).toBe(
        "https://www.google.com/s2/favicons?domain=example.com&sz=32",
      );
    });

    it("drops the port (URL.hostname does not include it)", () => {
      // `new URL("https://localhost:3000").hostname` returns "localhost"; the
      // port lives on `.port`. Documenting this so a future refactor that
      // switches to host/host+port is a visible behaviour change.
      expect(getFaviconUrlFromGoogle("https://localhost:3000")).toBe(
        "https://www.google.com/s2/favicons?domain=localhost&sz=32",
      );
    });
  });

  describe("invalid URLs", () => {
    it.each([
      ["empty string", ""],
      ["plain text", "not-a-url"],
      ["bare path with no origin", "/relative/path"],
      ["just a hostname with no scheme", "example.com"],
    ])("returns undefined for %s", (_label, url) => {
      expect(getFaviconUrlFromGoogle(url)).toBeUndefined();
    });
  });
});
