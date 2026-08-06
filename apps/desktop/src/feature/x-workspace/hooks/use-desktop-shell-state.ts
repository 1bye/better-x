import { useEffect, useState } from "react";
import {
  type DesktopShellState,
  INITIAL_SHELL_STATE,
} from "../lib/desktop-api.js";

const CONNECTION_ERROR_STATE: DesktopShellState = {
  message: "Could not connect to the desktop process.",
  mode: "error",
  postStatus: "error",
  selectedPostUrl: null,
};

export const useDesktopShellState = (): DesktopShellState => {
  const [state, setState] = useState<DesktopShellState>(INITIAL_SHELL_STATE);

  useEffect(() => {
    let isActive = true;
    const loadInitialState = async (): Promise<void> => {
      const initialState = await window.betterX.getState();
      if (isActive) {
        setState(initialState);
      }
    };
    const unsubscribe = window.betterX.onStateChanged(setState);
    loadInitialState().catch(() => {
      if (isActive) {
        setState(CONNECTION_ERROR_STATE);
      }
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  return state;
};
