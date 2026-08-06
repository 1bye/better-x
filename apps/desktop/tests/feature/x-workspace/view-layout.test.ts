import { describe, expect, it } from "bun:test";
import {
  calculateDesktopViewLayout,
  DESKTOP_GEOMETRY,
  parseWorkspaceViewLayout,
} from "../../../src/feature/x-workspace/lib/view-layout.js";

describe("calculateDesktopViewLayout", () => {
  it("uses the reference titlebar and inset geometry", () => {
    const layout = calculateDesktopViewLayout(1280, 820, "workspace");

    expect(layout.post).toEqual({
      height: 766,
      width: 580,
      x: 693,
      y: 47,
    });
    expect(layout.feed).toEqual({
      height: 766,
      width: 680,
      x: 7,
      y: 47,
    });
    expect(DESKTOP_GEOMETRY.titlebarHeight).toBe(46);
    expect(DESKTOP_GEOMETRY.contentInset).toBe(6);
    expect(DESKTOP_GEOMETRY.workspaceRadius).toBe(14);
  });

  it("gives the complete content surface to login", () => {
    const layout = calculateDesktopViewLayout(1280, 820, "login");

    expect(layout.post).toBeNull();
    expect(layout.feed).toEqual({
      height: 766,
      width: 1266,
      x: 7,
      y: 47,
    });
  });

  it("clamps dimensions for a collapsed window", () => {
    const layout = calculateDesktopViewLayout(4, 20, "workspace");

    expect(layout.post).toEqual({
      height: 0,
      width: 0,
      x: 13,
      y: 47,
    });
    expect(layout.feed.width).toBe(0);
    expect(layout.feed.height).toBe(0);
  });

  it("accepts nullable renderer surfaces with bounded integer geometry", () => {
    expect(
      parseWorkspaceViewLayout({
        feed: { height: 700, width: 520, x: 7, y: 78 },
        post: null,
      })
    ).toEqual({
      feed: { height: 700, width: 520, x: 7, y: 78 },
      post: null,
    });
  });

  it("rejects malformed renderer geometry", () => {
    expect(
      parseWorkspaceViewLayout({
        feed: { height: 700, width: Number.NaN, x: 7, y: 78 },
        post: null,
      })
    ).toBeNull();
    expect(
      parseWorkspaceViewLayout({
        feed: null,
        post: { height: 700, width: 520, x: -1, y: 78 },
      })
    ).toBeNull();
  });
});
