import { describe, expect, test } from "bun:test";
import {
  clampUnit,
  getCenteredCropRect,
  getImageLayout,
} from "./image-editor.ts";

describe("image editor geometry", () => {
  test("centers X crop presets without stretching the source", () => {
    expect(getCenteredCropRect(1600, 900, "square")).toEqual({
      height: 900,
      width: 900,
      x: 350,
      y: 0,
    });
    expect(getCenteredCropRect(1000, 1000, "portrait")).toEqual({
      height: 1000,
      width: 800,
      x: 100,
      y: 0,
    });
    expect(getCenteredCropRect(1600, 900, "original")).toEqual({
      height: 900,
      width: 1600,
      x: 0,
      y: 0,
    });
  });

  test("fits the rendered image and optional presentation padding", () => {
    const crop = getCenteredCropRect(4000, 2000, "original");
    expect(getImageLayout(crop, 1000, false)).toEqual({
      canvasHeight: 500,
      canvasWidth: 1000,
      height: 500,
      width: 1000,
      x: 0,
      y: 0,
    });
    expect(getImageLayout(crop, 1160, true)).toEqual({
      canvasHeight: 623,
      canvasWidth: 1160,
      height: 537,
      width: 1074,
      x: 43,
      y: 43,
    });
  });

  test("clamps pointer coordinates to the image", () => {
    expect(clampUnit(-0.2)).toBe(0);
    expect(clampUnit(0.4)).toBe(0.4);
    expect(clampUnit(1.2)).toBe(1);
  });
});
