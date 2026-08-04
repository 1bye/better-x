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

export interface WorkspaceViewLayout {
  readonly feed: ViewBounds | null;
  readonly post: ViewBounds | null;
}

const MAXIMUM_LAYOUT_VALUE = 100_000;

const clampDimension = (value: number): number =>
  Math.max(0, Math.floor(value));

const isLayoutValue = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  typeof value === "number" &&
  value >= 0 &&
  value <= MAXIMUM_LAYOUT_VALUE;

const parseViewBounds = (value: unknown): ViewBounds | null => {
  if (!(typeof value === "object" && value !== null)) {
    return null;
  }
  const bounds = value as Partial<ViewBounds>;
  if (
    !(
      isLayoutValue(bounds.height) &&
      isLayoutValue(bounds.width) &&
      isLayoutValue(bounds.x) &&
      isLayoutValue(bounds.y)
    )
  ) {
    return null;
  }
  return {
    height: bounds.height,
    width: bounds.width,
    x: bounds.x,
    y: bounds.y,
  };
};

export const parseWorkspaceViewLayout = (
  value: unknown
): WorkspaceViewLayout | null => {
  if (!(typeof value === "object" && value !== null)) {
    return null;
  }
  const layout = value as Partial<WorkspaceViewLayout>;
  const feed = layout.feed === null ? null : parseViewBounds(layout.feed);
  const post = layout.post === null ? null : parseViewBounds(layout.post);
  if (
    (layout.feed !== null && feed === null) ||
    (layout.post !== null && post === null)
  ) {
    return null;
  }
  return { feed, post };
};

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
  const feed: ViewBounds = {
    height: innerHeight,
    width: feedWidth,
    x,
    y,
  };
  const post: ViewBounds = {
    height: innerHeight,
    width: postWidth,
    x: x + feedWidth + paneGap,
    y,
  };

  return { feed, post };
};
