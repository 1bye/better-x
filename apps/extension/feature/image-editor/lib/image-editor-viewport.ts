import { clamp } from "./image-editor";

const PRESENTATION_SCALE = 0.78;

export interface EditorViewTransform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

interface FitImageEditorViewOptions {
  readonly canvasHeight: number;
  readonly canvasWidth: number;
  readonly stageHeight: number;
  readonly stageWidth: number;
}

export interface ImageEditorOrigin {
  readonly getSnapshot: () => ImageEditorOriginSnapshot | null;
  readonly setVisible: (isVisible: boolean) => void;
}

export interface ImageEditorOriginSnapshot {
  readonly borderRadius: number;
  readonly height: number;
  readonly left: number;
  readonly objectFit: "contain" | "cover";
  readonly top: number;
  readonly width: number;
}

interface SharedElementTransformOptions {
  readonly canvasHeight: number;
  readonly canvasWidth: number;
  readonly origin: ImageEditorOriginSnapshot;
  readonly stageLeft: number;
  readonly stageTop: number;
  readonly view: EditorViewTransform;
}

export interface SharedElementFrame {
  readonly borderRadius: string;
  readonly clipPath: string;
  readonly transform: string;
}

export const formatEditorViewTransform = ({
  scale,
  x,
  y,
}: EditorViewTransform): string => `translate(${x}px, ${y}px) scale(${scale})`;

export const fitImageEditorView = ({
  canvasHeight,
  canvasWidth,
  stageHeight,
  stageWidth,
}: FitImageEditorViewOptions): EditorViewTransform => {
  const horizontalInset = clamp(stageWidth * 0.11, 28, 180);
  const topInset = clamp(stageHeight * 0.12, 64, 128);
  const bottomInset = clamp(stageHeight * 0.18, 96, 164);
  const availableWidth = Math.max(1, stageWidth - horizontalInset * 2);
  const availableHeight = Math.max(1, stageHeight - topInset - bottomInset);
  const scale = clamp(
    Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight, 1) *
      PRESENTATION_SCALE,
    0.05,
    PRESENTATION_SCALE
  );

  return {
    scale,
    x: horizontalInset + (availableWidth - canvasWidth * scale) / 2,
    y: topInset + (availableHeight - canvasHeight * scale) / 2,
  };
};

export const getSharedElementFrame = ({
  canvasHeight,
  canvasWidth,
  origin,
  stageLeft,
  stageTop,
  view,
}: SharedElementTransformOptions): SharedElementFrame => {
  const finalHeight = canvasHeight * view.scale;
  const finalWidth = canvasWidth * view.scale;
  const horizontalScale = origin.width / Math.max(1, finalWidth);
  const verticalScale = origin.height / Math.max(1, finalHeight);
  const originScale =
    origin.objectFit === "cover"
      ? Math.max(horizontalScale, verticalScale)
      : Math.min(horizontalScale, verticalScale);
  const startScale = view.scale * originScale;
  const startHeight = finalHeight * originScale;
  const startWidth = finalWidth * originScale;
  const horizontalClip =
    Math.max(0, (startWidth - origin.width) / 2) / startScale;
  const verticalClip =
    Math.max(0, (startHeight - origin.height) / 2) / startScale;
  const borderRadius = origin.borderRadius / startScale;

  return {
    borderRadius: `${borderRadius}px`,
    clipPath: `inset(${verticalClip}px ${horizontalClip}px ${verticalClip}px ${horizontalClip}px round ${borderRadius}px)`,
    transform: formatEditorViewTransform({
      scale: startScale,
      x: origin.left - stageLeft + (origin.width - startWidth) / 2,
      y: origin.top - stageTop + (origin.height - startHeight) / 2,
    }),
  };
};
