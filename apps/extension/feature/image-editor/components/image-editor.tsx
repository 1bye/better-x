// biome-ignore-all lint/performance/noJsxPropsBind: Canvas actions carry object-specific data and are not memoized.
import { Button } from "@better-x/ui/components/button";
import { Elevated } from "@better-x/ui/components/elevated";
import { Kbd } from "@better-x/ui/components/kbd";
import {
  LiquidMenuContent,
  LiquidMenuRoot,
  LiquidMenuTrigger,
} from "@better-x/ui/fixture/liquid-menu/components/liquid-menu";
import { LiquidMenuAutoSize } from "@better-x/ui/fixture/liquid-menu/components/liquid-menu-auto-size";
import { LiquidMenuStackProvider } from "@better-x/ui/fixture/liquid-menu/components/liquid-menu-stack-provider";
import { SurfaceProvider } from "@better-x/ui/lib/surface-context";
import type { Icon } from "@phosphor-icons/react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { CropIcon } from "@phosphor-icons/react/dist/csr/Crop";
import { CursorIcon } from "@phosphor-icons/react/dist/csr/Cursor";
import { DropHalfBottomIcon } from "@phosphor-icons/react/dist/csr/DropHalfBottom";
import { RectangleIcon } from "@phosphor-icons/react/dist/csr/Rectangle";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { TextTIcon } from "@phosphor-icons/react/dist/csr/TextT";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  type CSSProperties,
  createElement,
  forwardRef,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { useImageEditorTransition } from "../hooks/use-image-editor-transition";
import {
  type ArrowSceneObject,
  type BlurSceneObject,
  clamp,
  cloneScene,
  createInitialScene,
  EDITOR_TOOLS,
  type EditorTool,
  findSceneObjectAtPoint,
  getSceneObject,
  getSceneRenderLayout,
  getSnappedPosition,
  IMAGE_EDITOR_OPEN_ATTRIBUTE,
  normalizeDegrees,
  panImageCrop,
  RESIZE_HANDLES,
  type RectangleSceneObject,
  type ResizeHandle,
  removeSceneObject,
  reorderSceneObject,
  resizeImageCrop,
  resizeSceneObject,
  type SceneBackground,
  type SceneDocument,
  type SceneObject,
  type ScenePoint,
  type SceneRenderLayout,
  scenePointToObject,
  type TextSceneObject,
  updateSceneObject,
  zoomImageCrop,
} from "../lib/image-editor";
import { drawImageEditorScene } from "../lib/image-editor-renderer";
import {
  type EditorViewTransform,
  fitImageEditorView,
  formatEditorViewTransform,
  type ImageEditorOrigin,
} from "../lib/image-editor-viewport";
import { ImageEditorInspector } from "./image-editor-inspector";

import "@better-x/ui/liquid.css";
import "../styles/image-editor.css";

const EDITOR_RENDER_EDGE = 1600;
const EXPORT_EDGE = 4096;
const FILE_EXTENSION_PATTERN = /\.[^/.]+$/;

export const EDITOR_TOOL_DETAILS: Record<
  EditorTool,
  { icon: Icon; key: string; label: string }
> = {
  arrow: { icon: ArrowUpRightIcon, key: "A", label: "Arrow" },
  blur: { icon: DropHalfBottomIcon, key: "B", label: "Blur" },
  rectangle: { icon: RectangleIcon, key: "R", label: "Rectangle" },
  select: { icon: CursorIcon, key: "V", label: "Select" },
  text: { icon: TextTIcon, key: "T", label: "Text" },
};

const INSPECTOR_ANCHOR_GEOMETRY = {
  insetBlock: 0,
  insetInline: 0,
  radius: 10,
} as const;

export interface OpenImageEditorOptions {
  readonly file: File;
  readonly onApply: (file: File) => Promise<void> | void;
  readonly origin?: ImageEditorOrigin;
  readonly theme: "" | "dark";
  readonly trigger: HTMLElement;
}

export interface MountedImageEditor {
  close: () => void;
  destroy: () => void;
  open: (options: OpenImageEditorOptions) => Promise<void>;
}

interface ImageEditorHandle {
  close: (immediate?: boolean) => void;
  open: (options: OpenImageEditorOptions) => Promise<void>;
}

interface EditorSession extends OpenImageEditorOptions {
  image: ImageBitmap;
}

interface EditorDocumentState {
  history: readonly SceneDocument[];
  historyIndex: number;
  scene: SceneDocument | null;
}

const getEditorLiquidTheme = (session: EditorSession | null): "" | "dark" =>
  session ? session.theme : "";

const getEditorOrigin = (
  session: EditorSession | null
): ImageEditorOrigin | null => (session ? (session.origin ?? null) : null);

const isEditorTransitionReady = (
  phase: EditorPhase,
  hasFittedView: boolean
): boolean => phase === "ready" && hasFittedView;

interface BaseInteraction {
  pointerId: number;
  startClient: ScenePoint;
  startScene: SceneDocument;
}

interface MoveInteraction extends BaseInteraction {
  kind: "move";
  objectId: string;
}

interface ResizeInteraction extends BaseInteraction {
  handle: ResizeHandle;
  kind: "resize";
  objectId: string;
}

interface RotateInteraction extends BaseInteraction {
  center: ScenePoint;
  kind: "rotate";
  objectId: string;
  startAngle: number;
  startRotation: number;
}

interface CreateInteraction extends BaseInteraction {
  kind: "create";
  objectId: string;
  objectName: string;
  startPoint: ScenePoint;
  tool: Exclude<EditorTool, "select" | "text">;
}

interface CropPanInteraction extends BaseInteraction {
  kind: "crop-pan";
  objectId: string;
}

interface CropResizeInteraction extends BaseInteraction {
  handle: ResizeHandle;
  kind: "crop-resize";
  objectId: string;
}

type EditorInteraction =
  | CreateInteraction
  | CropPanInteraction
  | CropResizeInteraction
  | MoveInteraction
  | ResizeInteraction
  | RotateInteraction;

type EditorPhase = "closed" | "error" | "loading" | "ready" | "rendering";

