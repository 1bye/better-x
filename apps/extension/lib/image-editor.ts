export const CROP_PRESETS = ["original", "square", "portrait", "wide"] as const;

export type CropPreset = (typeof CROP_PRESETS)[number];

export interface ImageRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface ImageLayout extends ImageRect {
  canvasHeight: number;
  canvasWidth: number;
}

const CROP_RATIOS: Partial<Record<CropPreset, number>> = {
  portrait: 4 / 5,
  square: 1,
  wide: 16 / 9,
};

const BACKGROUND_PADDING_RATIO = 0.08;

export const getCenteredCropRect = (
  imageWidth: number,
  imageHeight: number,
  preset: CropPreset
): ImageRect => {
  const ratio = CROP_RATIOS[preset];
  if (!ratio) {
    return {
      height: imageHeight,
      width: imageWidth,
      x: 0,
      y: 0,
    };
  }

  const imageRatio = imageWidth / imageHeight;
  if (imageRatio > ratio) {
    const width = imageHeight * ratio;
    return {
      height: imageHeight,
      width,
      x: (imageWidth - width) / 2,
      y: 0,
    };
  }

  const height = imageWidth / ratio;
  return {
    height,
    width: imageWidth,
    x: 0,
    y: (imageHeight - height) / 2,
  };
};

export const getImageLayout = (
  crop: ImageRect,
  maxEdge: number,
  hasBackground: boolean
): ImageLayout => {
  const paddingRatio = hasBackground ? BACKGROUND_PADDING_RATIO : 0;
  const rawPadding = Math.min(crop.width, crop.height) * paddingRatio;
  const rawWidth = crop.width + rawPadding * 2;
  const rawHeight = crop.height + rawPadding * 2;
  const scale = Math.min(1, maxEdge / Math.max(rawWidth, rawHeight));
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  const padding = Math.round(rawPadding * scale);

  return {
    canvasHeight: height + padding * 2,
    canvasWidth: width + padding * 2,
    height,
    width,
    x: padding,
    y: padding,
  };
};

export const clampUnit = (value: number): number =>
  Math.min(1, Math.max(0, value));
