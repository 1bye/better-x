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
import {
  fitImageEditorView,
  getSharedElementFrame,
} from "./image-editor-viewport.ts";

describe("image editor scene model", () => {
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

describe("image editor viewport", () => {
  test("keeps landscape images inset from every editor edge", () => {
    const view = fitImageEditorView({
      canvasHeight: 900,
      canvasWidth: 1600,
      stageHeight: 900,
      stageWidth: 1440,
    });
    expect(view.scale).toBeCloseTo(0.546);
    expect(view.x).toBeCloseTo(283.2);
    expect(view.y).toBeCloseTo(177.3);
  });

  test("fits portrait and very large images without cropping or stretching", () => {
    const portrait = fitImageEditorView({
      canvasHeight: 1600,
      canvasWidth: 900,
      stageHeight: 900,
      stageWidth: 1440,
    });
    expect(portrait.scale).toBeCloseTo(0.307_125);
    expect(portrait.x).toBeCloseTo(581.793_75);
    expect(portrait.y).toBeCloseTo(177.3);

    const veryLarge = fitImageEditorView({
      canvasHeight: 6000,
      canvasWidth: 8000,
      stageHeight: 900,
      stageWidth: 1440,
    });
    expect(veryLarge.scale).toBeCloseTo(0.0819);
    expect(veryLarge.x).toBeCloseTo(392.4);
    expect(veryLarge.y).toBeCloseTo(177.3);
  });

  test("does not enlarge small images", () => {
    expect(
      fitImageEditorView({
        canvasHeight: 240,
        canvasWidth: 320,
        stageHeight: 900,
        stageWidth: 1440,
      })
    ).toEqual({
      scale: 0.78,
      x: 595.2,
      y: 329.4,
    });
  });

  test("maps a composer image into the editor with a uniform scale", () => {
    expect(
      getSharedElementFrame({
        canvasHeight: 900,
        canvasWidth: 1600,
        origin: {
          borderRadius: 16,
          height: 225,
          left: 500,
          objectFit: "contain",
          top: 300,
          width: 400,
        },
        stageLeft: 0,
        stageTop: 0,
        view: { scale: 0.7, x: 160, y: 108 },
      })
    ).toMatchObject({
      transform: "translate(500px, 300px) scale(0.25)",
    });
  });

  test("fills and clips a wide source mask without distorting a portrait", () => {
    expect(
      getSharedElementFrame({
        canvasHeight: 1600,
        canvasWidth: 900,
        origin: {
          borderRadius: 16,
          height: 270,
          left: 100,
          objectFit: "cover",
          top: 100,
          width: 540,
        },
        stageLeft: 0,
        stageTop: 0,
        view: { scale: 0.3, x: 505, y: 120 },
      })
    ).toEqual({
      borderRadius: "26.666666666666668px",
      clipPath: "inset(575px 0px 575px 0px round 26.666666666666668px)",
      transform: "translate(100px, -245px) scale(0.6)",
    });
  });
});
