import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
  CROP_PRESETS,
  type CropPreset,
  clampUnit,
  getCenteredCropRect,
  getImageLayout,
  type ImageLayout,
} from "./image-editor";

import "../styles/image-editor.css";

export const IMAGE_EDITOR_OPEN_ATTRIBUTE = "data-better-x-image-editor-open";

const EDITOR_RENDER_EDGE = 1600;
const EXPORT_EDGE = 4096;
const IMAGE_INPUT_SELECTOR =
  'input[data-testid="fileInput"][type="file"], input[type="file"][accept*="image"]';
const PREVIEW_IMAGE_SELECTOR = '[data-testid="attachments"] img[src]';
const PREVIEW_REMOVE_SELECTOR =
  '[data-testid="removeMedia"], button[aria-label*="Remove"], button[aria-label*="remove"]';
const TEXTAREA_SELECTOR =
  '[data-testid^="tweetTextarea_"], [contenteditable="true"]';
const FILE_EXTENSION_PATTERN = /\.[^/.]+$/;

const CROP_LABELS: Record<CropPreset, string> = {
  original: "Original",
  portrait: "4:5",
  square: "1:1",
  wide: "16:9",
};

const TOOL_DETAILS = {
  arrow: { key: "A", label: "Arrow", symbol: "↗" },
  blur: { key: "B", label: "Blur", symbol: "◌" },
  rectangle: { key: "R", label: "Box", symbol: "□" },
  text: { key: "T", label: "Text", symbol: "T" },
} as const;

type EditorTool = keyof typeof TOOL_DETAILS;

interface Point {
  x: number;
  y: number;
}

interface ArrowAnnotation {
  from: Point;
  kind: "arrow";
  to: Point;
}

interface BlurAnnotation {
  from: Point;
  kind: "blur";
  to: Point;
}

interface RectangleAnnotation {
  from: Point;
  kind: "rectangle";
  to: Point;
}

interface TextAnnotation {
  at: Point;
  kind: "text";
  text: string;
}

type Annotation =
  | ArrowAnnotation
  | BlurAnnotation
  | RectangleAnnotation
  | TextAnnotation;

interface EditorSnapshot {
  annotations: readonly Annotation[];
  crop: CropPreset;
  hasBackground: boolean;
}

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

interface EditorElements {
  applyButton: HTMLButtonElement;
  backgroundButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  closeButton: HTMLButtonElement;
  cropButtons: ReadonlyMap<CropPreset, HTMLButtonElement>;
  dimensions: HTMLSpanElement;
  host: HTMLElement;
  loading: HTMLSpanElement;
  redoButton: HTMLButtonElement;
  status: HTMLSpanElement;
  textControl: HTMLLabelElement;
  textInput: HTMLInputElement;
  toolButtons: ReadonlyMap<EditorTool, HTMLButtonElement>;
  undoButton: HTMLButtonElement;
}

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