const EMPTY_DOCUMENT: EditorDocumentState = {
  history: [],
  historyIndex: -1,
  scene: null,
};

const INITIAL_VIEW: EditorViewTransform = { scale: 1, x: 0, y: 0 };

const getFileExtension = (type: string): string => {
  if (type === "image/jpeg") {
    return "jpg";
  }
  if (type === "image/webp") {
    return "webp";
  }
  return "png";
};

const getOutputType = (type: string): string =>
  type === "image/jpeg" || type === "image/webp" ? type : "image/png";

const getOutputName = (file: File, outputType: string): string => {
  const baseName = file.name.replace(FILE_EXTENSION_PATTERN, "") || "image";
  return `${baseName}-edited.${getFileExtension(outputType)}`;
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("The edited image could not be rendered."));
        }
      },
      type,
      type === "image/jpeg" || type === "image/webp" ? 0.92 : undefined
    );
  });

const getClientPoint = ({
  clientX,
  clientY,
}: {
  clientX: number;
  clientY: number;
}): ScenePoint => ({ x: clientX, y: clientY });

const reportAsyncError = (error: unknown): void => {
  window.reportError(error);
};

function ToolButton({
  currentTool,
  onSelect,
  tool,
}: {
  readonly currentTool: EditorTool;
  readonly onSelect: (tool: EditorTool) => void;
  readonly tool: EditorTool;
}): ReactElement {
  const details = EDITOR_TOOL_DETAILS[tool];
  const ToolIcon = details.icon;
  return (
    <Button
      aria-label={details.label}
      aria-pressed={tool === currentTool}
      className="better-x-image-editor__tool"
      onClick={() => onSelect(tool)}
      size="icon"
      title={`${details.label} (${details.key})`}
      type="button"
      variant="ghost"
    >
      <ToolIcon
        aria-hidden
        className="better-x-image-editor__icon better-x-image-editor__tool-icon"
        weight="regular"
      />
      <Kbd>{details.key}</Kbd>
    </Button>
  );
}

interface ImageEditorProps {
  readonly host: HTMLElement;
  readonly portalContainer: HTMLElement;
}

