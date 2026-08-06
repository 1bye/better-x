import type { WorkspaceViewLayout } from "./view-layout.js";

export const DESKTOP_IPC_CHANNELS = {
  command: "better-x:command",
  feedSelection: "better-x:feed-selection",
  getState: "better-x:get-state",
  stateChanged: "better-x:state-changed",
  workspaceLayout: "better-x:workspace-layout",
} as const;

export type DesktopCommand = "home" | "reload";
export type PostSurfaceStatus = "error" | "idle" | "loading" | "ready";
export type WorkspaceMode = "error" | "login" | "starting" | "workspace";

export interface DesktopShellState {
  readonly message: string | null;
  readonly mode: WorkspaceMode;
  readonly postStatus: PostSurfaceStatus;
  readonly selectedPostUrl: string | null;
}

export interface DesktopApi {
  readonly getState: () => Promise<DesktopShellState>;
  readonly onStateChanged: (
    listener: (state: DesktopShellState) => void
  ) => () => void;
  readonly platform: NodeJS.Platform;
  readonly sendCommand: (command: DesktopCommand) => void;
  readonly setWorkspaceLayout: (layout: WorkspaceViewLayout) => void;
}

export const INITIAL_SHELL_STATE: DesktopShellState = {
  message: null,
  mode: "starting",
  postStatus: "idle",
  selectedPostUrl: null,
};

export const isDesktopCommand = (value: unknown): value is DesktopCommand =>
  value === "home" || value === "reload";

export const isDesktopShellState = (
  value: unknown
): value is DesktopShellState => {
  if (!(typeof value === "object" && value !== null)) {
    return false;
  }
  const candidate = value as Partial<DesktopShellState>;
  return (
    (candidate.message === null || typeof candidate.message === "string") &&
    (candidate.mode === "error" ||
      candidate.mode === "login" ||
      candidate.mode === "starting" ||
      candidate.mode === "workspace") &&
    (candidate.postStatus === "error" ||
      candidate.postStatus === "idle" ||
      candidate.postStatus === "loading" ||
      candidate.postStatus === "ready") &&
    (candidate.selectedPostUrl === null ||
      typeof candidate.selectedPostUrl === "string")
  );
};
