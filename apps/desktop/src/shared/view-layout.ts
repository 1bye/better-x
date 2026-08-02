export const DESKTOP_GEOMETRY = {
  contentBorderWidth: 1,
  contentInset: 6,
  paneGap: 6,
  paneRadius: 12,
  postPaneRatio: 0.46,
  titlebarHeight: 46,
  workspaceRadius: 14,
} as const;

export interface ViewBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface DesktopViewLayout {
  readonly feed: ViewBounds;
  readonly post: ViewBounds | null;
}

const clampDimension = (value: number): number =>
  Math.max(0, Math.floor(value));

export const calculateDesktopViewLayout = (
  width: number,
  height: number,
  mode: "login" | "workspace"
): DesktopViewLayout => {
  const { contentBorderWidth, contentInset, paneGap, postPaneRatio } =
    DESKTOP_GEOMETRY;
  const x = contentInset + contentBorderWidth;
  const y =
    DESKTOP_GEOMETRY.titlebarHeight + DESKTOP_GEOMETRY.contentBorderWidth;
  const innerWidth = clampDimension(
    width - (contentInset + contentBorderWidth) * 2
  );
  const innerHeight = clampDimension(
    height -
      DESKTOP_GEOMETRY.titlebarHeight -
      contentInset -
      contentBorderWidth * 2
  );
  const fullBounds: ViewBounds = {
    height: innerHeight,
    width: innerWidth,
    x,
    y,
  };

  if (mode === "login") {
    return { feed: fullBounds, post: null };
  }

  const availableWidth = clampDimension(innerWidth - paneGap);
  const postWidth = Math.round(availableWidth * postPaneRatio);
  const feedWidth = clampDimension(availableWidth - postWidth);
  const post: ViewBounds = {
    height: innerHeight,
    width: postWidth,
    x,
    y,
  };
  const feed: ViewBounds = {
    height: innerHeight,
    width: feedWidth,
    x: x + postWidth + paneGap,
    y,
  };

  return { feed, post };
};
