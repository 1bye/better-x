import { join } from "node:path";
import {
  type BrowserWindow,
  type Session,
  shell,
  type WebContents,
  WebContentsView,
} from "electron";
import {
  type DesktopCommand,
  type DesktopShellState,
  INITIAL_DESKTOP_STATE,
} from "../shared/desktop-api.js";
import {
  calculateDesktopViewLayout,
  DESKTOP_GEOMETRY,
  type ViewBounds,
  type WorkspaceViewLayout,
} from "../shared/view-layout.js";
import {
  isAllowedXNavigation,
  normalizeXPostUrl,
  type XFeedSelection,
} from "../shared/x-post.js";
import { PostViewPool, type PostViewPoolStatus } from "./post-view-pool.js";

const HOME_URL = "https://x.com/home";
const POST_VIEW_CAPACITY = 3;
const ABORTED_NAVIGATION_ERROR_CODE = -3;
const LOGIN_PATH_PREFIXES = ["/i/flow/login", "/login"] as const;
const FEED_PRESENTATION_CSS = `
  [data-testid="sidebarColumn"] {
    display: none !important;
  }
`;
const POST_PRESENTATION_CSS = `
  header[role="banner"],
  [data-testid="sidebarColumn"] {
    display: none !important;
  }

  main {
    width: 100% !important;
    max-width: none !important;
  }

  [data-testid="primaryColumn"] {
    width: 100% !important;
    max-width: 720px !important;
    margin-inline: auto !important;
  }
`;

interface XWorkspaceOptions {
  readonly onStateChanged: (state: DesktopShellState) => void;
  readonly session: Session;
  readonly window: BrowserWindow;
}

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const fitBoundsToWindow = (
  bounds: ViewBounds,
  width: number,
  height: number
): ViewBounds | null => {
  const x = Math.min(bounds.x, width);
  const y = Math.min(bounds.y, height);
  const right = Math.min(bounds.x + bounds.width, width);
  const bottom = Math.min(bounds.y + bounds.height, height);
  const fittedWidth = Math.max(0, right - x);
  const fittedHeight = Math.max(0, bottom - y);
  if (fittedWidth === 0 || fittedHeight === 0) {
    return null;
  }
  return { height: fittedHeight, width: fittedWidth, x, y };
};

const openExternal = (url: string): void => {
  if (!url.startsWith("https://")) {
    return;
  }
  shell.openExternal(url).catch((error: unknown) => {
    process.stderr.write(
      `Could not open external URL: ${failureMessage(error)}\n`
    );
  });
};

export class XWorkspace {
  private readonly onStateChanged: (state: DesktopShellState) => void;
  private readonly postViewPool: PostViewPool;
  private rendererLayout: WorkspaceViewLayout | null = null;
  private state: DesktopShellState = { ...INITIAL_DESKTOP_STATE };
  private readonly timelineView: WebContentsView;
  private readonly window: BrowserWindow;

