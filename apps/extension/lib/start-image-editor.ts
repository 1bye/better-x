import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
  EDITOR_TOOL_DETAILS,
  mountImageEditorView,
} from "../components/image-editor-view";
import {
  type ArrowSceneObject,
  type BlurSceneObject,
  clamp,
  cloneScene,
  createInitialScene,
  type EditorTool,
  findSceneObjectAtPoint,
  getSceneObject,
  getSceneRenderLayout,
  getSnappedPosition,
  type ImageSceneObject,
  normalizeDegrees,
  panImageCrop,
  type RectangleSceneObject,
  type ResizeHandle,
  removeSceneObject,
  reorderSceneObject,
  resizeImageCrop,
  resizeSceneObject,
  type SceneDocument,
  type SceneObject,
  type ScenePoint,
  type SceneRenderLayout,
  scenePointToObject,
  type TextSceneObject,
  updateSceneObject,
  zoomImageCrop,
} from "./image-editor";

export const IMAGE_EDITOR_OPEN_ATTRIBUTE = "data-better-x-image-editor-open";

const EDITOR_RENDER_EDGE = 1600;
const EXPORT_EDGE = 4096;
const FILE_EXTENSION_PATTERN = /\.[^/.]+$/;
const IMAGE_INPUT_SELECTOR =
  'input[data-testid="fileInput"][type="file"], input[type="file"][accept*="image"]';
const PREVIEW_IMAGE_SELECTOR = '[data-testid="attachments"] img[src]';
const PREVIEW_REMOVE_SELECTOR =
  '[data-testid="removeMedia"], button[aria-label*="Remove"], button[aria-label*="remove"]';
const TEXTAREA_SELECTOR =
  '[data-testid^="tweetTextarea_"], [contenteditable="true"]';
const TEXT_WORD_PATTERN = /\s+/;

interface EditorSession {
  composer: HTMLElement | null;
  file: File;
  image: ImageBitmap;
  nativeInput: HTMLInputElement;
  replaceButton: HTMLButtonElement | null;
  returnFocus: HTMLElement | null;
}

interface OpenEditorOptions {
  file: File;
  nativeInput: HTMLInputElement;
  replaceButton: HTMLButtonElement | null;
  trigger: HTMLElement;
}

interface ReplaceablePreview {
  removeButton: HTMLButtonElement;
  root: HTMLElement;
}

interface BaseInteraction {
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

const createElement = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text) {
    element.textContent = text;
  }
  return element;
};

const createKbd = (key: string): HTMLElement => {
  const kbd = createElement("kbd", undefined, key);
  kbd.dataset.name = "Kbd";
  kbd.dataset.slot = "kbd";
  return kbd;
};

const createButton = ({
  className,
  key,
  label,
}: {
  className: string;
  key?: string;
  label: string;
}): HTMLButtonElement => {
  const button = createElement("button", className);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.append(
    createElement("span", "better-x-image-editor__button-label", label)
  );
  if (key) {
    button.append(createKbd(key));
  }
  return button;
};

const getComposer = (element: Element): HTMLElement | null => {
  const dialog = element.closest<HTMLElement>('[role="dialog"]');
  if (dialog) {
    return dialog;
  }
  let candidate = element.parentElement;
  while (candidate && candidate !== document.body) {
    if (
      candidate.querySelector(IMAGE_INPUT_SELECTOR) &&
      candidate.querySelector(TEXTAREA_SELECTOR)
    ) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
};

const findNativeInput = (element: Element): HTMLInputElement | null => {
  const composer = getComposer(element);
  const input =
    composer?.querySelector<HTMLInputElement>(IMAGE_INPUT_SELECTOR) ??
    document.querySelector<HTMLInputElement>(IMAGE_INPUT_SELECTOR);
  return input?.closest("better-x-image-editor") ? null : input;
};

const findReplaceablePreview = (
  image: HTMLImageElement
): ReplaceablePreview | null => {
  const attachments = image.closest<HTMLElement>('[data-testid="attachments"]');
  if (!attachments) {
    return null;
  }
  let root = image.parentElement;
  while (root && root !== attachments) {
    const removeButton = root.querySelector<HTMLButtonElement>(
      PREVIEW_REMOVE_SELECTOR
    );
    if (removeButton && root.querySelectorAll("img").length === 1) {
      return { removeButton, root };
    }
    root = root.parentElement;
  }
  return null;
};

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

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

const getClientPoint = (event: PointerEvent | WheelEvent): ScenePoint => ({
  x: event.clientX,
  y: event.clientY,
});

const getObjectLabel = (object: SceneObject): string =>
  object.kind === "rectangle"
    ? "Rectangle"
    : object.kind[0]?.toUpperCase() + object.kind.slice(1);

const createRoundRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void => {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.max(0, radius));
};

class ImageEditor {
  private cropStartScene: SceneDocument | null = null;
  private currentTool: EditorTool = "select";
  private readonly ctx: ContentScriptContext;
  private readonly elements = mountImageEditorView();
  private history: SceneDocument[] = [];
  private historyIndex = -1;
  private readonly interactionState: { current: EditorInteraction | null } = {
    current: null,
  };
  private lastLayout: SceneRenderLayout | null = null;
  private objectSequence = 0;
  private readonly observer: MutationObserver;
  private openRequest = 0;
  private pan = { x: 0, y: 0 };
  private readonly picker = createElement("input");
  private scene: SceneDocument | null = null;
  private selectedId: string | null = null;
  private session: EditorSession | null = null;
  private viewScale = 1;

  constructor(ctx: ContentScriptContext) {
    this.ctx = ctx;
    this.picker.accept = "image/jpeg,image/png,image/webp";
    this.picker.className = "better-x-image-editor__picker";
    this.picker.type = "file";
    this.picker.setAttribute("aria-hidden", "true");
    this.elements.host.append(this.picker);
    this.observer = new MutationObserver(() => this.scanPage());
    this.bindControls();
  }

  start(): void {
    this.scanPage();
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.ctx.addEventListener(window, "keydown", this.handleKeyDown, {
      capture: true,
    });
    this.ctx.addEventListener(window, "pointermove", this.handlePointerMove, {
      capture: true,
    });
    this.ctx.addEventListener(window, "pointerup", this.handlePointerUp, {
      capture: true,
    });
    this.ctx.addEventListener(window, "resize", this.handleWindowResize);
    this.ctx.onInvalidated(() => this.destroy());
  }

  private bindControls(): void {
    const { elements } = this;
    elements.closeButton.addEventListener("click", () => this.close());
    elements.applyButton.addEventListener("click", () => {
      this.apply().catch((error: unknown) => window.reportError(error));
    });
    elements.undoButton.addEventListener("click", () => this.undo());
    elements.redoButton.addEventListener("click", () => this.redo());
    elements.cropButton.addEventListener("click", () => this.toggleCropMode());
    for (const [tool, button] of elements.toolButtons) {
      button.addEventListener("click", () => this.selectTool(tool));
    }
    for (const [handle, button] of elements.selectionHandles) {
      button.addEventListener("pointerdown", (event) => {
        this.startResize(event, handle);
      });
    }
    const rotateHandle = elements.selection.querySelector<HTMLButtonElement>(
      '[data-transform="rotate"]'
    );
    rotateHandle?.addEventListener("pointerdown", (event) =>
      this.startRotate(event)
    );
    elements.stage.addEventListener("pointerdown", this.handleStagePointerDown);
    elements.stage.addEventListener("dblclick", this.handleStageDoubleClick);
    elements.stage.addEventListener("wheel", this.handleWheel, {
      passive: false,
    });
  }

  private scanPage(): void {
    for (const input of document.querySelectorAll<HTMLInputElement>(
      IMAGE_INPUT_SELECTOR
    )) {
      this.addComposerTrigger(input);
    }
    for (const image of document.querySelectorAll<HTMLImageElement>(
      PREVIEW_IMAGE_SELECTOR
    )) {
      this.addPreviewTrigger(image);
    }
  }

