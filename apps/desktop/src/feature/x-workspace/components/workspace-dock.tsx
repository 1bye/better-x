import { ArticleIcon } from "@phosphor-icons/react/dist/csr/Article";
import { ListDashesIcon } from "@phosphor-icons/react/dist/csr/ListDashes";
import { XLogoIcon } from "@phosphor-icons/react/dist/csr/XLogo";
import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react";
import {
  createContext,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import {
  type DesktopShellState,
  INITIAL_SHELL_STATE,
} from "../lib/desktop-api.js";
import type { ViewBounds, WorkspaceViewLayout } from "../lib/view-layout.js";

const FEED_PANEL_ID = "timeline";
const POST_PANEL_ID = "post";
const PANEL_COMPONENT = "native-surface";
const TAB_COMPONENT = "surface-tab";
const LAYOUT_STORAGE_KEY = "better-x:workspace-layout:v1";
const LAYOUT_STORAGE_VERSION = 1;
const MINIMUM_PANEL_HEIGHT = 180;
const MINIMUM_PANEL_WIDTH = 280;
const POST_PANEL_RATIO = 0.46;
const LAYOUT_SAVE_DELAY_MS = 160;
const EMPTY_VIEW_LAYOUT: WorkspaceViewLayout = {
  feed: null,
  post: null,
};
const PANEL_IDS = new Set([FEED_PANEL_ID, POST_PANEL_ID]);

type NativeSurface = "feed" | "post";

interface WorkspaceDockProps {
  readonly resetVersion: number;
  readonly state: DesktopShellState;
}

interface Disposable {
  dispose: () => void;
}

interface SurfacePanelParameters {
  readonly surface: NativeSurface;
}

interface StoredWorkspaceLayout {
  readonly layout: SerializedDockview;
  readonly version: number;
}

const WorkspaceStateContext =
  createContext<DesktopShellState>(INITIAL_SHELL_STATE);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const surfaceFromParameters = (value: unknown): NativeSurface => {
  if (isRecord(value) && value.surface === "post") {
    return "post";
  }
  return "feed";
};

const isEmptyOptionalArray = (value: unknown): boolean =>
  value === undefined || (Array.isArray(value) && value.length === 0);

const isSurfacePanelState = (value: unknown, surface: NativeSurface): boolean =>
  isRecord(value) &&
  value.contentComponent === PANEL_COMPONENT &&
  value.tabComponent === TAB_COMPONENT &&
  isRecord(value.params) &&
  value.params.surface === surface;

const isSerializedWorkspaceLayout = (
  value: unknown
): value is SerializedDockview => {
  if (!(isRecord(value) && isRecord(value.grid) && isRecord(value.panels))) {
    return false;
  }
  const panelIds = Object.keys(value.panels);
  if (
    panelIds.length !== PANEL_IDS.size ||
    panelIds.some((panelId) => !PANEL_IDS.has(panelId))
  ) {
    return false;
  }
  return (
    isSurfacePanelState(value.panels[FEED_PANEL_ID], "feed") &&
    isSurfacePanelState(value.panels[POST_PANEL_ID], "post") &&
    isEmptyOptionalArray(value.floatingGroups) &&
    isEmptyOptionalArray(value.popoutGroups) &&
    value.edgeGroups === undefined
  );
};

const readStoredLayout = (): SerializedDockview | null => {
  const serialized = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
  if (!serialized) {
    return null;
  }
  try {
    const stored: unknown = JSON.parse(serialized);
    if (
      isRecord(stored) &&
      stored.version === LAYOUT_STORAGE_VERSION &&
      isSerializedWorkspaceLayout(stored.layout)
    ) {
      return stored.layout;
    }
  } catch {
    window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
    return null;
  }
  window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
  return null;
};

const createPanelParameters = (
  surface: NativeSurface
): SurfacePanelParameters => ({ surface });

const createDefaultLayout = (api: DockviewApi): void => {
  api.clear();
  const feedPanel = api.addPanel<SurfacePanelParameters>({
    component: PANEL_COMPONENT,
    id: FEED_PANEL_ID,
    initialWidth: Math.round(api.width * (1 - POST_PANEL_RATIO)),
    minimumHeight: MINIMUM_PANEL_HEIGHT,
    minimumWidth: MINIMUM_PANEL_WIDTH,
    params: createPanelParameters("feed"),
    renderer: "onlyWhenVisible",
    tabComponent: TAB_COMPONENT,
    title: "Timeline",
  });
  api.addPanel<SurfacePanelParameters>({
    component: PANEL_COMPONENT,
    id: POST_PANEL_ID,
    initialWidth: Math.round(api.width * POST_PANEL_RATIO),
    minimumHeight: MINIMUM_PANEL_HEIGHT,
    minimumWidth: MINIMUM_PANEL_WIDTH,
    params: createPanelParameters("post"),
    position: {
      direction: "right",
      referencePanel: feedPanel,
    },
    renderer: "onlyWhenVisible",
    tabComponent: TAB_COMPONENT,
    title: "Post",
  });
};

const restoreLayout = (api: DockviewApi): boolean => {
  const storedLayout = readStoredLayout();
  if (!storedLayout) {
    return false;
  }
  try {
    api.fromJSON(storedLayout);
  } catch {
    return false;
  }
  return (
    api.totalPanels === PANEL_IDS.size &&
    api.getPanel(FEED_PANEL_ID) !== undefined &&
    api.getPanel(POST_PANEL_ID) !== undefined
  );
};

const boundsFromElement = (element: HTMLElement | null): ViewBounds | null => {
  if (!element || element.getClientRects().length === 0) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    return null;
  }
  const x = Math.max(0, Math.round(rect.left));
  const y = Math.max(0, Math.round(rect.top));
  return {
    height: Math.max(0, Math.round(rect.bottom) - y),
    width: Math.max(0, Math.round(rect.right) - x),
    x,
    y,
  };
};

