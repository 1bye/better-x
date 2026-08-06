import type { FocusScale } from "./settings";

interface FitFocusScaleOptions {
  availableHeight: number;
  availableWidth: number;
  postHeight: number;
  postWidth: number;
  requestedScale: FocusScale;
}

export const fitFocusScale = ({
  availableHeight,
  availableWidth,
  postHeight,
  postWidth,
  requestedScale,
}: FitFocusScaleOptions): number => {
  if (
    availableHeight <= 0 ||
    availableWidth <= 0 ||
    postHeight <= 0 ||
    postWidth <= 0
  ) {
    return requestedScale;
  }
  const fittedScale = Math.min(
    availableHeight / postHeight,
    availableWidth / postWidth
  );
  return Math.max(1, Math.min(requestedScale, fittedScale));
};
