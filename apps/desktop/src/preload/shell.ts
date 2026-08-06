import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
  DESKTOP_IPC_CHANNELS,
  type DesktopApi,
  type DesktopShellState,
  isDesktopShellState,
} from "../feature/x-workspace/lib/desktop-api.js";

const desktopApi: DesktopApi = {
  getState: async () => {
    const state: unknown = await ipcRenderer.invoke(
      DESKTOP_IPC_CHANNELS.getState
    );
    if (!isDesktopShellState(state)) {
      throw new Error("The desktop process returned an invalid shell state.");
    }
    return state;
  },
  onStateChanged: (listener) => {
    const handleState = (
      _event: IpcRendererEvent,
      payload: DesktopShellState
    ): void => {
      if (isDesktopShellState(payload)) {
        listener(payload);
      }
    };
    ipcRenderer.on(DESKTOP_IPC_CHANNELS.stateChanged, handleState);
    return () =>
      ipcRenderer.removeListener(
        DESKTOP_IPC_CHANNELS.stateChanged,
        handleState
      );
  },
  platform: process.platform,
  sendCommand: (command) => {
    ipcRenderer.send(DESKTOP_IPC_CHANNELS.command, command);
  },
  setWorkspaceLayout: (layout) => {
    ipcRenderer.send(DESKTOP_IPC_CHANNELS.workspaceLayout, layout);
  },
};

contextBridge.exposeInMainWorld("betterX", desktopApi);
