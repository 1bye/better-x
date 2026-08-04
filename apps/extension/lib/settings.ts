import { storage } from "wxt/utils/storage";

export interface FocusSettings {
  enabled: boolean;
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
