import { describe, expect, test } from "bun:test";

import { fitFocusScale } from "./focus-scale.ts";

describe("fitFocusScale", () => {
  test("uses the requested scale as a maximum without shrinking below 1x", () => {
    expect(
      fitFocusScale({
        availableHeight: 900,
        availableWidth: 900,
        postHeight: 400,
        postWidth: 600,
        requestedScale: 1.5,
      })
    ).toBe(1.5);
    expect(
      fitFocusScale({
        availableHeight: 900,
        availableWidth: 720,
        postHeight: 400,
        postWidth: 600,
        requestedScale: 1.5,
      })
    ).toBe(1.2);
    expect(
      fitFocusScale({
        availableHeight: 900,
        availableWidth: 900,
        postHeight: 800,
        postWidth: 600,
        requestedScale: 1.5,
      })
    ).toBe(1.125);
    expect(
      fitFocusScale({
        availableHeight: 600,
        availableWidth: 900,
        postHeight: 900,
        postWidth: 600,
        requestedScale: 1.5,
      })
    ).toBe(1);
  });
});