const ImageEditor = forwardRef<ImageEditorHandle, ImageEditorProps>(
  function ImageEditorComponent(
    { host, portalContainer },
    imperativeRef
  ): ReactElement | null {
    const [currentTool, setCurrentTool] = useState<EditorTool>("select");
    const [documentState, setDocumentState] =
      useState<EditorDocumentState>(EMPTY_DOCUMENT);
    const [errorMessage, setErrorMessage] = useState("");
    const [hasFittedView, setHasFittedView] = useState(false);
    const [isCropping, setIsCropping] = useState(false);
    const [isInspectorOpen, setIsInspectorOpen] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [phase, setPhase] = useState<EditorPhase>("closed");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [session, setSession] = useState<EditorSession | null>(null);
    const [view, setView] = useState<EditorViewTransform>(INITIAL_VIEW);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const cropStartRef = useRef<SceneDocument | null>(null);
    const currentToolRef = useRef(currentTool);
    const documentRef = useRef(documentState);
    const interactionRef = useRef<EditorInteraction | null>(null);
    const isOpenRef = useRef(isOpen);
    const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {
      // Assigned on every render so the global listener sees current state.
    });
    const layoutRef = useRef<SceneRenderLayout | null>(null);
    const objectSequenceRef = useRef(0);
    const openRequestRef = useRef(0);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const inspectorTriggerRef = useRef<HTMLButtonElement>(null);
    const selectedIdRef = useRef<string | null>(selectedId);
    const sessionRef = useRef<EditorSession | null>(session);
    const stageRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef(view);

    const { scene } = documentState;
    const selected = scene ? getSceneObject(scene, selectedId) : null;
    const layout = useMemo(
      () => (scene ? getSceneRenderLayout(scene, EDITOR_RENDER_EDGE) : null),
      [scene]
    );
    layoutRef.current = layout;

    const updateDocument = useCallback(
      (
        update:
          | EditorDocumentState
          | ((current: EditorDocumentState) => EditorDocumentState)
      ): void => {
        const next =
          typeof update === "function" ? update(documentRef.current) : update;
        documentRef.current = next;
        setDocumentState(next);
      },
      []
    );

    const setOpenState = useCallback((next: boolean): void => {
      isOpenRef.current = next;
      setIsOpen(next);
    }, []);

    const setSelected = useCallback((next: string | null): void => {
      selectedIdRef.current = next;
      setSelectedId(next);
    }, []);

    const setTool = useCallback((next: EditorTool): void => {
      currentToolRef.current = next;
      setCurrentTool(next);
    }, []);

    const setEditorSession = useCallback((next: EditorSession | null): void => {
      sessionRef.current = next;
      setSession(next);
    }, []);

    const setEditorView = useCallback((next: EditorViewTransform): void => {
      viewRef.current = next;
      setView(next);
    }, []);

    const finishClose = useCallback((): void => {
      openRequestRef.current += 1;
      const returnFocus = sessionRef.current?.trigger ?? returnFocusRef.current;
      returnFocusRef.current = null;
      sessionRef.current?.origin?.setVisible(true);
      sessionRef.current?.image.close();
      setEditorSession(null);
      setHasFittedView(false);
      cropStartRef.current = null;
      setIsCropping(false);
      interactionRef.current = null;
      objectSequenceRef.current = 0;
      updateDocument(EMPTY_DOCUMENT);
      setSelected(null);
      setTool("select");
      setEditorView(INITIAL_VIEW);
      setErrorMessage("");
      setIsInspectorOpen(false);
      setPhase("closed");
      setOpenState(false);
      host.hidden = true;
      portalContainer.dataset.liquidTheme = "";
      document.documentElement.removeAttribute(IMAGE_EDITOR_OPEN_ATTRIBUTE);
      if (returnFocus?.isConnected) {
        returnFocus.focus();
      }
    }, [
      host,
      portalContainer,
      setEditorSession,
      setEditorView,
      setOpenState,
      setSelected,
      setTool,
      updateDocument,
    ]);

    const openEditor = useCallback(
      async (options: OpenImageEditorOptions): Promise<void> => {
        openRequestRef.current += 1;
        const request = openRequestRef.current;
        returnFocusRef.current = options.trigger;
        sessionRef.current?.origin?.setVisible(true);
        sessionRef.current?.image.close();
        setEditorSession(null);
        setHasFittedView(false);
        cropStartRef.current = null;
        setIsCropping(false);
        interactionRef.current = null;
        objectSequenceRef.current = 0;
        updateDocument(EMPTY_DOCUMENT);
        setSelected(null);
        setTool("select");
        setEditorView(INITIAL_VIEW);
        setErrorMessage("");
        setIsInspectorOpen(false);
        setPhase("loading");

        try {
          const image = await createImageBitmap(options.file);
          if (request !== openRequestRef.current) {
            image.close();
            return;
          }
          const nextSession = { ...options, image };
          const nextScene = createInitialScene(image.width, image.height);
          host.hidden = false;
          portalContainer.dataset.liquidTheme = options.theme;
          document.documentElement.setAttribute(
            IMAGE_EDITOR_OPEN_ATTRIBUTE,
            "true"
          );
          flushSync(() => {
            setEditorSession(nextSession);
            updateDocument({
              history: [cloneScene(nextScene)],
              historyIndex: 0,
              scene: nextScene,
            });
            setSelected("image");
            setPhase("ready");
            setOpenState(true);
          });
          window.requestAnimationFrame(() => canvasRef.current?.focus());
        } catch (error) {
          if (request !== openRequestRef.current) {
            return;
          }
          host.hidden = false;
          portalContainer.dataset.liquidTheme = options.theme;
          document.documentElement.setAttribute(
            IMAGE_EDITOR_OPEN_ATTRIBUTE,
            "true"
          );
          setErrorMessage("This image could not be opened.");
          setPhase("error");
          setOpenState(true);
          window.requestAnimationFrame(() => closeButtonRef.current?.focus());
          throw error;
        }
      },
      [
        host,
        portalContainer,
        setEditorSession,
        setEditorView,
        setOpenState,
        setSelected,
        setTool,
        updateDocument,
      ]
    );

    const fitView = useCallback((): void => {
      const stage = stageRef.current;
      const currentLayout = layoutRef.current;
      if (!(stage && currentLayout)) {
        return;
      }
      const bounds = stage.getBoundingClientRect();
      setEditorView(
        fitImageEditorView({
          canvasHeight: currentLayout.canvasHeight,
          canvasWidth: currentLayout.canvasWidth,
          stageHeight: bounds.height,
          stageWidth: bounds.width,
        })
      );
      setHasFittedView(true);
    }, [setEditorView]);

    useLayoutEffect(() => {
      if (!(scene && session && canvasRef.current)) {
        return;
      }
      try {
        drawImageEditorScene(
          canvasRef.current,
          scene,
          session.image,
          EDITOR_RENDER_EDGE
        );
      } catch (error) {
        setErrorMessage("The browser could not render this image.");
        setPhase("error");
        window.reportError(error);
      }
    }, [scene, session]);

    useLayoutEffect(() => {
      if (isOpen && layoutRef.current) {
        fitView();
      }
    }, [fitView, isOpen, layout?.canvasHeight, layout?.canvasWidth]);

    useEffect(() => {
      const stage = stageRef.current;
      if (!(isOpen && stage)) {
        return;
      }
      const observer = new ResizeObserver(fitView);
      observer.observe(stage);
      return () => observer.disconnect();
    }, [fitView, isOpen]);

    const { close: transitionClose, state: transitionState } =
      useImageEditorTransition({
        canvasRef,
        isReady: isEditorTransitionReady(phase, hasFittedView),
        onClosed: finishClose,
        origin: getEditorOrigin(session),
        sessionKey: session,
        stageRef,
        view,
      });

    const closeEditor = useCallback(
      (immediate = false): void => {
        transitionClose({ immediate });
      },
      [transitionClose]
    );

    useImperativeHandle(
      imperativeRef,
      () => ({ close: closeEditor, open: openEditor }),
      [closeEditor, openEditor]
    );

    useEffect(
      () => () => {
        openRequestRef.current += 1;
        sessionRef.current?.origin?.setVisible(true);
        sessionRef.current?.image.close();
        document.documentElement.removeAttribute(IMAGE_EDITOR_OPEN_ATTRIBUTE);
      },
      []
    );

    function previewScene(nextScene: SceneDocument): void {
      updateDocument((current) => ({ ...current, scene: nextScene }));
    }

    function commitScene(): void {
      if (cropStartRef.current) {
        return;
      }
      updateDocument((current) => {
        const currentScene = current.scene;
        if (!currentScene) {
          return current;
        }
        const snapshot = current.history[current.historyIndex];
        if (
          snapshot &&
          JSON.stringify(snapshot) === JSON.stringify(currentScene)
        ) {
          return current;
        }
        const history = current.history.slice(0, current.historyIndex + 1);
        history.push(cloneScene(currentScene));
        return {
          history,
          historyIndex: history.length - 1,
          scene: currentScene,
        };
      });
    }

    function updateSelected(
      update: (object: SceneObject) => SceneObject
    ): void {
      const current = documentRef.current.scene;
      const objectId = selectedIdRef.current;
      if (!(current && objectId)) {
        return;
      }
      previewScene(updateSceneObject(current, objectId, update));
    }

    function updateCanvas(
      update: Partial<Pick<SceneDocument, "height" | "width">>
    ): void {
      const current = documentRef.current.scene;
      if (!current) {
        return;
      }
      previewScene({
        ...current,
        height:
          update.height === undefined
            ? current.height
            : clamp(update.height, 64, 16_384),
        width:
          update.width === undefined
            ? current.width
            : clamp(update.width, 64, 16_384),
      });
    }

    function updateBackground(update: Partial<SceneBackground>): void {
      const current = documentRef.current.scene;
      if (!current) {
        return;
      }
      previewScene({
        ...current,
        background: { ...current.background, ...update },
      });
    }

    function applyCanvasPreset(ratio: number | null): void {
      const current = documentRef.current.scene;
      const currentSession = sessionRef.current;
      if (!(current && currentSession)) {
        return;
      }
      const { width } = currentSession.image;
      const height = ratio
        ? Math.round(width / ratio)
        : currentSession.image.height;
      previewScene({ ...current, height, width });
      commitScene();
    }

    function undo(): void {
      if (cropStartRef.current) {
        cancelCropMode();
        return;
      }
      const {
        history,
        historyIndex: currentHistoryIndex,
        scene: currentScene,
      } = documentRef.current;
      if (currentHistoryIndex <= 0) {
        return;
      }
      const historyIndex = currentHistoryIndex - 1;
      const previous = history[historyIndex];
      if (!previous) {
        return;
      }
      const nextScene = cloneScene(previous);
      updateDocument({
        history,
        historyIndex,
        scene: currentScene ? nextScene : null,
      });
      const objectId = selectedIdRef.current;
      if (objectId && !getSceneObject(nextScene, objectId)) {
        setSelected(null);
      }
    }

    function redo(): void {
      const {
        history,
        historyIndex: currentHistoryIndex,
        scene: currentScene,
      } = documentRef.current;
      if (cropStartRef.current || currentHistoryIndex >= history.length - 1) {
        return;
      }
      const historyIndex = currentHistoryIndex + 1;
      const next = history[historyIndex];
      if (!next) {
        return;
      }
      updateDocument({
        history,
        historyIndex,
        scene: currentScene ? cloneScene(next) : null,
      });
    }

    function finishCropMode(): void {
      if (!cropStartRef.current) {
        return;
      }
      cropStartRef.current = null;
      setIsCropping(false);
      commitScene();
    }

    function cancelCropMode(): void {
      const cropStart = cropStartRef.current;
      if (!cropStart) {
        return;
      }
      cropStartRef.current = null;
      setIsCropping(false);
      previewScene(cloneScene(cropStart));
    }

    function enterCropMode(): void {
      const current = documentRef.current.scene;
      const object = current
        ? getSceneObject(current, selectedIdRef.current)
        : null;
      if (!(current && object?.kind === "image")) {
        return;
      }
      cropStartRef.current = cloneScene(current);
      setIsCropping(true);
      setTool("select");
    }

    function toggleCropMode(): void {
      if (cropStartRef.current) {
        finishCropMode();
      } else {
        enterCropMode();
      }
    }

    function selectTool(tool: EditorTool): void {
      if (cropStartRef.current) {
        finishCropMode();
      }
      setTool(tool);
      canvasRef.current?.focus();
    }

    function selectObject(objectId: string | null): void {
      if (cropStartRef.current && objectId !== selectedIdRef.current) {
        finishCropMode();
      }
      setSelected(objectId);
      setTool("select");
    }

    function duplicateSelected(): void {
      const current = documentRef.current.scene;
      const objectId = selectedIdRef.current;
      const object = current ? getSceneObject(current, objectId) : null;
      if (!(current && object)) {
        return;
      }
      objectSequenceRef.current += 1;
      const copy: SceneObject = {
        ...object,
        id: `${object.kind}-${objectSequenceRef.current}`,
        name: `${object.name} copy`,
        x: object.x + 24,
        y: object.y + 24,
      };
      previewScene({ ...current, objects: [...current.objects, copy] });
      setSelected(copy.id);
      commitScene();
    }

    function deleteSelected(): void {
      const current = documentRef.current.scene;
      const objectId = selectedIdRef.current;
      if (!(current && objectId)) {
        return;
      }
      previewScene(removeSceneObject(current, objectId));
      setSelected(null);
      commitScene();
    }

    function reorderSelected(direction: -1 | 1): void {
      const current = documentRef.current.scene;
      const objectId = selectedIdRef.current;
      if (!(current && objectId)) {
        return;
      }
      previewScene(reorderSceneObject(current, objectId, direction));
      commitScene();
    }

    function nudgeSelected(dx: number, dy: number): void {
      const current = documentRef.current.scene;
      const object = current
        ? getSceneObject(current, selectedIdRef.current)
        : null;
      if (!object || object.locked) {
        return;
      }
      updateSelected((candidate) => ({
        ...candidate,
        x: candidate.x + dx,
        y: candidate.y + dy,
      }));
      commitScene();
    }

    function createObject(
      tool: Exclude<EditorTool, "select" | "text">,
      start: ScenePoint,
      end: ScenePoint,
      identity: { id: string; name: string }
    ): ArrowSceneObject | BlurSceneObject | RectangleSceneObject {
      const width = Math.max(12, Math.abs(end.x - start.x));
      const height = Math.max(12, Math.abs(end.y - start.y));
      const x = (start.x + end.x) / 2;
      const y = (start.y + end.y) / 2;
      const base = {
        height,
        id: identity.id,
        locked: false,
        name: identity.name,
        opacity: 1,
        rotation: 0,
        visible: true,
        width,
        x,
        y,
      };
      if (tool === "arrow") {
        return {
          ...base,
          height: 24,
          kind: "arrow",
          rotation:
            (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI,
          stroke: "#1d9bf0",
          strokeWidth: 8,
          width: Math.max(12, Math.hypot(end.x - start.x, end.y - start.y)),
        };
      }
      if (tool === "blur") {
        return { ...base, kind: "blur", strength: 24 };
      }
      return {
        ...base,
        fill: "#1d9bf0",
        kind: "rectangle",
        radius: 18,
        stroke: "#ffffff",
        strokeWidth: 0,
      };
    }

    function addTextObject(point: ScenePoint): void {
      const current = documentRef.current.scene;
      if (!current) {
        return;
      }
      objectSequenceRef.current += 1;
      const sequence = objectSequenceRef.current;
      const object: TextSceneObject = {
        align: "left",
        background: "transparent",
        color: "#ffffff",
        fontFamily: "TwitterChirp, Inter, sans-serif",
        fontSize: Math.max(36, Math.min(current.width, current.height) * 0.06),
        fontWeight: 700,
        height: 140,
        id: `text-${sequence}`,
        kind: "text",
        letterSpacing: 0,
        lineHeight: 1.1,
        locked: false,
        name: `Text ${sequence}`,
        opacity: 1,
        rotation: 0,
        shadow: 8,
        text: "Text",
        visible: true,
        width: Math.min(520, current.width * 0.5),
        x: point.x,
        y: point.y,
      };
      previewScene({ ...current, objects: [...current.objects, object] });
      setSelected(object.id);
      setTool("select");
      setIsInspectorOpen(true);
      commitScene();
    }

    function clientToScene(point: ScenePoint): ScenePoint | null {
      const currentLayout = layoutRef.current;
      const stage = stageRef.current;
      if (!(currentLayout && stage)) {
        return null;
      }
      const bounds = stage.getBoundingClientRect();
      const currentView = viewRef.current;
      const canvasX =
        (point.x - bounds.left - currentView.x) / currentView.scale;
      const canvasY =
        (point.y - bounds.top - currentView.y) / currentView.scale;
      return {
        x: (canvasX - currentLayout.x) / currentLayout.scale,
        y: (canvasY - currentLayout.y) / currentLayout.scale,
      };
    }

    function sceneToStage(point: ScenePoint): ScenePoint | null {
      const currentLayout = layoutRef.current;
      if (!currentLayout) {
        return null;
      }
      const currentView = viewRef.current;
      return {
        x:
          currentView.x +
          (currentLayout.x + point.x * currentLayout.scale) * currentView.scale,
        y:
          currentView.y +
          (currentLayout.y + point.y * currentLayout.scale) * currentView.scale,
      };
    }

    function captureInteraction(
      event: ReactPointerEvent<HTMLElement>,
      interaction: EditorInteraction
    ): void {
      event.preventDefault();
      event.stopPropagation();
      interactionRef.current = interaction;
      stageRef.current?.setPointerCapture(event.pointerId);
    }

    function startResize(
      event: ReactPointerEvent<HTMLButtonElement>,
      handle: ResizeHandle
    ): void {
      const current = documentRef.current.scene;
      const object = current
        ? getSceneObject(current, selectedIdRef.current)
        : null;
      if (!(current && object && !object.locked)) {
        return;
      }
      const base = {
        handle,
        objectId: object.id,
        pointerId: event.pointerId,
        startClient: getClientPoint(event),
        startScene: cloneScene(current),
      };
      const interaction: EditorInteraction =
        cropStartRef.current && object.kind === "image"
          ? { ...base, kind: "crop-resize" }
          : { ...base, kind: "resize" };
      captureInteraction(event, interaction);
    }

    function startRotate(event: ReactPointerEvent<HTMLButtonElement>): void {
      const current = documentRef.current.scene;
      const object = current
        ? getSceneObject(current, selectedIdRef.current)
        : null;
      const center = object ? sceneToStage({ x: object.x, y: object.y }) : null;
      const stage = stageRef.current;
      if (
        !(
          current &&
          object &&
          center &&
          stage &&
          !object.locked &&
          !cropStartRef.current
        )
      ) {
        return;
      }
      const bounds = stage.getBoundingClientRect();
      const centerClient = {
        x: bounds.left + center.x,
        y: bounds.top + center.y,
      };
      captureInteraction(event, {
        center: centerClient,
        kind: "rotate",
        objectId: object.id,
        pointerId: event.pointerId,
        startAngle: Math.atan2(
          event.clientY - centerClient.y,
          event.clientX - centerClient.x
        ),
        startClient: getClientPoint(event),
        startRotation: object.rotation,
        startScene: cloneScene(current),
      });
    }

    function startCreate(
      event: ReactPointerEvent<HTMLDivElement>,
      point: ScenePoint,
      tool: Exclude<EditorTool, "select" | "text">
    ): void {
      const current = documentRef.current.scene;
      if (!current) {
        return;
      }
      objectSequenceRef.current += 1;
      const sequence = objectSequenceRef.current;
      const objectName = `${EDITOR_TOOL_DETAILS[tool].label} ${sequence}`;
      const objectId = `${tool}-${sequence}`;
      const object = createObject(tool, point, point, {
        id: objectId,
        name: objectName,
      });
      const nextScene = {
        ...current,
        objects: [...current.objects, object],
      };
      previewScene(nextScene);
      setSelected(object.id);
      captureInteraction(event, {
        kind: "create",
        objectId,
        objectName,
        pointerId: event.pointerId,
        startClient: getClientPoint(event),
        startPoint: point,
        startScene: cloneScene(nextScene),
        tool,
      });
    }

    function handleStagePointerDown(
      event: ReactPointerEvent<HTMLDivElement>
    ): void {
      const current = documentRef.current.scene;
      if (!current || event.button !== 0) {
        return;
      }
      if (event.target === event.currentTarget) {
        selectObject(null);
        return;
      }
      if (event.target !== canvasRef.current) {
        return;
      }
      const point = clientToScene(getClientPoint(event));
      if (!point) {
        return;
      }
      const tool = currentToolRef.current;
      if (tool === "text") {
        addTextObject(point);
        return;
      }
      if (tool !== "select") {
        startCreate(event, point, tool);
        return;
      }
      const object = findSceneObjectAtPoint(current, point);
      if (!object) {
        selectObject(null);
        return;
      }
      selectObject(object.id);
      if (object.locked) {
        return;
      }
      const base = {
        objectId: object.id,
        pointerId: event.pointerId,
        startClient: getClientPoint(event),
        startScene: cloneScene(current),
      };
      const interaction: EditorInteraction =
        cropStartRef.current && object.kind === "image"
          ? { ...base, kind: "crop-pan" }
          : { ...base, kind: "move" };
      captureInteraction(event, interaction);
    }

    function handleStageDoubleClick(
      event: ReactMouseEvent<HTMLDivElement>
    ): void {
      const current = documentRef.current.scene;
      if (!(current && event.target === canvasRef.current)) {
        return;
      }
      const point = clientToScene(getClientPoint(event));
      const object = point ? findSceneObjectAtPoint(current, point) : null;
      if (object?.kind === "image") {
        selectObject(object.id);
        enterCropMode();
      }
    }

    function getInteractionScene(
      event: ReactPointerEvent<HTMLDivElement>,
      interaction: EditorInteraction,
      startObject: SceneObject,
      currentPoint: ScenePoint,
      delta: ScenePoint
    ): SceneDocument {
      if (interaction.kind === "move") {
        const position = event.altKey
          ? { x: startObject.x + delta.x, y: startObject.y + delta.y }
          : getSnappedPosition(
              interaction.startScene,
              startObject,
              startObject.x + delta.x,
              startObject.y + delta.y,
              7 /
                Math.max(
                  0.01,
                  (layoutRef.current?.scale ?? 1) * viewRef.current.scale
                )
            );
        return updateSceneObject(
          interaction.startScene,
          startObject.id,
          (object) => ({ ...object, ...position })
        );
      }
      if (interaction.kind === "resize") {
        return updateSceneObject(
          interaction.startScene,
          startObject.id,
          (object) =>
            resizeSceneObject(object, interaction.handle, delta, event.shiftKey)
        );
      }
      if (interaction.kind === "crop-pan" && startObject.kind === "image") {
        return updateSceneObject(interaction.startScene, startObject.id, () =>
          panImageCrop(startObject, delta)
        );
      }
      if (interaction.kind === "crop-resize" && startObject.kind === "image") {
        return updateSceneObject(interaction.startScene, startObject.id, () =>
          resizeImageCrop(startObject, interaction.handle, delta)
        );
      }
      if (interaction.kind === "rotate") {
        return getRotatedScene(event, interaction, startObject);
      }
      if (interaction.kind === "create") {
        const object = createObject(
          interaction.tool,
          interaction.startPoint,
          currentPoint,
          {
            id: interaction.objectId,
            name: interaction.objectName,
          }
        );
        return updateSceneObject(
          interaction.startScene,
          interaction.objectId,
          () => object
        );
      }
      return interaction.startScene;
    }

    function getRotatedScene(
      event: ReactPointerEvent<HTMLDivElement>,
      interaction: RotateInteraction,
      startObject: SceneObject
    ): SceneDocument {
      const angle = Math.atan2(
        event.clientY - interaction.center.y,
        event.clientX - interaction.center.x
      );
      let rotation = normalizeDegrees(
        interaction.startRotation +
          ((angle - interaction.startAngle) * 180) / Math.PI
      );
      if (event.shiftKey) {
        rotation = Math.round(rotation / 15) * 15;
      }
      return updateSceneObject(
        interaction.startScene,
        startObject.id,
        (object) => ({ ...object, rotation })
      );
    }

    function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      const startPoint = clientToScene(interaction.startClient);
      const currentPoint = clientToScene(getClientPoint(event));
      if (!(startPoint && currentPoint)) {
        return;
      }
      const delta = {
        x: currentPoint.x - startPoint.x,
        y: currentPoint.y - startPoint.y,
      };
      const startObject = getSceneObject(
        interaction.startScene,
        interaction.objectId
      );
      if (!startObject) {
        return;
      }
      previewScene(
        getInteractionScene(
          event,
          interaction,
          startObject,
          currentPoint,
          delta
        )
      );
    }

    function finishInteraction(event: ReactPointerEvent<HTMLDivElement>): void {
      const interaction = interactionRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) {
        return;
      }
      interactionRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!cropStartRef.current) {
        commitScene();
      }
      if (interaction.kind === "create") {
        setTool("select");
      }
    }

    function handleWheel(event: ReactWheelEvent<HTMLDivElement>): void {
      const current = documentRef.current.scene;
      const object = current
        ? getSceneObject(current, selectedIdRef.current)
        : null;
      if (!(current && cropStartRef.current && object?.kind === "image")) {
        return;
      }
      const point = clientToScene(getClientPoint(event));
      if (!point) {
        return;
      }
      const local = scenePointToObject(point, object);
      const anchor = {
        x: clamp(local.x / object.width + 0.5, 0, 1),
        y: clamp(local.y / object.height + 0.5, 0, 1),
      };
      const zoom = Math.exp(-event.deltaY * 0.002);
      previewScene(
        updateSceneObject(current, object.id, () =>
          zoomImageCrop(object, zoom, anchor)
        )
      );
    }

    function trapFocus(event: KeyboardEvent): void {
      const focusable = Array.from(
        host.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), canvas[tabindex="0"], summary'
        )
      ).filter((element) => !element.hidden && element.offsetParent);
      const [first] = focusable;
      const last = focusable.at(-1);
      if (!(first && last)) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    async function applyEditor(): Promise<void> {
      if (phase !== "ready") {
        return;
      }
      if (cropStartRef.current) {
        finishCropMode();
      }
      const currentScene = documentRef.current.scene;
      const currentSession = sessionRef.current;
      if (!(currentScene && currentSession)) {
        return;
      }
      setErrorMessage("");
      setPhase("rendering");
      const request = openRequestRef.current;
      try {
        const outputCanvas = document.createElement("canvas");
        drawImageEditorScene(
          outputCanvas,
          currentScene,
          currentSession.image,
          EXPORT_EDGE
        );
        const outputType = getOutputType(currentSession.file.type);
        const blob = await canvasToBlob(outputCanvas, outputType);
        if (request !== openRequestRef.current) {
          return;
        }
        const editedFile = new File(
          [blob],
          getOutputName(currentSession.file, outputType),
          { type: outputType }
        );
        await currentSession.onApply(editedFile);
        if (request === openRequestRef.current) {
          transitionClose({ reverse: false });
        }
      } catch (error) {
        setErrorMessage(
          "The edit could not be applied. Your original is unchanged."
        );
        setPhase("ready");
        throw error;
      }
    }

    function handleEscapeOrTab(event: KeyboardEvent): boolean {
      if (event.key === "Escape") {
        event.preventDefault();
        if (cropStartRef.current) {
          cancelCropMode();
        } else if (selectedIdRef.current) {
          selectObject(null);
        } else {
          closeEditor();
        }
        return true;
      }
      if (event.key === "Tab") {
        trapFocus(event);
        return true;
      }
      return false;
    }

    function handleCommandKey(event: KeyboardEvent, key: string): boolean {
      if (!(event.metaKey || event.ctrlKey)) {
        return false;
      }
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (key === "d") {
        event.preventDefault();
        duplicateSelected();
      } else if (event.key === "Enter") {
        event.preventDefault();
        applyEditor().catch(reportAsyncError);
      }
      return true;
    }

    function handleCanvasKey(event: KeyboardEvent): boolean {
      const isEditable =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement;
      if (isEditable) {
        return true;
      }
      if (event.key === "Enter" && cropStartRef.current) {
        event.preventDefault();
        finishCropMode();
        return true;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteSelected();
        return true;
      }
      const amount = event.shiftKey ? 10 : 1;
      const offsets: Partial<Record<string, ScenePoint>> = {
        ArrowDown: { x: 0, y: amount },
        ArrowLeft: { x: -amount, y: 0 },
        ArrowRight: { x: amount, y: 0 },
        ArrowUp: { x: 0, y: -amount },
      };
      const offset = offsets[event.key];
      if (offset) {
        event.preventDefault();
        nudgeSelected(offset.x, offset.y);
        return true;
      }
      return false;
    }

    function handleToolKey(event: KeyboardEvent, key: string): void {
      if (event.altKey) {
        return;
      }
      const tool = EDITOR_TOOLS.find(
        (candidate) => EDITOR_TOOL_DETAILS[candidate].key.toLowerCase() === key
      );
      if (tool) {
        event.preventDefault();
        selectTool(tool);
      } else if (key === "c") {
        event.preventDefault();
        toggleCropMode();
      } else if (key === "]") {
        event.preventDefault();
        reorderSelected(1);
      } else if (key === "[") {
        event.preventDefault();
        reorderSelected(-1);
      }
    }

    keyHandlerRef.current = (event: KeyboardEvent): void => {
      if (!isOpenRef.current) {
        return;
      }
      event.stopImmediatePropagation();
      const key = event.key.toLowerCase();
      if (
        handleEscapeOrTab(event) ||
        handleCommandKey(event, key) ||
        handleCanvasKey(event)
      ) {
        return;
      }
      handleToolKey(event, key);
    };

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent): void =>
        keyHandlerRef.current(event);
      window.addEventListener("keydown", handleKeyDown, { capture: true });
      return () =>
        window.removeEventListener("keydown", handleKeyDown, {
          capture: true,
        });
    }, []);

    const getInspectorAnchor = useCallback(
      (): Element | null => inspectorTriggerRef.current,
      []
    );

    const canvasStyle: CSSProperties = {
      transform: formatEditorViewTransform(view),
    };

    let selectionStyle: CSSProperties | undefined;
    if (selected?.visible && layout) {
      const factor = layout.scale * view.scale;
      const centerX =
        view.x + (layout.x + selected.x * layout.scale) * view.scale;
      const centerY =
        view.y + (layout.y + selected.y * layout.scale) * view.scale;
      selectionStyle = {
        height: selected.height * factor,
        left: centerX - (selected.width * factor) / 2,
        top: centerY - (selected.height * factor) / 2,
        transform: `rotate(${selected.rotation}deg)`,
        width: selected.width * factor,
      };
    }

    let status =
      "Canvas selected. Adjust its size and background, or choose a tool to add an object.";
    if (phase === "loading") {
      status = "Opening image…";
    } else if (phase === "rendering") {
      status = "Rendering image…";
    } else if (errorMessage) {
      status = errorMessage;
    } else if (isCropping) {
      status =
        "Drag to reposition. Resize to crop. Scroll to zoom. Enter applies; Esc cancels.";
    } else if (selected?.locked) {
      status = "This object is locked. Unlock it in Arrange to transform it.";
    } else if (selected) {
      status =
        "Drag to move. Resize or rotate with handles. Click outside for canvas settings.";
    }

    if (!isOpen) {
      return null;
    }

    return (
      <SurfaceProvider value={1}>
        <LiquidMenuStackProvider portalContainer={portalContainer}>
          <section
            aria-label="Better X image editor"
            aria-modal="true"
            className="better-x-image-editor__dialog"
            data-crop={String(isCropping)}
            data-error={phase === "error" ? "true" : undefined}
            data-liquid-theme={getEditorLiquidTheme(session)}
            data-loading={phase === "loading" ? "true" : undefined}
            data-transition={transitionState}
            role="dialog"
          >
            {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: The stage is a composite canvas widget with delegated pointer handling. */}
            <div
              aria-label="Image editing stage"
              className="better-x-image-editor__stage"
              onDoubleClick={handleStageDoubleClick}
              onPointerCancel={finishInteraction}
              onPointerDown={handleStagePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishInteraction}
              onWheel={handleWheel}
              ref={stageRef}
              role="application"
            >
              <canvas
                aria-label="Editable image canvas. Select and transform objects."
                className="better-x-image-editor__canvas"
                ref={canvasRef}
                style={canvasStyle}
                tabIndex={0}
              />
              {selectionStyle && selected ? (
                <div
                  className="better-x-image-editor__selection"
                  data-crop={String(isCropping)}
                  data-locked={String(selected.locked)}
                  style={selectionStyle}
                >
                  <span className="better-x-image-editor__selection-label">
                    {isCropping ? "Crop" : selected.name}
                  </span>
                  <button
                    aria-label="Rotate selected object"
                    className="better-x-image-editor__rotate-handle"
                    onPointerDown={startRotate}
                    type="button"
                  >
                    <ArrowClockwiseIcon
                      aria-hidden
                      className="better-x-image-editor__icon"
                      weight="bold"
                    />
                  </button>
                  {RESIZE_HANDLES.map((handle) => (
                    <button
                      aria-label={`Resize ${handle}`}
                      className={`better-x-image-editor__resize-handle better-x-image-editor__resize-handle--${handle}`}
                      key={handle}
                      onPointerDown={(event) => startResize(event, handle)}
                      type="button"
                    />
                  ))}
                </div>
              ) : null}
              <span className="better-x-image-editor__loading">
                {errorMessage || "Opening image…"}
              </span>
            </div>

            <Elevated
              className="better-x-image-editor__history"
              data-name="LiquidEditorHistory"
              offset={2}
              shadowLevel={false}
            >
              <Button
                aria-label="Close image editor"
                className="better-x-image-editor__close"
                onClick={() => closeEditor()}
                ref={closeButtonRef}
                size="icon-sm"
                title="Close"
                type="button"
                variant="ghost"
              >
                <XIcon
                  aria-hidden
                  className="better-x-image-editor__icon"
                  weight="bold"
                />
              </Button>
              <Button
                aria-label="Undo"
                className="better-x-image-editor__undo"
                disabled={documentState.historyIndex <= 0 || isCropping}
                onClick={undo}
                size="icon-sm"
                title="Undo"
                type="button"
                variant="ghost"
              >
                <ArrowCounterClockwiseIcon
                  aria-hidden
                  className="better-x-image-editor__icon"
                  weight="bold"
                />
              </Button>
              <Button
                aria-label="Redo"
                className="better-x-image-editor__redo"
                disabled={
                  documentState.historyIndex < 0 ||
                  documentState.historyIndex >=
                    documentState.history.length - 1 ||
                  isCropping
                }
                onClick={redo}
                size="icon-sm"
                title="Redo"
                type="button"
                variant="ghost"
              >
                <ArrowClockwiseIcon
                  aria-hidden
                  className="better-x-image-editor__icon"
                  weight="bold"
                />
              </Button>
            </Elevated>

            <Elevated
              className="better-x-image-editor__toolbar"
              data-name="LiquidEditorToolbar"
              offset={2}
              shadowLevel={false}
            >
              <nav aria-label="Image editor tools">
                {EDITOR_TOOLS.map((tool) => (
                  <ToolButton
                    currentTool={currentTool}
                    key={tool}
                    onSelect={selectTool}
                    tool={tool}
                  />
                ))}
                <Button
                  aria-label="Crop selected image"
                  aria-pressed={isCropping}
                  className="better-x-image-editor__tool better-x-image-editor__crop"
                  disabled={selected?.kind !== "image"}
                  onClick={toggleCropMode}
                  size="icon"
                  title="Crop selected image (C)"
                  type="button"
                  variant="ghost"
                >
                  <CropIcon
                    aria-hidden
                    className="better-x-image-editor__icon better-x-image-editor__tool-icon"
                    weight="regular"
                  />
                  <Kbd>C</Kbd>
                </Button>
              </nav>
            </Elevated>

            <Elevated
              className="better-x-image-editor__top-actions"
              data-name="LiquidEditorActions"
              offset={2}
              shadowLevel={false}
            >
              <LiquidMenuRoot
                anchor={getInspectorAnchor}
                anchorGeometry={INSPECTOR_ANCHOR_GEOMETRY}
                modal={false}
                onOpenChange={setIsInspectorOpen}
                open={isInspectorOpen}
              >
                <LiquidMenuTrigger
                  aria-label="Toggle object properties"
                  aria-pressed={isInspectorOpen}
                  className="better-x-image-editor__properties-trigger"
                  data-name="Button"
                  ref={inspectorTriggerRef}
                >
                  <SlidersHorizontalIcon
                    aria-hidden
                    className="better-x-image-editor__icon"
                    weight="regular"
                  />
                  Style
                </LiquidMenuTrigger>
                <LiquidMenuContent
                  align="end"
                  aria-label="Object properties"
                  className="better-x-image-editor__inspector-surface"
                  data-liquid-theme={getEditorLiquidTheme(session)}
                  portalKeepMounted
                  sideOffset={10}
                >
                  <LiquidMenuAutoSize>
                    {scene ? (
                      <ImageEditorInspector
                        isCropping={isCropping}
                        onCanvasPreset={applyCanvasPreset}
                        onCanvasUpdate={updateCanvas}
                        onCommit={commitScene}
                        onDelete={deleteSelected}
                        onDuplicate={duplicateSelected}
                        onReorder={reorderSelected}
                        onToggleCrop={toggleCropMode}
                        onUpdateBackground={updateBackground}
                        onUpdateSelected={updateSelected}
                        scene={scene}
                        selected={selected}
                      />
                    ) : null}
                  </LiquidMenuAutoSize>
                </LiquidMenuContent>
              </LiquidMenuRoot>

              <Button
                className="better-x-image-editor__apply"
                disabled={phase !== "ready"}
                onClick={() => applyEditor().catch(reportAsyncError)}
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
              shadowLevel={false}
            >
              <span
                aria-live="polite"
                className="better-x-image-editor__status"
                role="status"
              >
                {status}
              </span>
            </Elevated>
          </section>
        </LiquidMenuStackProvider>
      </SurfaceProvider>
    );
  }
);

