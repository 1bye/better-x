import { describe, expect, test } from "bun:test";
import {
  createInitialScene,
  getSceneRenderLayout,
  isPointInObject,
  panImageCrop,
  resizeImageCrop,
  resizeSceneObject,
  zoomImageCrop,
} from "./image-editor.ts";

describe("image editor scene", () => {
  test("resizes objects around the opposite handle", () => {
    const [image] = createInitialScene(1600, 900).objects;
    const resized = resizeSceneObject(image, "east", { x: 100, y: 0 }, false);
    expect(resized).toMatchObject({
      height: 900,
      width: 1700,
      x: 850,
      y: 450,
    });
  });

  test("makes crop frames freeform without stretching image content", () => {
    const [object] = createInitialScene(1600, 900).objects;
    if (object.kind !== "image") {
      throw new Error("The initial scene must contain an image.");
    }

    const cropped = resizeImageCrop(object, "west", { x: 160, y: 0 });
    expect(cropped).toMatchObject({
      crop: { height: 1, width: 0.9, x: 0.1, y: 0 },
      height: 900,
      width: 1440,
      x: 880,
      y: 450,
    });

    const panned = panImageCrop(cropped, { x: 144, y: 0 });
    expect(panned.crop.x).toBeCloseTo(0.01);

    const zoomed = zoomImageCrop(cropped, 2, { x: 0.5, y: 0.5 });
    expect(zoomed.crop.height).toBeCloseTo(0.5);
    expect(zoomed.crop.width).toBeCloseTo(0.45);
    expect(zoomed.crop.x).toBeCloseTo(0.325);
    expect(zoomed.crop.y).toBeCloseTo(0.25);
  });

  test("hit-tests rotated objects in their local coordinates", () => {
    const [image] = createInitialScene(400, 200).objects;
    const rotated = { ...image, rotation: 45 };
    expect(isPointInObject({ x: 200, y: 100 }, rotated)).toBe(true);
    expect(isPointInObject({ x: 400, y: 300 }, rotated)).toBe(false);
  });

  test("fits the scene and presentation background to an export edge", () => {
    const scene = createInitialScene(1600, 900);
    scene.background.enabled = true;
    expect(getSceneRenderLayout(scene, 872)).toEqual({
      canvasHeight: 522,
      canvasWidth: 872,
      height: 450,
      scale: 0.5,
      width: 800,
      x: 36,
      y: 36,
    });
  });
});
