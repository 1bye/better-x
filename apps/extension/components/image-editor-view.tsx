import { Button } from "@better-x/ui/components/button";
import { Elevated } from "@better-x/ui/components/elevated";
import { Kbd } from "@better-x/ui/components/kbd";
import { SurfaceProvider } from "@better-x/ui/lib/surface-context";
import {
  LiquidMenuContent,
  LiquidMenuRoot,
  LiquidMenuTrigger,
} from "@better-x/ui/liquid-menu/components/liquid-menu";
import { LiquidMenuAutoSize } from "@better-x/ui/liquid-menu/components/liquid-menu-auto-size";
import { LiquidMenuStackProvider } from "@better-x/ui/liquid-menu/components/liquid-menu-stack-provider";
import {
  createElement,
  type ReactElement,
  type RefCallback,
  useCallback,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  EDITOR_TOOLS,
  type EditorTool,
  RESIZE_HANDLES,
  type ResizeHandle,
} from "../lib/image-editor";

import "@better-x/ui/liquid.css";
import "../styles/image-editor.css";

export const EDITOR_TOOL_DETAILS: Record<
  EditorTool,
  { key: string; label: string; symbol: string }
> = {
  arrow: { key: "A", label: "Arrow", symbol: "↗" },
  blur: { key: "B", label: "Blur", symbol: "◌" },
  rectangle: { key: "R", label: "Rectangle", symbol: "□" },
  select: { key: "V", label: "Select", symbol: "↖" },
  text: { key: "T", label: "Text", symbol: "T" },
};

const INSPECTOR_ANCHOR_GEOMETRY = {
  insetBlock: 0,
  insetInline: 0,
  radius: 10,
} as const;

export interface ImageEditorElements {
  applyButton: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  closeButton: HTMLButtonElement;
  cropButton: HTMLButtonElement;
  host: HTMLElement;
  inspector: HTMLElement;
  loading: HTMLSpanElement;
  redoButton: HTMLButtonElement;
  root: Root;
  selection: HTMLElement;
  selectionHandles: ReadonlyMap<ResizeHandle, HTMLButtonElement>;
  stage: HTMLElement;
  status: HTMLSpanElement;
  toolButtons: ReadonlyMap<EditorTool, HTMLButtonElement>;
  undoButton: HTMLButtonElement;
}

const getElement = <ElementType extends Element>(
  host: HTMLElement,
  selector: string
): ElementType => {
  const element = host.querySelector<ElementType>(selector);
  if (!element) {
    throw new Error(`Image editor element is missing: ${selector}`);
  }
  return element;
};

function ToolButton({ tool }: { tool: EditorTool }): ReactElement {
  const details = EDITOR_TOOL_DETAILS[tool];
  return (
    <Button
      aria-label={details.label}
      aria-pressed={tool === "select"}
      className="better-x-image-editor__tool"
      data-tool={tool}
      size="icon"
      title={`${details.label} (${details.key})`}
      type="button"
      variant="ghost"
    >
      <span aria-hidden className="better-x-image-editor__tool-symbol">
        {details.symbol}
      </span>
      <Kbd>{details.key}</Kbd>
    </Button>
  );
}

interface ImageEditorViewProps {
  readonly inspectorRef: RefCallback<HTMLElement>;
  readonly portalContainer: HTMLElement;
}

