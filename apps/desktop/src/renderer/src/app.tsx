import { Button } from "@better-x/ui/components/button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { XLogoIcon } from "@phosphor-icons/react/dist/csr/XLogo";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import {
  type DesktopShellState,
  INITIAL_DESKTOP_STATE,
} from "../../shared/desktop-api.js";
import { WorkspaceDock } from "./workspace-dock.js";

const statusLabel = (state: DesktopShellState): string => {
  if (state.mode === "error") {
    return "X unavailable";
  }
  if (state.mode === "login") {
    return "Sign in to X";
  }
  if (state.mode === "starting") {
    return "Opening X";
  }
  if (state.postStatus === "loading") {
    return "Loading post";
  }
  if (state.postStatus === "ready") {
    return "Post ready";
  }
  if (state.postStatus === "error") {
    return "Post unavailable";
  }
  return "Point at a post";
};

export function App(): ReactElement {
  const [layoutResetVersion, setLayoutResetVersion] = useState(0);
  const [state, setState] = useState<DesktopShellState>(INITIAL_DESKTOP_STATE);

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
        setState({
          message: "Could not connect to the desktop process.",
          mode: "error",
          postStatus: "error",
          selectedPostUrl: null,
        });
      }
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  const openHome = (): void => {
    window.betterX.sendCommand("home");
  };
  const reload = (): void => {
    window.betterX.sendCommand("reload");
  };
  const resetLayout = (): void => {
    setLayoutResetVersion((version) => version + 1);
  };
  const isWorkspace = state.mode === "workspace";

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden text-editor-ink"
      data-name="App"
    >
      <header
        className="relative z-40 flex h-[46px] shrink-0 items-center pr-3 pl-20"
        data-desktop-drag
        data-name="DesktopToolbar"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <XLogoIcon
            aria-hidden
            className="size-4 shrink-0 text-editor-muted"
            weight="bold"
          />
          <span className="truncate font-medium text-[13px] text-editor-ink">
            Better X
          </span>
          <span
            className="ml-1 inline-flex items-center gap-1.5 text-editor-faint text-xss"
            data-mode={state.mode}
            data-name="WorkspaceStatus"
          >
            <span aria-hidden className="status-dot size-1.5 rounded-full" />
            {statusLabel(state)}
          </span>
        </div>

        <div
          className="ml-auto flex items-center gap-0.5"
          data-desktop-interactive
        >
          <Button
            aria-label="Open X home"
            onClick={openHome}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <HouseIcon aria-hidden className="size-3.5" weight="bold" />
          </Button>
          <Button
            aria-label="Reload X"
            onClick={reload}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ArrowClockwiseIcon
              aria-hidden
              className="size-3.5"
              weight="bold"
            />
          </Button>
          <Button
            aria-label="Reset tile layout"
            disabled={!isWorkspace}
            onClick={resetLayout}
            size="icon-sm"
            title="Reset tile layout"
            type="button"
            variant="ghost"
          >
            <SquaresFourIcon aria-hidden className="size-3.5" weight="bold" />
          </Button>
        </div>
      </header>

      <main
        className="workspace-surface relative min-h-0 flex-1"
        data-mode={state.mode}
        data-name="XWorkspace"
      >
        {isWorkspace ? (
          <WorkspaceDock resetVersion={layoutResetVersion} state={state} />
        ) : (
          <section
            aria-live="polite"
            className="startup-placeholder"
            data-name="StartupPlaceholder"
          >
            {state.mode === "error" ? (
              <>
                <h1>Could not open X</h1>
                <p>{state.message ?? "Reload to try again."}</p>
              </>
            ) : (
              <>
                <span aria-hidden className="loading-ring" />
                <h1>{state.mode === "login" ? "Sign in to X" : "Opening X"}</h1>
                <p>
                  {state.mode === "login"
                    ? "Your session stays in this app and is shared by the post views."
                    : "Preparing your timeline…"}
                </p>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