const createActionButton = ({
  className,
  key,
  label,
  symbol,
}: {
  className: string;
  key?: string;
  label: string;
  symbol?: string;
}): HTMLButtonElement => {
  const button = createElement("button", className);
  button.type = "button";
  button.setAttribute("aria-label", label);
  if (symbol) {
    const icon = createElement("span", "better-x-image-editor__button-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = symbol;
    button.append(icon);
  }
  button.append(
    createElement("span", "better-x-image-editor__button-label", label)
  );
  if (key) {
    button.append(createKbd(key));
  }
  return button;
};

const createEditorElements = (): EditorElements => {
  const host = document.createElement("better-x-image-editor");
  host.hidden = true;

  const backdrop = createElement("div", "better-x-image-editor__backdrop");
  const dialog = createElement("section", "better-x-image-editor__dialog");
  dialog.dataset.name = "LiquidSurface";
  dialog.setAttribute("aria-label", "Better X image editor");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("role", "dialog");

  const header = createElement("header", "better-x-image-editor__header");
  const heading = createElement("span", "better-x-image-editor__heading");
  heading.append(
    createElement("strong", undefined, "Edit image"),
    createElement(
      "span",
      undefined,
      "Crop, explain, redact, and present before posting"
    )
  );
  const dimensions = createElement("span", "better-x-image-editor__dimensions");
  const closeButton = createActionButton({
    className: "better-x-image-editor__icon-button",
    label: "Close image editor",
    symbol: "×",
  });
  closeButton
    .querySelector(".better-x-image-editor__button-label")
    ?.setAttribute("hidden", "");
  header.append(heading, dimensions, closeButton);

  const stage = createElement("div", "better-x-image-editor__stage");
  const canvas = createElement("canvas", "better-x-image-editor__canvas");
  canvas.setAttribute(
    "aria-label",
    "Image editing canvas. Drag to add the selected annotation."
  );
  canvas.tabIndex = 0;
  const loading = createElement(
    "span",
    "better-x-image-editor__loading",
    "Opening image…"
  );
  stage.append(canvas, loading);

  const controls = createElement("div", "better-x-image-editor__controls");
  controls.dataset.name = "LiquidToolbar";

  const cropGroup = createElement(
    "div",
    "better-x-image-editor__control-group"
  );
  cropGroup.setAttribute("aria-label", "Crop ratio");
  cropGroup.setAttribute("role", "group");
  cropGroup.append(
    createElement("span", "better-x-image-editor__group-label", "Crop")
  );
  const cropButtons = new Map<CropPreset, HTMLButtonElement>();
  for (const preset of CROP_PRESETS) {
    const button = createActionButton({
      className:
        "better-x-image-editor__control better-x-image-editor__crop-control",
      label: CROP_LABELS[preset],
    });
    button.dataset.crop = preset;
    button.setAttribute("aria-pressed", String(preset === "original"));
    cropButtons.set(preset, button);
    cropGroup.append(button);
  }

  const toolGroup = createElement(
    "div",
    "better-x-image-editor__control-group"
  );
  toolGroup.setAttribute("aria-label", "Annotation tools");
  toolGroup.setAttribute("role", "group");
  const toolButtons = new Map<EditorTool, HTMLButtonElement>();
  for (const [tool, details] of Object.entries(TOOL_DETAILS) as [
    EditorTool,
    (typeof TOOL_DETAILS)[EditorTool],
  ][]) {
    const button = createActionButton({
      className: "better-x-image-editor__control",
      key: details.key,
      label: details.label,
      symbol: details.symbol,
    });
    button.dataset.tool = tool;
    button.setAttribute("aria-pressed", String(tool === "arrow"));
    toolButtons.set(tool, button);
    toolGroup.append(button);
  }

  const backgroundButton = createActionButton({
    className: "better-x-image-editor__control",
    key: "G",
    label: "Background",
    symbol: "◐",
  });
  backgroundButton.setAttribute("aria-pressed", "false");
  toolGroup.append(backgroundButton);

  const textControl = createElement(
    "label",
    "better-x-image-editor__text-control"
  );
  textControl.hidden = true;
  textControl.append(
    createElement("span", undefined, "Text"),
    createElement("input", "better-x-image-editor__text-input")
  );
  const textInput = textControl.querySelector<HTMLInputElement>("input");
  if (!textInput) {
    throw new Error("Image editor text input could not be created.");
  }
  textInput.maxLength = 120;
  textInput.placeholder = "Type, then click the image";
  textInput.type = "text";

  const historyGroup = createElement("div", "better-x-image-editor__history");
  historyGroup.setAttribute("aria-label", "Edit history");
  historyGroup.setAttribute("role", "group");
  const undoButton = createActionButton({
    className: "better-x-image-editor__icon-button",
    key: "⌘Z",
    label: "Undo",
    symbol: "↶",
  });
  const redoButton = createActionButton({
    className: "better-x-image-editor__icon-button",
    key: "⇧⌘Z",
    label: "Redo",
    symbol: "↷",
  });
  historyGroup.append(undoButton, redoButton);
  controls.append(cropGroup, toolGroup, textControl, historyGroup);

  const footer = createElement("footer", "better-x-image-editor__footer");
  const status = createElement("span", "better-x-image-editor__status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("role", "status");
  const actions = createElement("div", "better-x-image-editor__actions");
  const cancelButton = createActionButton({
    className: "better-x-image-editor__secondary-action",
    key: "Esc",
    label: "Cancel",
  });
  const applyButton = createActionButton({
    className: "better-x-image-editor__primary-action",
    key: "↵",
    label: "Apply to post",
  });
  actions.append(cancelButton, applyButton);
  footer.append(status, actions);

  dialog.append(header, stage, controls, footer);
  host.append(backdrop, dialog);
  document.body.append(host);

  return {
    applyButton,
    backgroundButton,
    cancelButton,
    canvas,
    closeButton,
    cropButtons,
    dimensions,
    host,
    loading,
    redoButton,
    status,
    textControl,
    textInput,
    toolButtons,
    undoButton,
  };
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

const normalizedRect = (
  from: Point,
  to: Point
): { height: number; width: number; x: number; y: number } => ({
  height: Math.abs(to.y - from.y),
  width: Math.abs(to.x - from.x),
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
});

class ImageEditor {
  private currentTool: EditorTool = "arrow";
  private draft: Annotation | null = null;
  private readonly ctx: ContentScriptContext;
  private readonly elements = createEditorElements();
  private history: EditorSnapshot[] = [];
  private historyIndex = -1;
  private lastLayout: ImageLayout | null = null;
  private readonly observer: MutationObserver;
  private openRequest = 0;
  private readonly picker = createElement("input");
  private session: EditorSession | null = null;

  constructor(ctx: ContentScriptContext) {
    this.ctx = ctx;
    this.picker.accept = "image/jpeg,image/png,image/webp";
    this.picker.className = "better-x-image-editor__picker";
    this.picker.type = "file";
    this.picker.setAttribute("aria-hidden", "true");
    this.elements.host.append(this.picker);

    this.observer = new MutationObserver(() => this.scanPage());
    this.bindEditorControls();
  }

  start(): void {
    this.scanPage();
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.ctx.addEventListener(window, "keydown", this.handleKeyDown, {
      capture: true,
    });
    this.ctx.onInvalidated(() => this.destroy());
  }

  private bindEditorControls(): void {
    const { elements } = this;
    elements.closeButton.addEventListener("click", () => this.close());
    elements.cancelButton.addEventListener("click", () => this.close());
    elements.applyButton.addEventListener("click", () => {
      this.apply().catch((error: unknown) => window.reportError(error));
    });
    elements.undoButton.addEventListener("click", () => this.undo());
    elements.redoButton.addEventListener("click", () => this.redo());
    elements.backgroundButton.addEventListener("click", () => {
      const snapshot = this.getSnapshot();
      if (snapshot) {
        this.commit({ ...snapshot, hasBackground: !snapshot.hasBackground });
      }
    });

    for (const [preset, button] of elements.cropButtons) {
      button.addEventListener("click", () => {
        const snapshot = this.getSnapshot();
        if (snapshot && snapshot.crop !== preset) {
          this.commit({ ...snapshot, crop: preset });
        }
      });
    }

    for (const [tool, button] of elements.toolButtons) {
      button.addEventListener("click", () => this.selectTool(tool));
    }

    elements.canvas.addEventListener("pointerdown", this.handlePointerDown);
    elements.canvas.addEventListener("pointermove", this.handlePointerMove);
    elements.canvas.addEventListener("pointerup", this.handlePointerUp);
    elements.canvas.addEventListener("pointercancel", this.handlePointerCancel);
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
    const file = new File([blob], `image.${getFileExtension(type)}`, { type });
    await this.open({
      file,
      nativeInput,
      replaceButton: removeButton,
      trigger,
    });
  }

  private async open(options: OpenEditorOptions): Promise<void> {
    this.openRequest += 1;
    const request = this.openRequest;
    this.session?.image.close();
    this.session = null;
    this.history = [];
    this.historyIndex = -1;
    this.draft = null;
    this.elements.host.hidden = false;
    this.elements.host.dataset.loading = "true";
    delete this.elements.host.dataset.error;
    document.documentElement.setAttribute(IMAGE_EDITOR_OPEN_ATTRIBUTE, "true");
    this.elements.status.textContent = "Opening image…";
    this.elements.loading.textContent = "Opening image…";
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
      this.history = [
        {
          annotations: [],
          crop: "original",
          hasBackground: false,
        },
      ];
      this.historyIndex = 0;
      this.currentTool = "arrow";
      delete this.elements.host.dataset.loading;
      this.elements.dimensions.textContent = `${image.width} × ${image.height}`;
      this.updateUi();
      this.render();
      this.elements.canvas.focus();
    } catch (error) {
      if (request !== this.openRequest) {
        return;
      }
      delete this.elements.host.dataset.loading;
      this.elements.host.dataset.error = "true";
      this.elements.status.textContent = "This image could not be opened.";
      this.elements.loading.textContent = "This image could not be opened.";
      window.reportError(error);
    }
  }

  private close(): void {
    this.openRequest += 1;
    this.session?.image.close();
    const returnFocus = this.session?.returnFocus;
    this.session = null;
    this.history = [];
    this.historyIndex = -1;
    this.draft = null;
    this.lastLayout = null;
    this.elements.host.hidden = true;
    delete this.elements.host.dataset.loading;
    delete this.elements.host.dataset.error;
    document.documentElement.removeAttribute(IMAGE_EDITOR_OPEN_ATTRIBUTE);
    if (returnFocus?.isConnected) {
      returnFocus.focus();
    }
  }

  private getSnapshot(): EditorSnapshot | null {
    return this.history[this.historyIndex] ?? null;
  }

  private commit(snapshot: EditorSnapshot): void {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snapshot);
    this.historyIndex = this.history.length - 1;
    this.draft = null;
    this.updateUi();
    this.render();
  }

  private undo(): void {
    if (this.historyIndex <= 0) {
      return;
    }
    this.historyIndex -= 1;
    this.draft = null;
    this.updateUi();
    this.render();
  }

  private redo(): void {
    if (this.historyIndex >= this.history.length - 1) {
      return;
    }
    this.historyIndex += 1;
    this.draft = null;
    this.updateUi();
    this.render();
  }

  private selectTool(tool: EditorTool): void {
    this.currentTool = tool;
    this.draft = null;
    this.updateUi();
    this.render();
    if (tool === "text") {
      this.elements.textInput.focus();
    } else {
      this.elements.canvas.focus();
    }
  }

  private updateUi(): void {
    const snapshot = this.getSnapshot();
    for (const [preset, button] of this.elements.cropButtons) {
      button.setAttribute("aria-pressed", String(snapshot?.crop === preset));
    }
    for (const [tool, button] of this.elements.toolButtons) {
      button.setAttribute("aria-pressed", String(this.currentTool === tool));
    }
    this.elements.backgroundButton.setAttribute(
      "aria-pressed",
      String(Boolean(snapshot?.hasBackground))
    );
    this.elements.textControl.hidden = this.currentTool !== "text";
    this.elements.undoButton.disabled = this.historyIndex <= 0;
    this.elements.redoButton.disabled =
      this.historyIndex < 0 || this.historyIndex >= this.history.length - 1;
    this.elements.applyButton.disabled = !this.session;

    if (this.currentTool === "text") {
      this.elements.status.textContent =
        "Type a label, then click where it should appear.";
    } else if (this.currentTool === "blur") {
      this.elements.status.textContent =
        "Drag across anything you want to hide.";
    } else {
      this.elements.status.textContent = `Drag to add ${TOOL_DETAILS[
        this.currentTool
      ].label.toLowerCase()}.`;
    }
  }

  private render(): void {
    const snapshot = this.getSnapshot();
    if (!(snapshot && this.session)) {
      return;
    }
    this.lastLayout = this.drawSnapshot(
      this.elements.canvas,
      snapshot,
      this.draft,
      EDITOR_RENDER_EDGE
    );
  }

  private drawSnapshot(
    canvas: HTMLCanvasElement,
    snapshot: EditorSnapshot,
    draft: Annotation | null,
    maxEdge: number
  ): ImageLayout {
    const { session } = this;
    if (!session) {
      throw new Error("No image is open in the editor.");
    }
    const crop = getCenteredCropRect(
      session.image.width,
      session.image.height,
      snapshot.crop
    );
    const layout = getImageLayout(crop, maxEdge, snapshot.hasBackground);
    canvas.width = layout.canvasWidth;
    canvas.height = layout.canvasHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("The browser does not support image editing.");
    }

    if (snapshot.hasBackground) {
      const gradient = context.createLinearGradient(
        0,
        0,
        canvas.width,
        canvas.height
      );
      gradient.addColorStop(0, "#111827");
      gradient.addColorStop(0.48, "#334155");
      gradient.addColorStop(1, "#0f766e");
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);

      const radius = Math.max(8, Math.min(layout.width, layout.height) * 0.025);
      context.save();
      context.shadowBlur = Math.max(16, radius * 1.8);
      context.shadowColor = "rgb(0 0 0 / 42%)";
      context.shadowOffsetY = Math.max(6, radius * 0.5);
      context.fillStyle = "#fff";
      context.beginPath();
      context.roundRect(
        layout.x,
        layout.y,
        layout.width,
        layout.height,
        radius
      );
      context.fill();
      context.restore();

      context.save();
      context.beginPath();
      context.roundRect(
        layout.x,
        layout.y,
        layout.width,
        layout.height,
        radius
      );
      context.clip();
      this.drawSource(context, crop, layout);
      context.restore();
    } else {
      this.drawSource(context, crop, layout);
    }

    for (const annotation of snapshot.annotations) {
      this.drawAnnotation(context, canvas, layout, annotation);
    }
    if (draft) {
      this.drawAnnotation(context, canvas, layout, draft);
    }
    return layout;
  }

  private drawSource(
    context: CanvasRenderingContext2D,
    crop: ReturnType<typeof getCenteredCropRect>,
    layout: ImageLayout
  ): void {
    const image = this.session?.image;
    if (!image) {
      return;
    }
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      layout.x,
      layout.y,
      layout.width,
      layout.height
    );
  }

  private drawAnnotation(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    layout: ImageLayout,
    annotation: Annotation
  ): void {
    if (annotation.kind === "text") {
      this.drawText(context, layout, annotation);
      return;
    }
    if (annotation.kind === "blur") {
      this.drawBlur(context, canvas, layout, annotation);
      return;
    }

    const from = this.toCanvasPoint(layout, annotation.from);
    const to = this.toCanvasPoint(layout, annotation.to);
    const lineWidth = Math.max(
      3,
      Math.min(layout.width, layout.height) * 0.007
    );
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowBlur = lineWidth * 1.4;
    context.shadowColor = "rgb(0 0 0 / 48%)";
    context.strokeStyle = "#1d9bf0";
    context.lineWidth = lineWidth;

    if (annotation.kind === "rectangle") {
      const rect = normalizedRect(from, to);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    } else {
      this.strokeArrow(context, from, to, lineWidth);
    }
    context.restore();
  }

  private strokeArrow(
    context: CanvasRenderingContext2D,
    from: Point,
    to: Point,
    lineWidth: number
  ): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const headLength = Math.max(lineWidth * 4.5, 18);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.moveTo(to.x, to.y);
    context.lineTo(
      to.x - headLength * Math.cos(angle - Math.PI / 6),
      to.y - headLength * Math.sin(angle - Math.PI / 6)
    );
    context.moveTo(to.x, to.y);
    context.lineTo(
      to.x - headLength * Math.cos(angle + Math.PI / 6),
      to.y - headLength * Math.sin(angle + Math.PI / 6)
    );
    context.stroke();
  }

  private drawText(
    context: CanvasRenderingContext2D,
    layout: ImageLayout,
    annotation: TextAnnotation
  ): void {
    const at = this.toCanvasPoint(layout, annotation.at);
    const fontSize = Math.max(22, Math.min(layout.width, layout.height) * 0.06);
    context.save();
    context.font = `750 ${fontSize}px TwitterChirp, Inter, -apple-system, sans-serif`;
    context.lineJoin = "round";
    context.lineWidth = Math.max(4, fontSize * 0.14);
    context.strokeStyle = "rgb(0 0 0 / 72%)";
    context.fillStyle = "#fff";
    context.strokeText(annotation.text, at.x, at.y);
    context.fillText(annotation.text, at.x, at.y);
    context.restore();
  }

  private drawBlur(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    layout: ImageLayout,
    annotation: BlurAnnotation
  ): void {
    const from = this.toCanvasPoint(layout, annotation.from);
    const to = this.toCanvasPoint(layout, annotation.to);
    const rect = normalizedRect(from, to);
    if (rect.width < 2 || rect.height < 2) {
      return;
    }

    const snapshot = document.createElement("canvas");
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
    const blurRadius = Math.max(
      10,
      Math.min(layout.width, layout.height) * 0.018
    );
    context.save();
    context.beginPath();
    context.rect(rect.x, rect.y, rect.width, rect.height);
    context.clip();
    context.filter = `blur(${blurRadius}px)`;
    context.drawImage(snapshot, 0, 0);
    context.restore();
  }

  private toCanvasPoint(layout: ImageLayout, point: Point): Point {
    return {
      x: layout.x + point.x * layout.width,
      y: layout.y + point.y * layout.height,
    };
  }

  private getPointerPoint(
    event: PointerEvent,
    allowOutside = false
  ): Point | null {
    const layout = this.lastLayout;
    if (!layout) {
      return null;
    }
    const bounds = this.elements.canvas.getBoundingClientRect();
    const scaleX = this.elements.canvas.width / bounds.width;
    const scaleY = this.elements.canvas.height / bounds.height;
    const x = (event.clientX - bounds.left) * scaleX;
    const y = (event.clientY - bounds.top) * scaleY;
    const isInside =
      x >= layout.x &&
      x <= layout.x + layout.width &&
      y >= layout.y &&
      y <= layout.y + layout.height;
    if (!(isInside || allowOutside)) {
      return null;
    }
    return {
      x: clampUnit((x - layout.x) / layout.width),
      y: clampUnit((y - layout.y) / layout.height),
    };
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.session) {
      return;
    }
    const point = this.getPointerPoint(event);
    if (!point) {
      return;
    }
    event.preventDefault();

    if (this.currentTool === "text") {
      const text = this.elements.textInput.value.trim();
      if (!text) {
        this.elements.textInput.focus();
        return;
      }
      const snapshot = this.getSnapshot();
      if (snapshot) {
        this.commit({
          ...snapshot,
          annotations: [
            ...snapshot.annotations,
            { at: point, kind: "text", text },
          ],
        });
      }
      return;
    }

    this.elements.canvas.setPointerCapture(event.pointerId);
    this.draft = {
      from: point,
      kind: this.currentTool,
      to: point,
    };
    this.render();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!(this.draft && this.draft.kind !== "text")) {
      return;
    }
    const point = this.getPointerPoint(event, true);
    if (!point) {
      return;
    }
    this.draft = { ...this.draft, to: point };
    this.render();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!(this.draft && this.draft.kind !== "text")) {
      return;
    }
    const point = this.getPointerPoint(event, true);
    const draft = point ? { ...this.draft, to: point } : this.draft;
    const distance = Math.hypot(
      draft.to.x - draft.from.x,
      draft.to.y - draft.from.y
    );
    const snapshot = this.getSnapshot();
    if (snapshot && distance > 0.01) {
      this.commit({
        ...snapshot,
        annotations: [...snapshot.annotations, draft],
      });
    } else {
      this.draft = null;
      this.render();
    }
  };

  private readonly handlePointerCancel = (): void => {
    this.draft = null;
    this.render();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.elements.host.hidden) {
      return;
    }
    event.stopImmediatePropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return;
    }
    if (event.key === "Tab") {
      this.trapFocus(event);
      return;
    }
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      this.apply().catch((error: unknown) => window.reportError(error));
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const key = event.key.toLowerCase();
    const tool = (
      Object.entries(TOOL_DETAILS) as [
        EditorTool,
        (typeof TOOL_DETAILS)[EditorTool],
      ][]
    ).find(([, details]) => details.key.toLowerCase() === key)?.[0];
    if (tool) {
      event.preventDefault();
      this.selectTool(tool);
      return;
    }
    if (key === "g") {
      event.preventDefault();
      this.elements.backgroundButton.click();
    }
  };

  private trapFocus(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.elements.host.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), canvas[tabindex="0"]'
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
    const snapshot = this.getSnapshot();
    const { session } = this;
    if (!(snapshot && session)) {
      return;
    }

    this.elements.applyButton.disabled = true;
    this.elements.status.textContent = "Rendering image…";
    try {
      const outputCanvas = document.createElement("canvas");
      this.drawSnapshot(outputCanvas, snapshot, null, EXPORT_EDGE);
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
    this.elements.host.remove();
  }
}

export const startImageEditor = (ctx: ContentScriptContext): void => {
  new ImageEditor(ctx).start();
};