function ImageEditorView({
  inspectorRef,
  portalContainer,
}: ImageEditorViewProps): ReactElement {
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const getInspectorAnchor = useCallback(
    (): Element | null => inspectorTriggerRef.current,
    []
  );
  const changeInspectorOpen = useCallback((isOpen: boolean): void => {
    setIsInspectorOpen(isOpen);
  }, []);

  return (
    <SurfaceProvider value={1}>
      <LiquidMenuStackProvider portalContainer={portalContainer}>
        <section
          aria-label="Better X image editor"
          aria-modal="true"
          className="better-x-image-editor__dialog"
          data-liquid-theme=""
          role="dialog"
        >
          <div className="better-x-image-editor__stage">
            <canvas
              aria-label="Editable image canvas. Select and transform objects."
              className="better-x-image-editor__canvas"
              tabIndex={0}
            />
            <div className="better-x-image-editor__selection" hidden>
              <span className="better-x-image-editor__selection-label" />
              <button
                aria-label="Rotate selected object"
                className="better-x-image-editor__rotate-handle"
                data-transform="rotate"
                type="button"
              >
                ↻
              </button>
              {RESIZE_HANDLES.map((handle) => (
                <button
                  aria-label={`Resize ${handle}`}
                  className={`better-x-image-editor__resize-handle better-x-image-editor__resize-handle--${handle}`}
                  data-handle={handle}
                  key={handle}
                  type="button"
                />
              ))}
            </div>
            <span className="better-x-image-editor__loading">
              Opening image…
            </span>
          </div>

          <Elevated
            className="better-x-image-editor__history"
            data-name="LiquidEditorHistory"
            offset={2}
            shadowLevel={5}
          >
            <Button
              aria-label="Close image editor"
              className="better-x-image-editor__close"
              size="icon-sm"
              title="Close"
              type="button"
              variant="ghost"
            >
              ×
            </Button>
            <Button
              aria-label="Undo"
              className="better-x-image-editor__undo"
              size="icon-sm"
              title="Undo"
              type="button"
              variant="ghost"
            >
              ↶
            </Button>
            <Button
              aria-label="Redo"
              className="better-x-image-editor__redo"
              size="icon-sm"
              title="Redo"
              type="button"
              variant="ghost"
            >
              ↷
            </Button>
          </Elevated>

          <Elevated
            className="better-x-image-editor__toolbar"
            data-name="LiquidEditorToolbar"
            offset={2}
            shadowLevel={5}
          >
            <nav aria-label="Image editor tools">
              {EDITOR_TOOLS.map((tool) => (
                <ToolButton key={tool} tool={tool} />
              ))}
              <Button
                aria-label="Crop selected image"
                aria-pressed="false"
                className="better-x-image-editor__tool better-x-image-editor__crop"
                size="icon"
                title="Crop selected image (C)"
                type="button"
                variant="ghost"
              >
                <span
                  aria-hidden
                  className="better-x-image-editor__tool-symbol"
                >
                  ⌗
                </span>
                <Kbd>C</Kbd>
              </Button>
            </nav>
          </Elevated>

          <Elevated
            className="better-x-image-editor__top-actions"
            data-name="LiquidEditorActions"
            offset={2}
            shadowLevel={5}
          >
            <LiquidMenuRoot
              anchor={getInspectorAnchor}
              anchorGeometry={INSPECTOR_ANCHOR_GEOMETRY}
              modal={false}
              onOpenChange={changeInspectorOpen}
              open={isInspectorOpen}
            >
              <LiquidMenuTrigger
                aria-label="Toggle object properties"
                aria-pressed={isInspectorOpen}
                className="better-x-image-editor__properties-trigger"
                data-name="Button"
                ref={inspectorTriggerRef}
              >
                <span aria-hidden>⌁</span>
                Style
              </LiquidMenuTrigger>
              <LiquidMenuContent
                align="end"
                aria-label="Object properties"
                className="better-x-image-editor__inspector-surface"
                data-liquid-theme=""
                portalKeepMounted
                sideOffset={10}
              >
                <LiquidMenuAutoSize>
                  <aside
                    className="better-x-image-editor__inspector"
                    ref={inspectorRef}
                  />
                </LiquidMenuAutoSize>
              </LiquidMenuContent>
            </LiquidMenuRoot>

            <Button
              className="better-x-image-editor__apply"
              size="sm"
              type="button"
              variant="brand"
            >
              Apply
              <Kbd>⌘↵</Kbd>
            </Button>
          </Elevated>

          <Elevated
            className="better-x-image-editor__status-surface"
            data-name="LiquidEditorStatus"
            offset={1}
            shadowLevel={3}
          >
            <span
              aria-live="polite"
              className="better-x-image-editor__status"
              role="status"
            />
          </Elevated>
        </section>
      </LiquidMenuStackProvider>
    </SurfaceProvider>
  );
}

export function mountImageEditorView(): ImageEditorElements {
  const host = document.createElement("better-x-image-editor");
  host.hidden = true;
  const mount = document.createElement("div");
  const portalContainer = document.createElement("div");
  portalContainer.className = "better-x-image-editor__portals";
  host.append(mount, portalContainer);
  document.body.append(host);
  const root = createRoot(mount);
  let inspector: HTMLElement | null = null;
  const setInspector: RefCallback<HTMLElement> = (element): void => {
    inspector = element;
  };
  flushSync(() =>
    root.render(
      createElement(ImageEditorView, {
        inspectorRef: setInspector,
        portalContainer,
      })
    )
  );
  if (!inspector) {
    throw new Error("Image editor inspector failed to mount.");
  }

  const toolButtons = new Map<EditorTool, HTMLButtonElement>();
  for (const tool of EDITOR_TOOLS) {
    toolButtons.set(tool, getElement(host, `[data-tool="${tool}"]`));
  }
  const selectionHandles = new Map<ResizeHandle, HTMLButtonElement>();
  for (const handle of RESIZE_HANDLES) {
    selectionHandles.set(handle, getElement(host, `[data-handle="${handle}"]`));
  }

  return {
    applyButton: getElement(host, ".better-x-image-editor__apply"),
    canvas: getElement(host, ".better-x-image-editor__canvas"),
    closeButton: getElement(host, ".better-x-image-editor__close"),
    cropButton: getElement(host, ".better-x-image-editor__crop"),
    host,
    inspector,
    loading: getElement(host, ".better-x-image-editor__loading"),
    redoButton: getElement(host, ".better-x-image-editor__redo"),
    root,
    selection: getElement(host, ".better-x-image-editor__selection"),
    selectionHandles,
    stage: getElement(host, ".better-x-image-editor__stage"),
    status: getElement(host, ".better-x-image-editor__status"),
    toolButtons,
    undoButton: getElement(host, ".better-x-image-editor__undo"),
  };
}