  constructor({ onStateChanged, session, window }: XWorkspaceOptions) {
    this.onStateChanged = onStateChanged;
    this.window = window;
    this.timelineView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(import.meta.dirname, "../preload/x-feed.js"),
        sandbox: true,
        session,
        spellcheck: false,
      },
    });
    this.prepareView(this.timelineView, FEED_PRESENTATION_CSS);
    window.contentView.addChildView(this.timelineView);

    this.postViewPool = new PostViewPool({
      capacity: POST_VIEW_CAPACITY,
      createView: () => {
        const view = new WebContentsView({
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            session,
            spellcheck: false,
          },
        });
        this.prepareView(view, POST_PRESENTATION_CSS);
        view.webContents.on("did-navigate", (_event, url) => {
          this.postViewPool.handleNavigation(view, normalizeXPostUrl(url));
        });
        view.webContents.on(
          "did-navigate-in-page",
          (_event, url, isMainFrame) => {
            if (isMainFrame) {
              this.postViewPool.handleNavigation(view, normalizeXPostUrl(url));
            }
          }
        );
        window.contentView.addChildView(view);
        return view;
      },
      onStatusChanged: (status) => {
        this.updatePostStatus(status);
      },
    });

    this.timelineView.webContents.on("did-navigate", (_event, url) => {
      this.updateModeFromUrl(url);
    });
    this.timelineView.webContents.on(
      "did-navigate-in-page",
      (_event, url, isMainFrame) => {
        if (isMainFrame) {
          this.updateModeFromUrl(url);
        }
      }
    );
    this.timelineView.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
        if (
          isMainFrame &&
          errorCode !== ABORTED_NAVIGATION_ERROR_CODE &&
          !this.timelineView.webContents.isDestroyed()
        ) {
          this.setState({
            message: `X failed to load: ${errorDescription}`,
            mode: "error",
          });
          this.layout();
        }
      }
    );
  }

  destroy(): void {
    if (this.timelineView.webContents.isDestroyed()) {
      return;
    }
    this.postViewPool.destroy();
    if (!this.timelineView.webContents.isDestroyed()) {
      this.timelineView.webContents.close();
    }
  }

  getState(): DesktopShellState {
    return { ...this.state };
  }

  isTimelineSender(sender: WebContents): boolean {
    return sender === this.timelineView.webContents;
  }

  layout(): void {
    if (
      this.window.isDestroyed() ||
      this.timelineView.webContents.isDestroyed()
    ) {
      return;
    }
    const [width = 0, height = 0] = this.window.getContentSize();
    const isWorkspace = this.state.mode === "workspace";
    const fallbackLayout = calculateDesktopViewLayout(
      width,
      height,
      isWorkspace ? "workspace" : "login"
    );
    const layout =
      isWorkspace && this.rendererLayout ? this.rendererLayout : fallbackLayout;
    const feedBounds = layout.feed
      ? fitBoundsToWindow(layout.feed, width, height)
      : null;
    const postBounds = layout.post
      ? fitBoundsToWindow(layout.post, width, height)
      : null;

    if (feedBounds) {
      this.timelineView.setBounds(feedBounds);
      this.timelineView.setBorderRadius(DESKTOP_GEOMETRY.paneRadius);
      this.timelineView.setVisible(true);
    } else {
      this.timelineView.setVisible(false);
    }

    if (postBounds) {
      this.postViewPool.setBounds(postBounds);
      this.postViewPool.setSurfaceVisible(true);
    } else {
      this.postViewPool.setSurfaceVisible(false);
    }
  }

  async runCommand(command: DesktopCommand): Promise<void> {
    if (this.timelineView.webContents.isDestroyed()) {
      return;
    }
    if (command === "reload") {
      this.timelineView.webContents.reload();
      return;
    }

    this.setState({
      message: null,
      mode: "starting",
      postStatus: "idle",
      selectedPostUrl: null,
    });
    this.postViewPool.hide();
    this.layout();
    await this.timelineView.webContents.loadURL(HOME_URL);
  }

  async selectPost(selection: XFeedSelection): Promise<void> {
    if (
      this.timelineView.webContents.isDestroyed() ||
      this.state.mode !== "workspace"
    ) {
      return;
    }
    await this.postViewPool.select(selection);
  }

  setWorkspaceLayout(layout: WorkspaceViewLayout): void {
    this.rendererLayout = {
      feed: layout.feed ? { ...layout.feed } : null,
      post: layout.post ? { ...layout.post } : null,
    };
    if (this.state.mode === "workspace") {
      this.layout();
    }
  }

  async start(): Promise<void> {
    this.layout();
    await this.timelineView.webContents.loadURL(HOME_URL);
    this.updateModeFromUrl(this.timelineView.webContents.getURL());
  }

  private prepareView(view: WebContentsView, presentationCss: string): void {
    view.setBackgroundColor("#ffffff");
    view.setBorderRadius(DESKTOP_GEOMETRY.paneRadius);
    const { webContents } = view;

    webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedXNavigation(url)) {
        webContents.loadURL(url).catch((error: unknown) => {
          process.stderr.write(
            `Could not open X navigation: ${failureMessage(error)}\n`
          );
        });
      } else {
        openExternal(url);
      }
      return { action: "deny" };
    });
    webContents.on("will-navigate", (event) => {
      if (event.isMainFrame && !isAllowedXNavigation(event.url)) {
        event.preventDefault();
        openExternal(event.url);
      }
    });
    webContents.on("did-finish-load", () => {
      webContents.insertCSS(presentationCss).catch((error: unknown) => {
        process.stderr.write(
          `Could not apply X presentation styles: ${failureMessage(error)}\n`
        );
      });
    });
  }

  private setState(patch: Partial<DesktopShellState>): void {
    const nextState = { ...this.state, ...patch };
    if (
      nextState.message === this.state.message &&
      nextState.mode === this.state.mode &&
      nextState.postStatus === this.state.postStatus &&
      nextState.selectedPostUrl === this.state.selectedPostUrl
    ) {
      return;
    }
    this.state = nextState;
    this.onStateChanged(this.getState());
  }

  private updateModeFromUrl(value: string): void {
    if (!isAllowedXNavigation(value)) {
      return;
    }
    const url = new URL(value);
    const isLogin = LOGIN_PATH_PREFIXES.some((prefix) =>
      url.pathname.startsWith(prefix)
    );
    const mode = isLogin ? "login" : "workspace";
    if (mode === "login") {
      this.postViewPool.hide();
    }
    this.setState({
      message: null,
      mode,
      postStatus: mode === "login" ? "idle" : this.state.postStatus,
      selectedPostUrl: mode === "login" ? null : this.state.selectedPostUrl,
    });
    this.layout();
  }

  private updatePostStatus(status: PostViewPoolStatus): void {
    this.setState({
      message: status.message,
      postStatus: status.status,
      selectedPostUrl: status.url,
    });
  }
}