interface MountedReactEditor {
  handle: ImageEditorHandle | null;
  host: HTMLElement;
  root: Root;
}

const createReactEditor = (): MountedReactEditor => {
  const host = document.createElement("better-x-image-editor");
  host.hidden = true;
  const mount = document.createElement("div");
  const portalContainer = document.createElement("div");
  portalContainer.className = "better-x-image-editor__portals";
  host.append(mount, portalContainer);
  document.body.append(host);
  const root = createRoot(mount);
  const editor: MountedReactEditor = { handle: null, host, root };
  flushSync(() => {
    root.render(
      createElement(ImageEditor, {
        host,
        portalContainer,
        ref: (handle: ImageEditorHandle | null) => {
          editor.handle = handle;
        },
      })
    );
  });
  return editor;
};

export function mountImageEditor(): MountedImageEditor {
  const editor = createReactEditor();
  let destroyed = false;

  const getHandle = (): ImageEditorHandle => {
    if (destroyed || !editor.handle) {
      throw new Error("The image editor is unavailable.");
    }
    return editor.handle;
  };

  return {
    close: () => getHandle().close(),
    destroy: () => {
      if (destroyed) {
        return;
      }
      editor.handle?.close(true);
      editor.root.unmount();
      editor.host.remove();
      destroyed = true;
      editor.handle = null;
    },
    open: (options) => getHandle().open(options),
  };
}
