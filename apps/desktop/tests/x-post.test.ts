import { describe, expect, it } from "bun:test";
import {
  isAllowedXNavigation,
  normalizeXPostUrl,
  parseXFeedSelection,
} from "../src/shared/x-post.js";

describe("normalizeXPostUrl", () => {
  it("normalizes supported X and legacy Twitter post URLs", () => {
    expect(
      normalizeXPostUrl(
        "https://www.x.com/better_x/status/1234567890?s=20#fragment"
      )
    ).toBe("https://x.com/better_x/status/1234567890");
    expect(
      normalizeXPostUrl("https://twitter.com/better_x/status/42/photo/1")
    ).toBe("https://x.com/better_x/status/42");
  });

  it("rejects non-X, insecure, and non-post URLs", () => {
    expect(
      normalizeXPostUrl("https://example.com/better_x/status/42")
    ).toBeNull();
    expect(normalizeXPostUrl("http://x.com/better_x/status/42")).toBeNull();
    expect(normalizeXPostUrl("https://x.com/home")).toBeNull();
    expect(normalizeXPostUrl({ url: "https://x.com/a/status/1" })).toBeNull();
  });
});

describe("parseXFeedSelection", () => {
  it("deduplicates and limits speculative post URLs", () => {
    expect(
      parseXFeedSelection({
        currentUrl: "https://x.com/a/status/1",
        nextUrls: [
          "https://x.com/a/status/1",
          "https://x.com/b/status/2",
          "https://twitter.com/b/status/2",
          "https://x.com/c/status/3",
          "https://x.com/d/status/4",
        ],
      })
    ).toEqual({
      currentUrl: "https://x.com/a/status/1",
      nextUrls: ["https://x.com/b/status/2", "https://x.com/c/status/3"],
    });
  });

  it("rejects malformed selections", () => {
    expect(parseXFeedSelection(null)).toBeNull();
    expect(
      parseXFeedSelection({
        currentUrl: "https://example.com/a/status/1",
        nextUrls: [],
      })
    ).toBeNull();
    expect(
      parseXFeedSelection({
        currentUrl: "https://x.com/a/status/1",
        nextUrls: "https://x.com/b/status/2",
      })
    ).toBeNull();
  });
});

describe("isAllowedXNavigation", () => {
  it("allows only secure X-owned navigation", () => {
    expect(isAllowedXNavigation("https://x.com/home")).toBe(true);
    expect(isAllowedXNavigation("https://twitter.com/settings")).toBe(true);
    expect(isAllowedXNavigation("https://example.com")).toBe(false);
    expect(isAllowedXNavigation("javascript:alert(1)")).toBe(false);
  });
});
