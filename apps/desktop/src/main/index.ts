import { join } from "node:path";
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  ipcMain,
  nativeTheme,
  session,
  shell,
} from "electron";
import {
  DESKTOP_IPC_CHANNELS,
  type DesktopShellState,
  INITIAL_DESKTOP_STATE,
  isDesktopCommand,
} from "../shared/desktop-api.js";
import { parseXFeedSelection } from "../shared/x-post.js";
import { XWorkspace } from "./x-workspace.js";

const MAIN_WINDOW_WIDTH = 1400;
const MAIN_WINDOW_HEIGHT = 900;
const MINIMUM_WINDOW_WIDTH = 980;
const MINIMUM_WINDOW_HEIGHT = 640;
const MACOS_TRAFFIC_LIGHT_X = 16;
const MACOS_TRAFFIC_LIGHT_Y = 17;
const X_SESSION_PARTITION = "persist:better-x";

let mainWindow: BrowserWindow | null = null;
let workspace: XWorkspace | null = null;

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const platformWindowOptions = (): BrowserWindowConstructorOptions => {
  if (process.platform !== "darwin") {
    return {};
  }
  return {
    titleBarStyle: "hiddenInset",
    trafficLightPosition: {
      x: MACOS_TRAFFIC_LIGHT_X,
      y: MACOS_TRAFFIC_LIGHT_Y,
    },
    vibrancy: "sidebar",
    visualEffectState: "active",
  };
};

const publishState = (state: DesktopShellState): void => {
  const webContents = mainWindow?.webContents;
  if (webContents && !webContents.isDestroyed()) {
    webContents.send(DESKTOP_IPC_CHANNELS.stateChanged, state);
  }
};

const secureShellNavigation = (window: BrowserWindow): void => {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      shell.openExternal(url).catch((error: unknown) => {
        process.stderr.write(
          `Could not open external URL: ${failureMessage(error)}\n`
        );
      });
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
};

const loadRenderer = async (window: BrowserWindow): Promise<void> => {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) {
    await window.loadURL(developmentUrl);
    return;
  }
  await window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
};

const configureXSession = (): Electron.Session => {
  const xSession = session.fromPartition(X_SESSION_PARTITION);
  xSession.setPermissionCheckHandler(() => false);
  xSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    }
  );
  return xSession;
};

const createMainWindow = async (): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    ...platformWindowOptions(),
    backgroundColor: "#00000000",
    height: MAIN_WINDOW_HEIGHT,
    minHeight: MINIMUM_WINDOW_HEIGHT,
    minWidth: MINIMUM_WINDOW_WIDTH,
    show: false,
    title: "Better X",
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, "../preload/shell.js"),
      sandbox: true,
    },
    width: MAIN_WINDOW_WIDTH,
  });
  mainWindow = window;
  secureShellNavigation(window);

  const nextWorkspace = new XWorkspace({
    onStateChanged: publishState,
    session: configureXSession(),
    window,
  });
  workspace = nextWorkspace;
  window.on("resize", () => nextWorkspace.layout());
  window.once("closed", () => {
    nextWorkspace.destroy();
    if (workspace === nextWorkspace) {
      workspace = null;
    }
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  window.once("ready-to-show", () => window.show());

  await loadRenderer(window);
  try {
    await nextWorkspace.start();
  } catch (error: unknown) {
    publishState({
      message: `Could not start X: ${failureMessage(error)}`,
      mode: "error",
      postStatus: "error",
      selectedPostUrl: null,
    });
  }
  return window;
};

const registerIpc = (): void => {
  ipcMain.handle(DESKTOP_IPC_CHANNELS.getState, (event) => {
    if (event.sender !== mainWindow?.webContents) {
      return INITIAL_DESKTOP_STATE;
    }
    return workspace?.getState() ?? INITIAL_DESKTOP_STATE;
  });
  ipcMain.on(DESKTOP_IPC_CHANNELS.command, (event, payload: unknown) => {
    if (
      event.sender !== mainWindow?.webContents ||
      !isDesktopCommand(payload)
    ) {
      return;
    }
    workspace?.runCommand(payload).catch((error: unknown) => {
      process.stderr.write(
        `Desktop command failed: ${failureMessage(error)}\n`
      );
    });
  });
  ipcMain.on(DESKTOP_IPC_CHANNELS.feedSelection, (event, payload: unknown) => {
    const activeWorkspace = workspace;
    if (!activeWorkspace?.isTimelineSender(event.sender)) {
      return;
    }
    const selection = parseXFeedSelection(payload);
    if (!selection) {
      return;
    }
    activeWorkspace.selectPost(selection).catch((error: unknown) => {
      process.stderr.write(`Post selection failed: ${failureMessage(error)}\n`);
    });
  });
};

const start = async (): Promise<void> => {
  app.setName("Better X");
  nativeTheme.themeSource = "light";
  await app.whenReady();
  registerIpc();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow().catch((error: unknown) => {
        process.stderr.write(
          `Could not recreate desktop window: ${failureMessage(error)}\n`
        );
      });
    }
  });
};

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  workspace?.destroy();
  ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.getState);
  ipcMain.removeAllListeners(DESKTOP_IPC_CHANNELS.command);
  ipcMain.removeAllListeners(DESKTOP_IPC_CHANNELS.feedSelection);
});

start().catch((error: unknown) => {
  const failure =
    error instanceof Error
      ? error
      : new Error(`Desktop startup failed: ${error}`);
  process.stderr.write(`${failure.stack ?? failure.message}\n`);
  app.quit();
});