const areBoundsEqual = (
  left: ViewBounds | null,
  right: ViewBounds | null
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.height === right.height &&
    left.width === right.width &&
    left.x === right.x &&
    left.y === right.y);

const areLayoutsEqual = (
  left: WorkspaceViewLayout | null,
  right: WorkspaceViewLayout
): boolean =>
  left !== null &&
  areBoundsEqual(left.feed, right.feed) &&
  areBoundsEqual(left.post, right.post);

const placeholderTitle = (
  surface: NativeSurface,
  state: DesktopShellState
): string => {
  if (surface === "feed") {
    return "Timeline";
  }
  if (state.postStatus === "loading") {
    return "Loading post…";
  }
  if (state.postStatus === "ready") {
    return "Post ready";
  }
  return "Point at a post";
};

const placeholderDescription = (
  surface: NativeSurface,
  state: DesktopShellState
): string => {
  if (surface === "feed") {
    return "Drag this tab to place the timeline beside or above another tile.";
  }
  if (state.postStatus === "error") {
    return state.message ?? "This post could not be opened.";
  }
  return "Pause over a post. Nearby conversations stay warm for fast switching.";
};

function NativeSurfacePanel({ params }: IDockviewPanelProps): ReactElement {
  const state = useContext(WorkspaceStateContext);
  const surface = surfaceFromParameters(params);
  const isPost = surface === "post";
  const isPostLoading = state.postStatus === "loading";

  return (
    <section
      aria-busy={isPost ? isPostLoading : undefined}
      aria-label={isPost ? "Selected X post" : "X timeline"}
      className="native-surface"
      data-native-surface={surface}
      data-status={isPost ? state.postStatus : undefined}
    >
      <div className="native-surface-placeholder">
        <div aria-hidden className="placeholder-mark">
          <XLogoIcon className="size-5" weight="bold" />
        </div>
        <h1>{placeholderTitle(surface, state)}</h1>
        <p>{placeholderDescription(surface, state)}</p>
      </div>
    </section>
  );
}

function SurfaceTab({ api, params }: IDockviewPanelHeaderProps): ReactElement {
  const surface = surfaceFromParameters(params);
  const label = api.title ?? (surface === "feed" ? "Timeline" : "Post");
  const Icon = surface === "feed" ? ListDashesIcon : ArticleIcon;

  return (
    <span className="workspace-tile-tab" data-surface={surface}>
      <Icon aria-hidden className="size-3.5" weight="bold" />
      <span>{label}</span>
    </span>
  );
}

function WorkspaceWatermark(): ReactElement {
  return (
    <div className="workspace-watermark">
      <XLogoIcon aria-hidden className="size-5" weight="bold" />
      <span>Reset the layout to restore your X tiles.</span>
    </div>
  );
}

const DOCK_COMPONENTS = {
  [PANEL_COMPONENT]: NativeSurfacePanel,
};

const TAB_COMPONENTS = {
  [TAB_COMPONENT]: SurfaceTab,
};

