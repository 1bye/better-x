import { storage } from "wxt/utils/storage";

export interface FocusSettings {
  readonly enabled: boolean;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  enabled: true,
};

export const focusSettings = storage.defineItem<FocusSettings>(
  "local:focus-settings",
  {
    fallback: DEFAULT_FOCUS_SETTINGS,
  }
);

export const focusAnimations = storage.defineItem<boolean>(
  "local:focus-animations",
  {
    fallback: true,
  }
);

export const FOCUS_SCALES = [1, 1.25, 1.5] as const;
export type FocusScale = (typeof FOCUS_SCALES)[number];

export const focusScale = storage.defineItem<FocusScale>("local:focus-scale", {
  fallback: FOCUS_SCALES[0],
});

export const isFocusScale = (value: unknown): value is FocusScale =>
  FOCUS_SCALES.some((scale) => scale === value);
