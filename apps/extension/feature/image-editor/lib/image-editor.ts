export const IMAGE_EDITOR_OPEN_ATTRIBUTE = "data-better-x-image-editor-open";

export const EDITOR_TOOLS = [
  "select",
  "arrow",
  "rectangle",
  "text",
  "blur",
] as const;

export const RESIZE_HANDLES = [
  "north-west",
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
] as const;

export type EditorTool = (typeof EDITOR_TOOLS)[number];
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

export interface ScenePoint {
  x: number;
  y: number;
}

export interface SceneCrop {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface SceneBackground {
  angle: number;
  color: string;
  color2: string;
  enabled: boolean;
  padding: number;
  radius: number;
  shadow: number;
  type: "gradient" | "solid";
}

interface SceneObjectBase {
  height: number;
  id: string;
  locked: boolean;
  name: string;
  opacity: number;
  rotation: number;
  visible: boolean;
  width: number;
  x: number;
  y: number;
}

export interface ImageSceneObject extends SceneObjectBase {
  brightness: number;
  contrast: number;
  crop: SceneCrop;
  kind: "image";
  radius: number;
  saturation: number;
}

export interface TextSceneObject extends SceneObjectBase {
  align: CanvasTextAlign;
  background: string;
  color: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  kind: "text";
  letterSpacing: number;
  lineHeight: number;
  shadow: number;
  text: string;
}

export interface RectangleSceneObject extends SceneObjectBase {
  fill: string;
  kind: "rectangle";
  radius: number;
  stroke: string;
  strokeWidth: number;
}

export interface ArrowSceneObject extends SceneObjectBase {
  kind: "arrow";
  stroke: string;
  strokeWidth: number;
}

export interface BlurSceneObject extends SceneObjectBase {
  kind: "blur";
  strength: number;
}

export type SceneObject =
  | ArrowSceneObject
  | BlurSceneObject
  | ImageSceneObject
  | RectangleSceneObject
  | TextSceneObject;

export interface SceneDocument {
  background: SceneBackground;
  height: number;
  objects: readonly SceneObject[];
  width: number;
}

export interface SceneRenderLayout {
  canvasHeight: number;
  canvasWidth: number;
  height: number;
  scale: number;
  width: number;
  x: number;
  y: number;
}

const MIN_OBJECT_SIZE = 12;
const MIN_CROP_SIZE = 0.02;

export const clamp = (
  value: number,
  minimum: number,
  maximum: number
): number => Math.min(maximum, Math.max(minimum, value));

export const cloneScene = (scene: SceneDocument): SceneDocument =>
  structuredClone(scene);

export const createInitialScene = (
  imageWidth: number,
  imageHeight: number
): SceneDocument => ({
  background: {
    angle: 135,
    color: "#111827",
    color2: "#0f766e",
    enabled: false,
    padding: Math.round(Math.min(imageWidth, imageHeight) * 0.08),
    radius: Math.round(Math.min(imageWidth, imageHeight) * 0.025),
    shadow: 36,
    type: "gradient",
  },
  height: imageHeight,
  objects: [
    {
      brightness: 100,
      contrast: 100,
      crop: { height: 1, width: 1, x: 0, y: 0 },
      height: imageHeight,
      id: "image",
      kind: "image",
      locked: false,
      name: "Image",
      opacity: 1,
      radius: 0,
      rotation: 0,
      saturation: 100,
      visible: true,
      width: imageWidth,
      x: imageWidth / 2,
      y: imageHeight / 2,
    },
  ],
  width: imageWidth,
});

export const getSceneRenderLayout = (
  scene: SceneDocument,
  maxEdge: number
): SceneRenderLayout => {
  const padding = scene.background.enabled ? scene.background.padding : 0;
  const rawWidth = scene.width + padding * 2;
  const rawHeight = scene.height + padding * 2;
  const scale = Math.min(1, maxEdge / Math.max(rawWidth, rawHeight));
  const width = Math.max(1, Math.round(scene.width * scale));
  const height = Math.max(1, Math.round(scene.height * scale));
  const renderedPadding = Math.round(padding * scale);

  return {
    canvasHeight: height + renderedPadding * 2,
    canvasWidth: width + renderedPadding * 2,
    height,
    scale,
    width,
    x: renderedPadding,
    y: renderedPadding,
  };
};

export const getSceneObject = (
  scene: SceneDocument,
  objectId: string | null
): SceneObject | null =>
  scene.objects.find((object) => object.id === objectId) ?? null;

export const updateSceneObject = (
  scene: SceneDocument,
  objectId: string,
  update: (object: SceneObject) => SceneObject
): SceneDocument => ({
  ...scene,
  objects: scene.objects.map((object) =>
    object.id === objectId ? update(object) : object
  ),
});

export const removeSceneObject = (
  scene: SceneDocument,
  objectId: string
): SceneDocument => ({
  ...scene,
  objects: scene.objects.filter((object) => object.id !== objectId),
});

export const reorderSceneObject = (
  scene: SceneDocument,
  objectId: string,
  direction: -1 | 1
): SceneDocument => {
  const index = scene.objects.findIndex(
    (candidate) => candidate.id === objectId
  );
  const nextIndex = clamp(index + direction, 0, scene.objects.length - 1);
  if (index < 0 || index === nextIndex) {
    return scene;
  }
  const objects = [...scene.objects];
  const [movedObject] = objects.splice(index, 1);
  if (!movedObject) {
    return scene;
  }
  objects.splice(nextIndex, 0, movedObject);
  return { ...scene, objects };
};

export const rotatePoint = (point: ScenePoint, degrees: number): ScenePoint => {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
};

export const scenePointToObject = (
  point: ScenePoint,
  object: SceneObject
): ScenePoint =>
  rotatePoint(
    { x: point.x - object.x, y: point.y - object.y },
    -object.rotation
  );

export const isPointInObject = (
  point: ScenePoint,
  object: SceneObject
): boolean => {
  const local = scenePointToObject(point, object);
  return (
    Math.abs(local.x) <= object.width / 2 &&
    Math.abs(local.y) <= object.height / 2
  );
};

export const findSceneObjectAtPoint = (
  scene: SceneDocument,
  point: ScenePoint
): SceneObject | null => {
  for (const object of [...scene.objects].reverse()) {
    if (object.visible && isPointInObject(point, object)) {
      return object;
    }
  }
  return null;
};

const getHandleAxes = (
  handle: ResizeHandle
): { horizontal: -1 | 0 | 1; vertical: -1 | 0 | 1 } => {
  let horizontal: -1 | 0 | 1 = 0;
  let vertical: -1 | 0 | 1 = 0;
  if (handle.includes("west")) {
    horizontal = -1;
  } else if (handle.includes("east")) {
    horizontal = 1;
  }
  if (handle.includes("north")) {
    vertical = -1;
  } else if (handle.includes("south")) {
    vertical = 1;
  }
  return { horizontal, vertical };
};

export const resizeSceneObject = (
  object: SceneObject,
  handle: ResizeHandle,
  worldDelta: ScenePoint,
  lockAspect: boolean
): SceneObject => {
  const delta = rotatePoint(worldDelta, -object.rotation);
  const { horizontal, vertical } = getHandleAxes(handle);
  let width = Math.max(MIN_OBJECT_SIZE, object.width + delta.x * horizontal);
  let height = Math.max(MIN_OBJECT_SIZE, object.height + delta.y * vertical);

  if (lockAspect && horizontal && vertical) {
    const widthScale = width / object.width;
    const heightScale = height / object.height;
    const scale =
      Math.abs(widthScale - 1) > Math.abs(heightScale - 1)
        ? widthScale
        : heightScale;
    width = Math.max(MIN_OBJECT_SIZE, object.width * scale);
    height = Math.max(MIN_OBJECT_SIZE, object.height * scale);
  }

  const localShift = {
    x: horizontal * (width - object.width) * 0.5,
    y: vertical * (height - object.height) * 0.5,
  };
  const worldShift = rotatePoint(localShift, object.rotation);
  return {
    ...object,
    height,
    width,
    x: object.x + worldShift.x,
    y: object.y + worldShift.y,
  };
};

export const resizeImageCrop = (
  object: ImageSceneObject,
  handle: ResizeHandle,
  worldDelta: ScenePoint
): ImageSceneObject => {
  const delta = rotatePoint(worldDelta, -object.rotation);
  const { horizontal, vertical } = getHandleAxes(handle);
  const unitsPerCropX = object.width / object.crop.width;
  const unitsPerCropY = object.height / object.crop.height;
  let left = object.crop.x;
  let right = object.crop.x + object.crop.width;
  let top = object.crop.y;
  let bottom = object.crop.y + object.crop.height;

  if (horizontal < 0) {
    left = clamp(left + delta.x / unitsPerCropX, 0, right - MIN_CROP_SIZE);
  } else if (horizontal > 0) {
    right = clamp(right + delta.x / unitsPerCropX, left + MIN_CROP_SIZE, 1);
  }
  if (vertical < 0) {
    top = clamp(top + delta.y / unitsPerCropY, 0, bottom - MIN_CROP_SIZE);
  } else if (vertical > 0) {
    bottom = clamp(bottom + delta.y / unitsPerCropY, top + MIN_CROP_SIZE, 1);
  }

  const leftShift = (left - object.crop.x) * unitsPerCropX;
  const rightShift =
    (right - object.crop.x - object.crop.width) * unitsPerCropX;
  const topShift = (top - object.crop.y) * unitsPerCropY;
  const bottomShift =
    (bottom - object.crop.y - object.crop.height) * unitsPerCropY;
  const localShift = {
    x: (leftShift + rightShift) / 2,
    y: (topShift + bottomShift) / 2,
  };
  const worldShift = rotatePoint(localShift, object.rotation);

  return {
    ...object,
    crop: {
      height: bottom - top,
      width: right - left,
      x: left,
      y: top,
    },
    height: object.height + bottomShift - topShift,
    width: object.width + rightShift - leftShift,
    x: object.x + worldShift.x,
    y: object.y + worldShift.y,
  };
};

export const panImageCrop = (
  object: ImageSceneObject,
  worldDelta: ScenePoint
): ImageSceneObject => {
  const delta = rotatePoint(worldDelta, -object.rotation);
  const crop = {
    ...object.crop,
    x: clamp(
      object.crop.x - (delta.x / object.width) * object.crop.width,
      0,
      1 - object.crop.width
    ),
    y: clamp(
      object.crop.y - (delta.y / object.height) * object.crop.height,
      0,
      1 - object.crop.height
    ),
  };
  return { ...object, crop };
};

export const zoomImageCrop = (
  object: ImageSceneObject,
  zoom: number,
  anchor: ScenePoint
): ImageSceneObject => {
  const nextWidth = clamp(object.crop.width / zoom, MIN_CROP_SIZE, 1);
  const nextHeight = clamp(object.crop.height / zoom, MIN_CROP_SIZE, 1);
  const sourceX = object.crop.x + anchor.x * object.crop.width;
  const sourceY = object.crop.y + anchor.y * object.crop.height;
  return {
    ...object,
    crop: {
      height: nextHeight,
      width: nextWidth,
      x: clamp(sourceX - anchor.x * nextWidth, 0, 1 - nextWidth),
      y: clamp(sourceY - anchor.y * nextHeight, 0, 1 - nextHeight),
    },
  };
};

export const getSnappedPosition = (
  scene: SceneDocument,
  object: SceneObject,
  x: number,
  y: number,
  threshold: number
): ScenePoint => {
  const horizontalTargets = [scene.width / 2];
  const verticalTargets = [scene.height / 2];
  for (const candidate of scene.objects) {
    if (candidate.id !== object.id && candidate.visible) {
      horizontalTargets.push(candidate.x);
      verticalTargets.push(candidate.y);
    }
  }

  const snappedX =
    horizontalTargets.find((target) => Math.abs(target - x) <= threshold) ?? x;
  const snappedY =
    verticalTargets.find((target) => Math.abs(target - y) <= threshold) ?? y;
  return { x: snappedX, y: snappedY };
};

export const normalizeDegrees = (degrees: number): number => {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};