export function WorkspaceDock({
  resetVersion,
  state,
}: WorkspaceDockProps): ReactElement {
  const apiRef = useRef<DockviewApi | null>(null);
  const disposablesRef = useRef<Disposable[]>([]);
  const isDockingRef = useRef(false);
  const lastPublishedLayoutRef = useRef<WorkspaceViewLayout | null>(null);
  const lastResetVersionRef = useRef(resetVersion);
  const measureFrameRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const publishLayout = useCallback((layout: WorkspaceViewLayout): void => {
    if (areLayoutsEqual(lastPublishedLayoutRef.current, layout)) {
      return;
    }
    lastPublishedLayoutRef.current = layout;
    window.betterX.setWorkspaceLayout(layout);
  }, []);

  const measureAndPublish = useCallback((): void => {
    if (isDockingRef.current) {
      return;
    }
    const root = rootRef.current;
    const feedElement =
      root?.querySelector<HTMLElement>('[data-native-surface="feed"]') ?? null;
    const postElement =
      root?.querySelector<HTMLElement>('[data-native-surface="post"]') ?? null;
    if (!(feedElement || postElement)) {
      return;
    }
    const feed = boundsFromElement(feedElement);
    const post = boundsFromElement(postElement);
    publishLayout({ feed, post });
  }, [publishLayout]);

  const scheduleMeasure = useCallback((): void => {
    if (measureFrameRef.current !== null) {
      window.cancelAnimationFrame(measureFrameRef.current);
    }
    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = null;
      measureAndPublish();
    });
  }, [measureAndPublish]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const mutationObserver = new MutationObserver(scheduleMeasure);
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    mutationObserver.observe(root, {
      childList: true,
      subtree: true,
    });
    resizeObserver.observe(root);
    scheduleMeasure();

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [scheduleMeasure]);

  const scheduleSave = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const api = apiRef.current;
      if (!api) {
        return;
      }
      const stored: StoredWorkspaceLayout = {
        layout: api.toJSON(),
        version: LAYOUT_STORAGE_VERSION,
      };
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(stored));
    }, LAYOUT_SAVE_DELAY_MS);
  }, []);

  const finishDocking = useCallback((): void => {
    if (!isDockingRef.current) {
      return;
    }
    isDockingRef.current = false;
    rootRef.current?.removeAttribute("data-docking");
    scheduleMeasure();
    scheduleSave();
  }, [scheduleMeasure, scheduleSave]);

  const beginDocking = useCallback((): void => {
    isDockingRef.current = true;
    rootRef.current?.setAttribute("data-docking", "true");
    publishLayout(EMPTY_VIEW_LAYOUT);
  }, [publishLayout]);

  const handleReady = useCallback(
    ({ api }: DockviewReadyEvent): void => {
      for (const disposable of disposablesRef.current) {
        disposable.dispose();
      }
      apiRef.current = api;
      if (!restoreLayout(api)) {
        createDefaultLayout(api);
      }
      disposablesRef.current = [
        api.onDidLayoutChange(() => {
          scheduleMeasure();
          scheduleSave();
        }),
        api.onDidActivePanelChange(scheduleMeasure),
        api.onWillDragGroup(beginDocking),
        api.onWillDragPanel(beginDocking),
      ];
      scheduleMeasure();
      scheduleSave();
    },
    [beginDocking, scheduleMeasure, scheduleSave]
  );

  useEffect(() => {
    const handlePointerEnd = (): void => {
      finishDocking();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        finishDocking();
      }
    };
    document.addEventListener("pointerup", handlePointerEnd, true);
    document.addEventListener("pointercancel", handlePointerEnd, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handlePointerEnd);

    return () => {
      document.removeEventListener("pointerup", handlePointerEnd, true);
      document.removeEventListener("pointercancel", handlePointerEnd, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", handlePointerEnd);
    };
  }, [finishDocking]);

  useEffect(() => {
    if (lastResetVersionRef.current === resetVersion) {
      return;
    }
    lastResetVersionRef.current = resetVersion;
    const api = apiRef.current;
    if (!api) {
      return;
    }
    beginDocking();
    createDefaultLayout(api);
    finishDocking();
  }, [beginDocking, finishDocking, resetVersion]);

  useEffect(
    () => () => {
      for (const disposable of disposablesRef.current) {
        disposable.dispose();
      }
      if (measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current);
      }
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    },
    []
  );

  return (
    <WorkspaceStateContext.Provider value={state}>
      <div
        className="workspace-dock dockview-theme-light-spaced"
        data-name="WorkspaceDock"
        ref={rootRef}
      >
        <DockviewReact
          components={DOCK_COMPONENTS}
          disableFloatingGroups
          dndStrategy="pointer"
          keyboardNavigation
          noPanelsOverlay="watermark"
          onDidDrop={finishDocking}
          onReady={handleReady}
          tabComponents={TAB_COMPONENTS}
          tabGroupAccent="off"
          watermarkComponent={WorkspaceWatermark}
        />
      </div>
    </WorkspaceStateContext.Provider>
  );
}