  private addComposerTrigger(nativeInput: HTMLInputElement): void {
    if (
      nativeInput.dataset.betterXImageEditor ||
      nativeInput.closest("better-x-image-editor")
    ) {
      return;
    }
    const nativeControl =
      nativeInput.closest<HTMLElement>('label, [role="button"]') ??
      nativeInput.parentElement;
    if (!nativeControl?.parentElement) {
      return;
    }
    nativeInput.dataset.betterXImageEditor = "true";
    const trigger = createElement("button", "better-x-image-edit-trigger", "✦");
    trigger.type = "button";
    trigger.title = "Edit an image before posting";
    trigger.setAttribute("aria-label", "Edit an image before posting");
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.pickImage(nativeInput, trigger);
    });
    nativeControl.insertAdjacentElement("afterend", trigger);
  }

  private addPreviewTrigger(image: HTMLImageElement): void {
    if (image.dataset.betterXImageEditor) {
      return;
    }
    const preview = findReplaceablePreview(image);
    const nativeInput = findNativeInput(image);
    if (!(preview && nativeInput)) {
      return;
    }
    image.dataset.betterXImageEditor = "true";
    preview.root.dataset.betterXImagePreview = "true";
    const trigger = createElement(
      "button",
      "better-x-image-preview-edit",
      "Edit"
    );
    trigger.type = "button";
    trigger.setAttribute("aria-label", "Edit attached image");
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openPreview({
        image,
        nativeInput,
        removeButton: preview.removeButton,
        trigger,
      }).catch((error: unknown) => window.reportError(error));
    });
    preview.root.append(trigger);
  }

  private pickImage(
    nativeInput: HTMLInputElement,
    trigger: HTMLButtonElement
  ): void {
    this.picker.onchange = () => {
      const file = this.picker.files?.[0];
      this.picker.value = "";
      if (!file) {
        return;
      }
      this.open({
        file,
        nativeInput,
        replaceButton: null,
        trigger,
      }).catch((error: unknown) => window.reportError(error));
    };
    this.picker.click();
  }

  private async openPreview({
    image,
    nativeInput,
    removeButton,
    trigger,
  }: {
    image: HTMLImageElement;
    nativeInput: HTMLInputElement;
    removeButton: HTMLButtonElement;
    trigger: HTMLButtonElement;
  }): Promise<void> {
    const response = await fetch(image.currentSrc || image.src);
    if (!response.ok) {
      throw new Error("The attached image could not be opened.");
    }
    const blob = await response.blob();
    const type = getOutputType(blob.type);
    await this.open({
      file: new File([blob], `image.${getFileExtension(type)}`, { type }),
      nativeInput,
      replaceButton: removeButton,
      trigger,
    });
  }

  private async open(options: OpenEditorOptions): Promise<void> {
    this.openRequest += 1;
    const request = this.openRequest;
    this.session?.image.close();
    this.resetEditor();
    this.elements.host.hidden = false;
    this.elements.host.dataset.loading = "true";
    delete this.elements.host.dataset.error;
    document.documentElement.setAttribute(IMAGE_EDITOR_OPEN_ATTRIBUTE, "true");
    this.elements.loading.textContent = "Opening image…";
    this.elements.status.textContent = "Opening image…";
    this.elements.applyButton.disabled = true;
    this.elements.closeButton.focus();

    try {
      const image = await createImageBitmap(options.file);
      if (request !== this.openRequest) {
        image.close();
        return;
      }
      this.session = {
        composer: getComposer(options.nativeInput),
        file: options.file,
        image,
        nativeInput: options.nativeInput,
        replaceButton: options.replaceButton,
        returnFocus: options.trigger,
      };
      this.scene = createInitialScene(image.width, image.height);
      this.history = [cloneScene(this.scene)];
      this.historyIndex = 0;
      this.selectedId = "image";
      delete this.elements.host.dataset.loading;
      this.elements.applyButton.disabled = false;
      this.renderAll();
      this.ctx.requestAnimationFrame(() => {
        this.fitView();
        this.elements.canvas.focus();
      });
    } catch (error) {
      if (request !== this.openRequest) {
        return;
      }
      delete this.elements.host.dataset.loading;
      this.elements.host.dataset.error = "true";
      this.elements.loading.textContent = "This image could not be opened.";
      this.elements.status.textContent = "This image could not be opened.";
      window.reportError(error);
    }
  }

  private resetEditor(): void {
    this.cropStartScene = null;
    this.currentTool = "select";
    this.history = [];
    this.historyIndex = -1;
    this.interactionState.current = null;
    this.lastLayout = null;
    this.objectSequence = 0;
    this.pan = { x: 0, y: 0 };
    this.scene = null;
    this.selectedId = null;
    this.session = null;
    this.viewScale = 1;
  }

  private close(): void {
    this.openRequest += 1;
    const returnFocus = this.session?.returnFocus;
    this.session?.image.close();
    this.resetEditor();
    this.elements.host.hidden = true;
    delete this.elements.host.dataset.loading;
    delete this.elements.host.dataset.error;
    document.documentElement.removeAttribute(IMAGE_EDITOR_OPEN_ATTRIBUTE);
    if (returnFocus?.isConnected) {
      returnFocus.focus();
    }
  }

  private renderAll(): void {
    this.renderCanvas();
    this.renderInspector();
    this.updateChrome();
  }

  private renderCanvas(): void {
    const { scene } = this;
    if (!(scene && this.session)) {
      return;
    }
    this.lastLayout = this.drawScene(
      this.elements.canvas,
      scene,
      EDITOR_RENDER_EDGE
    );
    this.applyView();
    this.updateSelection();
  }

  private drawScene(
    canvas: HTMLCanvasElement,
    scene: SceneDocument,
    maxEdge: number
  ): SceneRenderLayout {
    const layout = getSceneRenderLayout(scene, maxEdge);
    canvas.width = layout.canvasWidth;
    canvas.height = layout.canvasHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("The browser does not support image editing.");
    }
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (scene.background.enabled) {
      context.fillStyle = this.createBackground(context, scene, layout);
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.shadowBlur = scene.background.shadow * layout.scale;
      context.shadowColor = "rgb(0 0 0 / 42%)";
      context.shadowOffsetY = scene.background.shadow * layout.scale * 0.3;
      context.fillStyle = "#fff";
      createRoundRect(
        context,
        layout.x,
        layout.y,
        layout.width,
        layout.height,
        scene.background.radius * layout.scale
      );
      context.fill();
      context.restore();
      context.save();
      createRoundRect(
        context,
        layout.x,
        layout.y,
        layout.width,
        layout.height,
        scene.background.radius * layout.scale
      );
      context.clip();
      this.drawObjects(context, canvas, scene, layout);
      context.restore();
    } else {
      this.drawObjects(context, canvas, scene, layout);
    }
    return layout;
  }

  private createBackground(
    context: CanvasRenderingContext2D,
    scene: SceneDocument,
    layout: SceneRenderLayout
  ): string | CanvasGradient {
    if (scene.background.type === "solid") {
      return scene.background.color;
    }
    const radians = (scene.background.angle * Math.PI) / 180;
    const centerX = layout.canvasWidth / 2;
    const centerY = layout.canvasHeight / 2;
    const radius = Math.hypot(layout.canvasWidth, layout.canvasHeight) / 2;
    const gradient = context.createLinearGradient(
      centerX - Math.cos(radians) * radius,
      centerY - Math.sin(radians) * radius,
      centerX + Math.cos(radians) * radius,
      centerY + Math.sin(radians) * radius
    );
    gradient.addColorStop(0, scene.background.color);
    gradient.addColorStop(1, scene.background.color2);
    return gradient;
  }

  private drawObjects(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    scene: SceneDocument,
    layout: SceneRenderLayout
  ): void {
    for (const object of scene.objects) {
      if (!object.visible) {
        continue;
      }
      if (object.kind === "blur") {
        this.drawBlurObject(context, canvas, layout, object);
      } else {
        this.drawObject(context, layout, object);
      }
    }
  }

  private drawObject(
    context: CanvasRenderingContext2D,
    layout: SceneRenderLayout,
    object: Exclude<SceneObject, BlurSceneObject>
  ): void {
    context.save();
    context.translate(
      layout.x + object.x * layout.scale,
      layout.y + object.y * layout.scale
    );
    context.rotate((object.rotation * Math.PI) / 180);
    context.scale(layout.scale, layout.scale);
    context.globalAlpha = object.opacity;

    if (object.kind === "image") {
      this.drawImageObject(context, object);
    } else if (object.kind === "text") {
      this.drawTextObject(context, object);
    } else if (object.kind === "rectangle") {
      this.drawRectangleObject(context, object);
    } else {
      this.drawArrowObject(context, object);
    }
    context.restore();
  }

  private drawImageObject(
    context: CanvasRenderingContext2D,
    object: ImageSceneObject
  ): void {
    const image = this.session?.image;
    if (!image) {
      return;
    }
    context.save();
    createRoundRect(
      context,
      -object.width / 2,
      -object.height / 2,
      object.width,
      object.height,
      object.radius
    );
    context.clip();
    context.filter = `brightness(${object.brightness}%) contrast(${object.contrast}%) saturate(${object.saturation}%)`;
    context.drawImage(
      image,
      object.crop.x * image.width,
      object.crop.y * image.height,
      object.crop.width * image.width,
      object.crop.height * image.height,
      -object.width / 2,
      -object.height / 2,
      object.width,
      object.height
    );
    context.restore();
  }

  private drawRectangleObject(
    context: CanvasRenderingContext2D,
    object: RectangleSceneObject
  ): void {
    createRoundRect(
      context,
      -object.width / 2,
      -object.height / 2,
      object.width,
      object.height,
      object.radius
    );
    context.fillStyle = object.fill;
    context.fill();
    if (object.strokeWidth > 0) {
      context.lineWidth = object.strokeWidth;
      context.strokeStyle = object.stroke;
      context.stroke();
    }
  }

  private drawArrowObject(
    context: CanvasRenderingContext2D,
    object: ArrowSceneObject
  ): void {
    const head = Math.max(12, object.strokeWidth * 4.5);
    context.beginPath();
    context.moveTo(-object.width / 2, 0);
    context.lineTo(object.width / 2, 0);
    context.moveTo(object.width / 2, 0);
    context.lineTo(object.width / 2 - head, -head * 0.55);
    context.moveTo(object.width / 2, 0);
    context.lineTo(object.width / 2 - head, head * 0.55);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = object.strokeWidth;
    context.shadowBlur = object.strokeWidth;
    context.shadowColor = "rgb(0 0 0 / 40%)";
    context.strokeStyle = object.stroke;
    context.stroke();
  }

  private drawTextObject(
    context: CanvasRenderingContext2D,
    object: TextSceneObject
  ): void {
    if (object.background !== "transparent") {
      context.fillStyle = object.background;
      createRoundRect(
        context,
        -object.width / 2,
        -object.height / 2,
        object.width,
        object.height,
        Math.min(18, object.fontSize * 0.35)
      );
      context.fill();
    }
    const lines = this.wrapText(context, object);
    const lineHeight = object.fontSize * object.lineHeight;
    const textHeight = lines.length * lineHeight;
    let x = -object.width / 2;
    if (object.align === "center") {
      x = 0;
    } else if (object.align === "right") {
      x = object.width / 2;
    }
    let y = -textHeight / 2 + object.fontSize;
    context.font = `${object.fontWeight} ${object.fontSize}px ${object.fontFamily}`;
    context.textAlign = object.align;
    context.textBaseline = "alphabetic";
    context.fillStyle = object.color;
    context.shadowBlur = object.shadow;
    context.shadowColor = "rgb(0 0 0 / 46%)";
    for (const line of lines) {
      this.fillSpacedText(context, line, x, y, object.letterSpacing);
      y += lineHeight;
    }
  }

  private wrapText(
    context: CanvasRenderingContext2D,
    object: TextSceneObject
  ): readonly string[] {
    context.font = `${object.fontWeight} ${object.fontSize}px ${object.fontFamily}`;
    const lines: string[] = [];
    for (const paragraph of object.text.split("\n")) {
      const words = paragraph.split(TEXT_WORD_PATTERN);
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        const width =
          context.measureText(candidate).width +
          Math.max(0, candidate.length - 1) * object.letterSpacing;
        if (line && width > object.width) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  private fillSpacedText(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    letterSpacing: number
  ): void {
    if (!letterSpacing) {
      context.fillText(text, x, y);
      return;
    }
    const widths = [...text].map(
      (character) => context.measureText(character).width
    );
    const totalWidth =
      widths.reduce((sum, width) => sum + width, 0) +
      Math.max(0, text.length - 1) * letterSpacing;
    let cursor = x;
    if (context.textAlign === "center") {
      cursor -= totalWidth / 2;
    } else if (context.textAlign === "right") {
      cursor -= totalWidth;
    }
    const characters = [...text];
    for (const [index, character] of characters.entries()) {
      context.fillText(character, cursor, y);
      cursor += (widths[index] ?? 0) + letterSpacing;
    }
  }

  private drawBlurObject(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    layout: SceneRenderLayout,
    object: BlurSceneObject
  ): void {
    const snapshot = document.createElement("canvas");
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
    context.save();
    context.translate(
      layout.x + object.x * layout.scale,
      layout.y + object.y * layout.scale
    );
    context.rotate((object.rotation * Math.PI) / 180);
    context.scale(layout.scale, layout.scale);
    context.globalAlpha = object.opacity;
    context.beginPath();
    context.rect(
      -object.width / 2,
      -object.height / 2,
      object.width,
      object.height
    );
    context.clip();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.filter = `blur(${object.strength * layout.scale}px)`;
    context.drawImage(snapshot, 0, 0);
    context.restore();
  }

  private applyView(): void {
    const { canvas } = this.elements;
    canvas.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.viewScale})`;
  }

  private fitView(): void {
    if (!(this.scene && this.lastLayout)) {
      return;
    }
    const bounds = this.elements.stage.getBoundingClientRect();
    const availableWidth = Math.max(1, bounds.width - 48);
    const availableHeight = Math.max(1, bounds.height - 48);
    this.viewScale = clamp(
      Math.min(
        availableWidth / this.lastLayout.canvasWidth,
        availableHeight / this.lastLayout.canvasHeight
      ),
      0.05,
      4
    );
    this.pan = {
      x: (bounds.width - this.lastLayout.canvasWidth * this.viewScale) / 2,
      y: (bounds.height - this.lastLayout.canvasHeight * this.viewScale) / 2,
    };
    this.applyView();
    this.updateSelection();
  }

  private clientToScene(point: ScenePoint): ScenePoint | null {
    const layout = this.lastLayout;
    if (!layout) {
      return null;
    }
    const bounds = this.elements.stage.getBoundingClientRect();
    const canvasX = (point.x - bounds.left - this.pan.x) / this.viewScale;
    const canvasY = (point.y - bounds.top - this.pan.y) / this.viewScale;
    return {
      x: (canvasX - layout.x) / layout.scale,
      y: (canvasY - layout.y) / layout.scale,
    };
  }

  private sceneToStage(point: ScenePoint): ScenePoint | null {
    const layout = this.lastLayout;
    if (!layout) {
      return null;
    }
    return {
      x: this.pan.x + (layout.x + point.x * layout.scale) * this.viewScale,
      y: this.pan.y + (layout.y + point.y * layout.scale) * this.viewScale,
    };
  }

  private updateSelection(): void {
    const { scene } = this;
    const object = scene ? getSceneObject(scene, this.selectedId) : null;
    const center = object
      ? this.sceneToStage({ x: object.x, y: object.y })
      : null;
    if (!(object?.visible && center && this.lastLayout)) {
      this.elements.selection.hidden = true;
      return;
    }
    const factor = this.lastLayout.scale * this.viewScale;
    const { selection } = this.elements;
    selection.hidden = false;
    selection.dataset.crop = String(this.isCropping());
    selection.dataset.locked = String(object.locked);
    selection.style.left = `${center.x - (object.width * factor) / 2}px`;
    selection.style.top = `${center.y - (object.height * factor) / 2}px`;
    selection.style.width = `${object.width * factor}px`;
    selection.style.height = `${object.height * factor}px`;
    selection.style.transform = `rotate(${object.rotation}deg)`;
    const label = selection.querySelector<HTMLElement>(
      ".better-x-image-editor__selection-label"
    );
    if (label) {
      label.textContent = this.isCropping() ? "Crop" : object.name;
    }
  }

  private renderInspector(): void {
    const { inspector } = this.elements;
    const { scene } = this;
    if (!scene) {
      inspector.replaceChildren();
      return;
    }
    const selected = getSceneObject(scene, this.selectedId);
    const title = createElement(
      "header",
      "better-x-image-editor__inspector-header"
    );
    title.append(
      createElement("strong", undefined, selected ? selected.name : "Canvas"),
      createElement(
        "span",
        undefined,
        selected ? getObjectLabel(selected) : "Document"
      )
    );
    const content = createElement(
      "div",
      "better-x-image-editor__inspector-content"
    );
    if (selected) {
      this.appendObjectInspector(content, selected);
      this.appendTransformInspector(content, selected);
      this.appendObjectActions(content, selected);
    } else {
      this.appendCanvasInspector(content, scene);
    }
    inspector.replaceChildren(title, content);
  }

  private createInspectorSection(
    title: string,
    open = true
  ): HTMLDetailsElement {
    const section = createElement(
      "details",
      "better-x-image-editor__inspector-section"
    );
    section.open = open;
    section.append(createElement("summary", undefined, title));
    return section;
  }

  private appendField(
    section: HTMLElement,
    label: string,
    control: HTMLElement
  ): void {
    const field = createElement("label", "better-x-image-editor__field");
    field.append(createElement("span", undefined, label), control);
    section.append(field);
  }

  private createNumberInput({
    label,
    maximum,
    minimum,
    onValue,
    step = 1,
    value,
  }: {
    label: string;
    maximum?: number;
    minimum?: number;
    onValue: (value: number) => void;
    step?: number;
    value: number;
  }): HTMLInputElement {
    const input = createElement("input", "better-x-image-editor__input");
    input.setAttribute("aria-label", label);
    input.type = "number";
    input.value = String(Number(value.toFixed(2)));
    input.step = String(step);
    if (minimum !== undefined) {
      input.min = String(minimum);
    }
    if (maximum !== undefined) {
      input.max = String(maximum);
    }
    input.addEventListener("input", () => {
      const next = Number(input.value);
      if (Number.isFinite(next)) {
        onValue(next);
      }
    });
    input.addEventListener("change", () => this.commitScene());
    return input;
  }

  private createRangeInput({
    label,
    maximum,
    minimum,
    onValue,
    step = 1,
    value,
  }: {
    label: string;
    maximum: number;
    minimum: number;
    onValue: (value: number) => void;
    step?: number;
    value: number;
  }): HTMLElement {
    const group = createElement("span", "better-x-image-editor__range-control");
    const range = createElement("input");
    range.setAttribute("aria-label", label);
    range.max = String(maximum);
    range.min = String(minimum);
    range.step = String(step);
    range.type = "range";
    range.value = String(value);
    const output = createElement("output", undefined, String(value));
    range.addEventListener("input", () => {
      const next = Number(range.value);
      output.value = String(next);
      onValue(next);
    });
    range.addEventListener("change", () => this.commitScene());
    group.append(range, output);
    return group;
  }

  private createColorInput(
    label: string,
    value: string,
    onValue: (value: string) => void
  ): HTMLInputElement {
    const input = createElement("input", "better-x-image-editor__color");
    input.setAttribute("aria-label", label);
    input.type = "color";
    input.value = value.slice(0, 7);
    input.addEventListener("input", () => onValue(input.value));
    input.addEventListener("change", () => this.commitScene());
    return input;
  }

  private createSelect(
    label: string,
    value: string,
    options: readonly { label: string; value: string }[],
    onValue: (value: string) => void
  ): HTMLSelectElement {
    const select = createElement("select", "better-x-image-editor__select");
    select.setAttribute("aria-label", label);
    for (const option of options) {
      const element = createElement("option", undefined, option.label);
      element.value = option.value;
      select.append(element);
    }
    select.value = value;
    select.addEventListener("change", () => {
      onValue(select.value);
      this.commitScene();
    });
    return select;
  }

  private createToggle(
    label: string,
    checked: boolean,
    onValue: (value: boolean) => void
  ): HTMLInputElement {
    const input = createElement("input", "better-x-image-editor__toggle");
    input.setAttribute("aria-label", label);
    input.checked = checked;
    input.type = "checkbox";
    input.addEventListener("change", () => {
      onValue(input.checked);
      this.commitScene();
    });
    return input;
  }

  private appendTransformInspector(
    content: HTMLElement,
    object: SceneObject
  ): void {
    const section = this.createInspectorSection("Transform", false);
    const grid = createElement("div", "better-x-image-editor__field-grid");
    const values: {
      key: "height" | "rotation" | "width" | "x" | "y";
      label: string;
      minimum?: number;
    }[] = [
      { key: "x", label: "X" },
      { key: "y", label: "Y" },
      { key: "width", label: "W", minimum: 12 },
      { key: "height", label: "H", minimum: 12 },
      { key: "rotation", label: "°" },
    ];
    for (const entry of values) {
      this.appendField(
        grid,
        entry.label,
        this.createNumberInput({
          label: entry.label,
          minimum: entry.minimum,
          onValue: (value) =>
            this.updateSelected((candidate) => ({
              ...candidate,
              [entry.key]: value,
            })),
          value: object[entry.key],
        })
      );
    }
    section.append(grid);
    this.appendField(
      section,
      "Opacity",
      this.createRangeInput({
        label: "Opacity",
        maximum: 100,
        minimum: 0,
        onValue: (value) =>
          this.updateSelected((candidate) => ({
            ...candidate,
            opacity: value / 100,
          })),
        value: Math.round(object.opacity * 100),
      })
    );
    content.append(section);
  }

  private appendObjectInspector(
    content: HTMLElement,
    object: SceneObject
  ): void {
    if (object.kind === "image") {
      this.appendImageInspector(content, object);
    } else if (object.kind === "text") {
      this.appendTextInspector(content, object);
    } else if (object.kind === "rectangle") {
      this.appendRectangleInspector(content, object);
    } else if (object.kind === "arrow") {
      this.appendArrowInspector(content, object);
    } else {
      this.appendBlurInspector(content, object);
    }
  }

  private appendImageInspector(
    content: HTMLElement,
    object: ImageSceneObject
  ): void {
    const section = this.createInspectorSection("Image");
    const crop = createButton({
      className: "better-x-image-editor__inspector-action",
      key: "C",
      label: this.isCropping() ? "Finish crop" : "Crop image",
    });
    crop.addEventListener("click", () => this.toggleCropMode());
    section.append(crop);
    this.appendField(
      section,
      "Corner radius",
      this.createRangeInput({
        label: "Image corner radius",
        maximum: Math.round(Math.min(object.width, object.height) / 2),
        minimum: 0,
        onValue: (value) =>
          this.updateSelected((candidate) =>
            candidate.kind === "image"
              ? { ...candidate, radius: value }
              : candidate
          ),
        value: Math.round(object.radius),
      })
    );
    for (const [label, key] of [
      ["Brightness", "brightness"],
      ["Contrast", "contrast"],
      ["Saturation", "saturation"],
    ] as const) {
      this.appendField(
        section,
        label,
        this.createRangeInput({
          label,
          maximum: 200,
          minimum: 0,
          onValue: (value) =>
            this.updateSelected((candidate) =>
              candidate.kind === "image"
                ? { ...candidate, [key]: value }
                : candidate
            ),
          value: object[key],
        })
      );
    }
    content.append(section);
  }

  private appendTextInspector(
    content: HTMLElement,
    object: TextSceneObject
  ): void {
    const section = this.createInspectorSection("Text");
    const textarea = createElement(
      "textarea",
      "better-x-image-editor__textarea"
    );
    textarea.setAttribute("aria-label", "Text content");
    textarea.rows = 3;
    textarea.value = object.text;
    textarea.addEventListener("input", () =>
      this.updateSelected((candidate) =>
        candidate.kind === "text"
          ? { ...candidate, text: textarea.value }
          : candidate
      )
    );
    textarea.addEventListener("change", () => this.commitScene());
    section.append(textarea);
    this.appendField(
      section,
      "Font",
      this.createSelect(
        "Font family",
        object.fontFamily,
        [
          { label: "Twitter Chirp", value: "TwitterChirp, Inter, sans-serif" },
          { label: "System Sans", value: "Inter, -apple-system, sans-serif" },
          { label: "Georgia", value: "Georgia, serif" },
          {
            label: "Monospace",
            value: "ui-monospace, SFMono-Regular, monospace",
          },
        ],
        (value) =>
          this.updateSelected((candidate) =>
            candidate.kind === "text"
              ? { ...candidate, fontFamily: value }
              : candidate
          )
      )
    );
    const row = createElement("div", "better-x-image-editor__field-grid");
    this.appendField(
      row,
      "Size",
      this.createNumberInput({
        label: "Font size",
        maximum: 500,
        minimum: 6,
        onValue: (value) =>
          this.updateSelected((candidate) =>
            candidate.kind === "text"
              ? { ...candidate, fontSize: value }
              : candidate
          ),
        value: object.fontSize,
      })
    );
    this.appendField(
      row,
      "Weight",
      this.createSelect(
        "Font weight",
        String(object.fontWeight),
        [
          { label: "Regular", value: "400" },
          { label: "Medium", value: "500" },
          { label: "Semibold", value: "600" },
          { label: "Bold", value: "700" },
          { label: "Black", value: "900" },
        ],
        (value) =>
          this.updateSelected((candidate) =>
            candidate.kind === "text"
              ? { ...candidate, fontWeight: Number(value) }
              : candidate
          )
      )
    );
    section.append(row);
    this.appendField(
      section,
      "Line height",
      this.createRangeInput({
        label: "Line height",
        maximum: 2,
        minimum: 0.7,
        onValue: (value) =>
          this.updateSelected((candidate) =>
            candidate.kind === "text"
              ? { ...candidate, lineHeight: value }
              : candidate
          ),
        step: 0.05,
        value: object.lineHeight,
      })
    );
    this.appendField(
      section,
      "Letter spacing",
      this.createRangeInput({
        label: "Letter spacing",
        maximum: 40,
        minimum: -10,
        onValue: (value) =>
          this.updateSelected((candidate) =>
            candidate.kind === "text"
              ? { ...candidate, letterSpacing: value }
              : candidate
          ),
        step: 0.5,
        value: object.letterSpacing,
      })
    );
    this.appendField(
      section,
      "Align",
      this.createSelect(
        "Text alignment",
        object.align,
        [
          { label: "Left", value: "left" },
          { label: "Center", value: "center" },
          { label: "Right", value: "right" },
        ],
        (value) => {
          const align: CanvasTextAlign =
            value === "center" || value === "right" ? value : "left";
          this.updateSelected((candidate) =>
            candidate.kind === "text" ? { ...candidate, align } : candidate
          );
        }
      )
    );
    this.appendField(
      section,
      "Color",
      this.createColorInput("Text color", object.color, (value) =>
        this.updateSelected((candidate) =>
          candidate.kind === "text" ? { ...candidate, color: value } : candidate
        )
      )
    );
    const hasBackground = object.background !== "transparent";
    this.appendField(
      section,
      "Background",
      this.createToggle("Text background", hasBackground, (enabled) =>
        this.updateSelected((candidate) =>
          candidate.kind === "text"
            ? {
                ...candidate,
                background: enabled ? "#0f1419" : "transparent",
              }
            : candidate
        )
      )
    );
    if (hasBackground) {
      this.appendField(
        section,
        "Background color",
        this.createColorInput(
          "Text background color",
          object.background,
          (value) =>
            this.updateSelected((candidate) =>
              candidate.kind === "text"
                ? { ...candidate, background: value }
                : candidate
            )
        )
      );
    }
    this.appendField(
      section,
      "Shadow",
      this.createRangeInput({
        label: "Text shadow",
        maximum: 80,
        minimum: 0,
        onValue: (value) =>
          this.updateSelected((candidate) =>
            candidate.kind === "text"
              ? { ...candidate, shadow: value }
              : candidate
          ),
        value: object.shadow,
      })
    );
    content.append(section);
  }

  private appendRectangleInspector(
    content: HTMLElement,
    object: RectangleSceneObject
  ): void {
    const section = this.createInspectorSection("Rectangle");
    this.appendField(
      section,
      "Fill",
      this.createColorInput("Rectangle fill", object.fill, (value) =>
        this.updateSelected((candidate) =>
          candidate.kind === "rectangle"
            ? { ...candidate, fill: value }
            : candidate
        )
      )
    );
    this.appendField(
      section,
      "Stroke",
      this.createColorInput("Rectangle stroke", object.stroke, (value) =>
        this.updateSelected((candidate) =>
          candidate.kind === "rectangle"
            ? { ...candidate, stroke: value }
            : candidate
        )
      )
    );
    this.appendField(
      section,
      "Stroke width",
      this.createRangeInput({
        label: "Rectangle stroke width",
        maximum: 40,
        minimum: 0,
        onValue: (value) =>
          this.updateSelected((candidate) =>
            candidate.kind === "rectangle"
              ? { ...candidate, strokeWidth: value }
              : candidate
          ),
        value: object.strokeWidth,
      })
    );
    this.appendField(
      section,
      "Radius",
      this.createRangeInput({
        label: "Rectangle radius",
        maximum: Math.round(Math.min(object.width, object.height) / 2),
        minimum: 0,
        onValue: (value) =>
          this.updateSelected((candidate) =>
            candidate.kind === "rectangle"
              ? { ...candidate, radius: value }
              : candidate
          ),
        value: object.radius,
      })
    );
    content.append(section);
  }

  private appendArrowInspector(
    content: HTMLElement,
    object: ArrowSceneObject
  ): void {
    const section = this.createInspectorSection("Arrow");
    this.appendField(
      section,
      "Color",
      this.createColorInput("Arrow color", object.stroke, (value) =>
        this.updateSelected((candidate) =>
          candidate.kind === "arrow"
            ? { ...candidate, stroke: value }
            : candidate
        )
      )
    );
    this.appendField(
      section,
      "Width",
      this.createRangeInput({
        label: "Arrow stroke width",
        maximum: 40,
        minimum: 1,
        onValue: (value) =>
          this.updateSelected((candidate) =>
            candidate.kind === "arrow"
              ? { ...candidate, strokeWidth: value }
              : candidate
          ),
        value: object.strokeWidth,
      })
    );
    content.append(section);
  }

  private appendBlurInspector(
    content: HTMLElement,
    object: BlurSceneObject
  ): void {
    const section = this.createInspectorSection("Blur");
    this.appendField(
      section,
      "Strength",
      this.createRangeInput({
        label: "Blur strength",
        maximum: 80,
        minimum: 2,
        onValue: (value) =>
          this.updateSelected((candidate) =>
            candidate.kind === "blur"
              ? { ...candidate, strength: value }
              : candidate
          ),
        value: object.strength,
      })
    );
    content.append(section);
  }

  private appendObjectActions(content: HTMLElement, object: SceneObject): void {
    const section = this.createInspectorSection("Arrange", false);
    const actions = createElement(
      "div",
      "better-x-image-editor__inspector-actions"
    );
    const details = [
      { action: () => this.reorderSelected(1), label: "Bring forward" },
      { action: () => this.reorderSelected(-1), label: "Send backward" },
      { action: () => this.duplicateSelected(), label: "Duplicate" },
      { action: () => this.deleteSelected(), label: "Delete" },
    ];
    for (const detail of details) {
      const button = createButton({
        className: "better-x-image-editor__inspector-action",
        label: detail.label,
      });
      button.addEventListener("click", detail.action);
      actions.append(button);
    }
    const lock = this.createToggle("Lock object", object.locked, (locked) =>
      this.updateSelected((candidate) => ({ ...candidate, locked }))
    );
    this.appendField(section, "Locked", lock);
    section.append(actions);
    content.append(section);
  }

  private appendCanvasInspector(
    content: HTMLElement,
    scene: SceneDocument
  ): void {
    const canvasSection = this.createInspectorSection("Canvas");
    const presets = createElement("div", "better-x-image-editor__preset-grid");
    for (const preset of [
      { label: "Original", ratio: null },
      { label: "1:1", ratio: 1 },
      { label: "4:5", ratio: 4 / 5 },
      { label: "16:9", ratio: 16 / 9 },
    ]) {
      const button = createButton({
        className: "better-x-image-editor__preset",
        label: preset.label,
      });
      button.addEventListener("click", () =>
        this.applyCanvasPreset(preset.ratio)
      );
      presets.append(button);
    }
    canvasSection.append(presets);
    const sizeGrid = createElement("div", "better-x-image-editor__field-grid");
    this.appendField(
      sizeGrid,
      "Width",
      this.createNumberInput({
        label: "Canvas width",
        maximum: 16_384,
        minimum: 64,
        onValue: (width) => this.updateCanvas({ width }),
        value: scene.width,
      })
    );
    this.appendField(
      sizeGrid,
      "Height",
      this.createNumberInput({
        label: "Canvas height",
        maximum: 16_384,
        minimum: 64,
        onValue: (height) => this.updateCanvas({ height }),
        value: scene.height,
      })
    );
    canvasSection.append(sizeGrid);
    content.append(canvasSection);

    const background = this.createInspectorSection("Background");
    this.appendField(
      background,
      "Presentation",
      this.createToggle(
        "Presentation background",
        scene.background.enabled,
        (enabled) => this.updateBackground({ enabled }, true)
      )
    );
    if (scene.background.enabled) {
      this.appendField(
        background,
        "Style",
        this.createSelect(
          "Background style",
          scene.background.type,
          [
            { label: "Gradient", value: "gradient" },
            { label: "Solid", value: "solid" },
          ],
          (value) =>
            this.updateBackground({
              type: value === "solid" ? "solid" : "gradient",
            })
        )
      );
      this.appendField(
        background,
        "Color",
        this.createColorInput(
          "Background color",
          scene.background.color,
          (color) => this.updateBackground({ color })
        )
      );
      if (scene.background.type === "gradient") {
        this.appendField(
          background,
          "Second color",
          this.createColorInput(
            "Background second color",
            scene.background.color2,
            (color2) => this.updateBackground({ color2 })
          )
        );
        this.appendField(
          background,
          "Angle",
          this.createRangeInput({
            label: "Gradient angle",
            maximum: 360,
            minimum: 0,
            onValue: (angle) => this.updateBackground({ angle }),
            value: scene.background.angle,
          })
        );
      }
      for (const [label, key, maximum] of [
        [
          "Padding",
          "padding",
          Math.round(Math.min(scene.width, scene.height) / 2),
        ],
        ["Corner radius", "radius", 240],
        ["Shadow", "shadow", 160],
      ] as const) {
        this.appendField(
          background,
          label,
          this.createRangeInput({
            label,
            maximum,
            minimum: 0,
            onValue: (value) => this.updateBackground({ [key]: value }),
            value: scene.background[key],
          })
        );
      }
    }
    content.append(background);
  }

  private updateSelected(update: (object: SceneObject) => SceneObject): void {
    if (!(this.scene && this.selectedId)) {
      return;
    }
    this.scene = updateSceneObject(this.scene, this.selectedId, update);
    this.renderCanvas();
  }

  private updateCanvas(
    update: Partial<Pick<SceneDocument, "height" | "width">>
  ): void {
    if (!this.scene) {
      return;
    }
    this.scene = { ...this.scene, ...update };
    this.renderCanvas();
    this.ctx.requestAnimationFrame(() => this.fitView());
  }

  private updateBackground(
    update: Partial<SceneDocument["background"]>,
    refit = false
  ): void {
    if (!this.scene) {
      return;
    }
    this.scene = {
      ...this.scene,
      background: { ...this.scene.background, ...update },
    };
    this.renderCanvas();
    if (refit) {
      this.ctx.requestAnimationFrame(() => this.fitView());
    }
  }

  private applyCanvasPreset(ratio: number | null): void {
    if (!(this.scene && this.session)) {
      return;
    }
    const { width } = this.session.image;
    const height = ratio
      ? Math.round(width / ratio)
      : this.session.image.height;
    this.scene = { ...this.scene, height, width };
    this.commitScene();
    this.renderAll();
    this.ctx.requestAnimationFrame(() => this.fitView());
  }

  private commitScene(): void {
    if (!this.scene || this.isCropping()) {
      return;
    }
    const current = this.history[this.historyIndex];
    if (current && JSON.stringify(current) === JSON.stringify(this.scene)) {
      return;
    }
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(cloneScene(this.scene));
    this.historyIndex = this.history.length - 1;
    this.updateChrome();
  }

  private undo(): void {
    if (this.isCropping()) {
      this.cancelCropMode();
      return;
    }
    if (this.historyIndex <= 0) {
      return;
    }
    this.historyIndex -= 1;
    const scene = this.history[this.historyIndex];
    if (!scene) {
      return;
    }
    this.scene = cloneScene(scene);
    if (this.selectedId && !getSceneObject(this.scene, this.selectedId)) {
      this.selectedId = null;
    }
    this.renderAll();
  }

  private redo(): void {
    if (this.historyIndex >= this.history.length - 1) {
      return;
    }
    this.historyIndex += 1;
    const scene = this.history[this.historyIndex];
    if (!scene) {
      return;
    }
    this.scene = cloneScene(scene);
    this.renderAll();
  }

  private updateChrome(): void {
    const selected = this.scene
      ? getSceneObject(this.scene, this.selectedId)
      : null;
    for (const [tool, button] of this.elements.toolButtons) {
      button.setAttribute("aria-pressed", String(tool === this.currentTool));
    }
    this.elements.cropButton.disabled = selected?.kind !== "image";
    this.elements.cropButton.setAttribute(
      "aria-pressed",
      String(this.isCropping())
    );
    this.elements.undoButton.disabled =
      this.historyIndex <= 0 || this.isCropping();
    this.elements.redoButton.disabled =
      this.historyIndex < 0 ||
      this.historyIndex >= this.history.length - 1 ||
      this.isCropping();
    this.elements.host.dataset.crop = String(this.isCropping());
    if (this.isCropping()) {
      this.elements.status.textContent =
        "Drag the image to reposition. Resize handles change the crop. Scroll to zoom. Enter applies; Esc cancels.";
    } else if (selected?.locked) {
      this.elements.status.textContent =
        "This object is locked. Unlock it in Arrange to transform it.";
    } else if (selected) {
      this.elements.status.textContent =
        "Drag to move. Resize or rotate with handles. Click outside the canvas for canvas settings.";
    } else {
      this.elements.status.textContent =
        "Canvas selected. Adjust its size and background, or choose a tool to add an object.";
    }
  }

  private selectTool(tool: EditorTool): void {
    if (this.isCropping()) {
      this.finishCropMode();
    }
    this.currentTool = tool;
    this.updateChrome();
    this.elements.canvas.focus();
  }

  private selectObject(objectId: string | null): void {
    if (this.isCropping() && objectId !== this.selectedId) {
      this.finishCropMode();
    }
    this.selectedId = objectId;
    this.currentTool = "select";
    this.updateSelection();
    this.renderInspector();
    this.updateChrome();
  }

  private toggleCropMode(): void {
    if (this.isCropping()) {
      this.finishCropMode();
    } else {
      this.enterCropMode();
    }
  }

  private isCropping(): boolean {
    return this.cropStartScene !== null;
  }

  private enterCropMode(): void {
    const object = this.scene
      ? getSceneObject(this.scene, this.selectedId)
      : null;
    if (!(this.scene && object?.kind === "image")) {
      return;
    }
    this.cropStartScene = cloneScene(this.scene);
    this.currentTool = "select";
    this.renderAll();
  }

  private finishCropMode(): void {
    if (!this.isCropping()) {
      return;
    }
    this.cropStartScene = null;
    this.commitScene();
    this.renderAll();
  }

  private cancelCropMode(): void {
    if (!this.isCropping()) {
      return;
    }
    if (this.cropStartScene) {
      this.scene = cloneScene(this.cropStartScene);
    }
    this.cropStartScene = null;
    this.renderAll();
  }

  private startResize(event: PointerEvent, handle: ResizeHandle): void {
    const { scene } = this;
    const object = scene ? getSceneObject(scene, this.selectedId) : null;
    if (!(scene && object && !object.locked)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.interactionState.current =
      this.isCropping() && object.kind === "image"
        ? {
            handle,
            kind: "crop-resize",
            objectId: object.id,
            startClient: getClientPoint(event),
            startScene: cloneScene(scene),
          }
        : {
            handle,
            kind: "resize",
            objectId: object.id,
            startClient: getClientPoint(event),
            startScene: cloneScene(scene),
          };
  }

  private startRotate(event: PointerEvent): void {
    const { scene } = this;
    const object = scene ? getSceneObject(scene, this.selectedId) : null;
    const center = object
      ? this.sceneToStage({ x: object.x, y: object.y })
      : null;
    if (!(scene && object && center && !object.locked && !this.isCropping())) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const bounds = this.elements.stage.getBoundingClientRect();
    const centerClient = {
      x: bounds.left + center.x,
      y: bounds.top + center.y,
    };
    this.interactionState.current = {
      center: centerClient,
      kind: "rotate",
      objectId: object.id,
      startAngle: Math.atan2(
        event.clientY - centerClient.y,
        event.clientX - centerClient.x
      ),
      startClient: getClientPoint(event),
      startRotation: object.rotation,
      startScene: cloneScene(scene),
    };
  }

  private readonly handleStagePointerDown = (event: PointerEvent): void => {
    if (!this.scene) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (event.target === this.elements.stage) {
      this.selectObject(null);
      return;
    }
    if (event.target !== this.elements.canvas) {
      return;
    }
    const point = this.clientToScene(getClientPoint(event));
    if (!point) {
      return;
    }
    if (this.currentTool === "text") {
      this.addTextObject(point);
      return;
    }
    if (this.currentTool !== "select") {
      this.startCreate(event, point, this.currentTool);
      return;
    }
    const object = findSceneObjectAtPoint(this.scene, point);
    if (!object) {
      this.selectObject(null);
      return;
    }
    this.selectObject(object.id);
    if (object.locked) {
      return;
    }
    this.interactionState.current =
      this.isCropping() && object.kind === "image"
        ? {
            kind: "crop-pan",
            objectId: object.id,
            startClient: getClientPoint(event),
            startScene: cloneScene(this.scene),
          }
        : {
            kind: "move",
            objectId: object.id,
            startClient: getClientPoint(event),
            startScene: cloneScene(this.scene),
          };
  };

  private readonly handleStageDoubleClick = (event: MouseEvent): void => {
    if (!(this.scene && event.target === this.elements.canvas)) {
      return;
    }
    const point = this.clientToScene({ x: event.clientX, y: event.clientY });
    const object = point ? findSceneObjectAtPoint(this.scene, point) : null;
    if (object?.kind === "image") {
      this.selectObject(object.id);
      this.enterCropMode();
    }
  };

  private startCreate(
    event: PointerEvent,
    point: ScenePoint,
    tool: Exclude<EditorTool, "select" | "text">
  ): void {
    if (!this.scene) {
      return;
    }
    this.objectSequence += 1;
    const objectName = `${EDITOR_TOOL_DETAILS[tool].label} ${this.objectSequence}`;
    const objectId = `${tool}-${this.objectSequence}`;
    const object = this.createObject(tool, point, point, {
      id: objectId,
      name: objectName,
    });
    this.scene = {
      ...this.scene,
      objects: [...this.scene.objects, object],
    };
    this.selectedId = object.id;
    this.interactionState.current = {
      kind: "create",
      objectId: object.id,
      objectName,
      startClient: getClientPoint(event),
      startPoint: point,
      startScene: cloneScene(this.scene),
      tool,
    };
    this.renderAll();
  }

  private createObject(
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

  private addTextObject(point: ScenePoint): void {
    if (!this.scene) {
      return;
    }
    this.objectSequence += 1;
    const object: TextSceneObject = {
      align: "left",
      background: "transparent",
      color: "#ffffff",
      fontFamily: "TwitterChirp, Inter, sans-serif",
      fontSize: Math.max(
        36,
        Math.min(this.scene.width, this.scene.height) * 0.06
      ),
      fontWeight: 700,
      height: 140,
      id: `text-${this.objectSequence}`,
      kind: "text",
      letterSpacing: 0,
      lineHeight: 1.1,
      locked: false,
      name: `Text ${this.objectSequence}`,
      opacity: 1,
      rotation: 0,
      shadow: 8,
      text: "Text",
      visible: true,
      width: Math.min(520, this.scene.width * 0.5),
      x: point.x,
      y: point.y,
    };
    this.scene = { ...this.scene, objects: [...this.scene.objects, object] };
    this.selectedId = object.id;
    this.currentTool = "select";
    this.commitScene();
    this.renderAll();
    const textarea = this.elements.inspector.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Text content"]'
    );
    textarea?.select();
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const interaction = this.interactionState.current;
    if (!interaction) {
      return;
    }
    const startPoint = this.clientToScene(interaction.startClient);
    const currentPoint = this.clientToScene(getClientPoint(event));
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

    if (interaction.kind === "move") {
      const position = event.altKey
        ? { x: startObject.x + delta.x, y: startObject.y + delta.y }
        : getSnappedPosition(
            interaction.startScene,
            startObject,
            startObject.x + delta.x,
            startObject.y + delta.y,
            7 / Math.max(0.01, (this.lastLayout?.scale ?? 1) * this.viewScale)
          );
      this.scene = updateSceneObject(
        interaction.startScene,
        startObject.id,
        (object) => ({ ...object, ...position })
      );
    } else if (interaction.kind === "resize") {
      this.scene = updateSceneObject(
        interaction.startScene,
        startObject.id,
        (object) =>
          resizeSceneObject(object, interaction.handle, delta, event.shiftKey)
      );
    } else if (
      interaction.kind === "crop-pan" &&
      startObject.kind === "image"
    ) {
      this.scene = updateSceneObject(
        interaction.startScene,
        startObject.id,
        () => panImageCrop(startObject, delta)
      );
    } else if (
      interaction.kind === "crop-resize" &&
      startObject.kind === "image"
    ) {
      this.scene = updateSceneObject(
        interaction.startScene,
        startObject.id,
        () => resizeImageCrop(startObject, interaction.handle, delta)
      );
    } else if (interaction.kind === "rotate") {
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
      this.scene = updateSceneObject(
        interaction.startScene,
        startObject.id,
        (object) => ({ ...object, rotation })
      );
    } else if (interaction.kind === "create") {
      const object = this.createObject(
        interaction.tool,
        interaction.startPoint,
        currentPoint,
        {
          id: interaction.objectId,
          name: interaction.objectName,
        }
      );
      this.scene = updateSceneObject(
        interaction.startScene,
        interaction.objectId,
        () => object
      );
    }
    this.renderCanvas();
  };

  private readonly handlePointerUp = (): void => {
    const interaction = this.interactionState.current;
    if (!interaction) {
      return;
    }
    this.interactionState.current = null;
    if (!this.isCropping()) {
      this.commitScene();
    }
    if (interaction.kind === "create") {
      this.currentTool = "select";
    }
    this.renderAll();
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (!this.scene) {
      return;
    }
    event.preventDefault();
    const selected = getSceneObject(this.scene, this.selectedId);
    const point = this.clientToScene(getClientPoint(event));
    if (this.isCropping() && selected?.kind === "image" && point) {
      const local = scenePointToObject(point, selected);
      const anchor = {
        x: clamp(local.x / selected.width + 0.5, 0, 1),
        y: clamp(local.y / selected.height + 0.5, 0, 1),
      };
      const zoom = Math.exp(-event.deltaY * 0.002);
      this.scene = updateSceneObject(this.scene, selected.id, () =>
        zoomImageCrop(selected, zoom, anchor)
      );
      this.renderCanvas();
    }
  };

  private duplicateSelected(): void {
    if (!(this.scene && this.selectedId)) {
      return;
    }
    const object = getSceneObject(this.scene, this.selectedId);
    if (!object) {
      return;
    }
    this.objectSequence += 1;
    const copy = {
      ...object,
      id: `${object.kind}-${this.objectSequence}`,
      name: `${object.name} copy`,
      x: object.x + 24,
      y: object.y + 24,
    };
    this.scene = { ...this.scene, objects: [...this.scene.objects, copy] };
    this.selectedId = copy.id;
    this.commitScene();
    this.renderAll();
  }

  private deleteSelected(): void {
    if (!(this.scene && this.selectedId)) {
      return;
    }
    this.scene = removeSceneObject(this.scene, this.selectedId);
    this.selectedId = null;
    this.commitScene();
    this.renderAll();
  }

  private reorderSelected(direction: -1 | 1): void {
    if (!(this.scene && this.selectedId)) {
      return;
    }
    this.scene = reorderSceneObject(this.scene, this.selectedId, direction);
    this.commitScene();
    this.renderAll();
  }

  private nudgeSelected(dx: number, dy: number): void {
    const selected = this.scene
      ? getSceneObject(this.scene, this.selectedId)
      : null;
    if (selected?.locked) {
      return;
    }
    this.updateSelected((object) => ({
      ...object,
      x: object.x + dx,
      y: object.y + dy,
    }));
    this.commitScene();
    this.renderInspector();
  }

  private consumeKey(event: KeyboardEvent): void {
    event.preventDefault();
  }

  private handleEscapeOrTab(event: KeyboardEvent): boolean {
    if (event.key === "Escape") {
      this.consumeKey(event);
      if (this.isCropping()) {
        this.cancelCropMode();
      } else if (this.selectedId) {
        this.selectObject(null);
      } else {
        this.close();
      }
      return true;
    }
    if (event.key === "Tab") {
      this.trapFocus(event);
      return true;
    }
    return false;
  }

  private handleCommandKey(event: KeyboardEvent): boolean {
    if (!(event.metaKey || event.ctrlKey)) {
      return false;
    }
    const key = event.key.toLowerCase();
    if (key === "z") {
      this.consumeKey(event);
      if (event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return true;
    }
    if (key === "d") {
      this.consumeKey(event);
      this.duplicateSelected();
      return true;
    }
    if (event.key === "Enter") {
      this.consumeKey(event);
      this.apply().catch((error: unknown) => window.reportError(error));
      return true;
    }
    return false;
  }

  private handleNudgeKey(event: KeyboardEvent): boolean {
    const amount = event.shiftKey ? 10 : 1;
    const offsets: Partial<Record<string, ScenePoint>> = {
      ArrowDown: { x: 0, y: amount },
      ArrowLeft: { x: -amount, y: 0 },
      ArrowRight: { x: amount, y: 0 },
      ArrowUp: { x: 0, y: -amount },
    };
    const offset = offsets[event.key];
    if (!offset) {
      return false;
    }
    this.consumeKey(event);
    this.nudgeSelected(offset.x, offset.y);
    return true;
  }

  private handleCanvasKey(event: KeyboardEvent): boolean {
    if (event.key === "Enter" && this.isCropping()) {
      this.consumeKey(event);
      this.finishCropMode();
      return true;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      this.consumeKey(event);
      this.deleteSelected();
      return true;
    }
    return this.handleNudgeKey(event);
  }

  private handleToolKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const key = event.key.toLowerCase();
    const tool = (Object.keys(EDITOR_TOOL_DETAILS) as EditorTool[]).find(
      (candidate) => EDITOR_TOOL_DETAILS[candidate].key.toLowerCase() === key
    );
    if (tool) {
      this.consumeKey(event);
      this.selectTool(tool);
    } else if (key === "c") {
      this.consumeKey(event);
      this.toggleCropMode();
    } else if (key === "]") {
      this.consumeKey(event);
      this.reorderSelected(1);
    } else if (key === "[") {
      this.consumeKey(event);
      this.reorderSelected(-1);
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.elements.host.hidden) {
      return;
    }
    event.stopImmediatePropagation();
    if (this.handleEscapeOrTab(event)) {
      return;
    }
    const isEditable =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement;
    if (isEditable) {
      return;
    }
    if (this.handleCommandKey(event) || this.handleCanvasKey(event)) {
      return;
    }
    this.handleToolKey(event);
  };

  private readonly handleWindowResize = (): void => {
    if (!this.elements.host.hidden) {
      this.fitView();
    }
  };

  private trapFocus(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.elements.host.querySelectorAll<HTMLElement>(
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

  private async apply(): Promise<void> {
    const { scene, session } = this;
    if (!(scene && session)) {
      return;
    }
    if (this.isCropping()) {
      this.finishCropMode();
    }
    this.elements.applyButton.disabled = true;
    this.elements.status.textContent = "Rendering image…";
    try {
      const outputCanvas = document.createElement("canvas");
      this.drawScene(outputCanvas, scene, EXPORT_EDGE);
      const outputType = getOutputType(session.file.type);
      const blob = await canvasToBlob(outputCanvas, outputType);
      const editedFile = new File(
        [blob],
        getOutputName(session.file, outputType),
        { type: outputType }
      );

      if (session.replaceButton?.isConnected) {
        session.replaceButton.click();
        await nextFrame();
        await nextFrame();
      }
      const nativeInput = session.nativeInput.isConnected
        ? session.nativeInput
        : (session.composer?.querySelector<HTMLInputElement>(
            IMAGE_INPUT_SELECTOR
          ) ?? document.querySelector<HTMLInputElement>(IMAGE_INPUT_SELECTOR));
      if (!nativeInput) {
        throw new Error("X's image upload control is unavailable.");
      }
      const transfer = new DataTransfer();
      transfer.items.add(editedFile);
      nativeInput.files = transfer.files;
      nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
      nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
      this.close();
    } catch (error) {
      this.elements.applyButton.disabled = false;
      this.elements.status.textContent =
        "The edit could not be applied. Your original is unchanged.";
      throw error;
    }
  }

  private destroy(): void {
    this.observer.disconnect();
    this.session?.image.close();
    document.documentElement.removeAttribute(IMAGE_EDITOR_OPEN_ATTRIBUTE);
    for (const trigger of document.querySelectorAll(
      ".better-x-image-edit-trigger, .better-x-image-preview-edit"
    )) {
      trigger.remove();
    }
    for (const input of document.querySelectorAll<HTMLInputElement>(
      "[data-better-x-image-editor]"
    )) {
      delete input.dataset.betterXImageEditor;
    }
    this.elements.root.unmount();
    this.elements.host.remove();
  }
}

export const startImageEditor = (ctx: ContentScriptContext): void => {
  new ImageEditor(ctx).start();
};
