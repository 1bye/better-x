import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
  type MountedImageEditor,
  mountImageEditor,
  type OpenImageEditorOptions,
} from "../components/image-editor";
import type {
  ImageEditorOrigin,
  ImageEditorOriginSnapshot,
} from "./image-editor-viewport";

const IMAGE_INPUT_SELECTOR =
  'input[data-testid="fileInput"][type="file"], input[type="file"][accept*="image"]:not(.better-x-image-editor__picker)';
const PREVIEW_IMAGE_SELECTOR = '[data-testid="attachments"] img[src]';
const PREVIEW_REMOVE_SELECTOR =
  '[data-testid="removeMedia"], button[aria-label*="Remove"], button[aria-label*="remove"]';
const TEXTAREA_SELECTOR =
  '[data-testid^="tweetTextarea_"], [contenteditable="true"]';

interface OpenEditorOptions {
  file: File;
  nativeInput: HTMLInputElement;
  origin?: ImageEditorOrigin;
  replaceButton: HTMLButtonElement | null;
  trigger: HTMLElement;
}

interface ReplaceablePreview {
  removeButton: HTMLButtonElement;
  root: HTMLElement;
}

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

const getColorChannels = (
  color: string
): readonly [number, number, number] | null => {
  const channels = color.match(/[\d.]+/g)?.map(Number);
  if (
    !channels ||
    channels.length < 3 ||
    (channels.length > 3 && channels[3] === 0)
  ) {
    return null;
  }
  return [channels[0], channels[1], channels[2]];
};

const getLiquidTheme = (): "" | "dark" => {
  const background = getColorChannels(
    window.getComputedStyle(document.body).backgroundColor
  );
  if (background) {
    const [red, green, blue] = background;
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
    return luminance < 128 ? "dark" : "";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "";
};

const intersectBounds = (
  imageBounds: DOMRect,
  maskBounds: DOMRect
): Pick<ImageEditorOriginSnapshot, "height" | "left" | "top" | "width"> => {
  const left = Math.max(0, imageBounds.left, maskBounds.left);
  const top = Math.max(0, imageBounds.top, maskBounds.top);
  const right = Math.min(
    window.innerWidth,
    imageBounds.right,
    maskBounds.right
  );
  const bottom = Math.min(
    window.innerHeight,
    imageBounds.bottom,
    maskBounds.bottom
  );
  return {
    height: Math.max(0, bottom - top),
    left,
    top,
    width: Math.max(0, right - left),
  };
};

const createImageOrigin = (
  image: HTMLImageElement,
  mask: HTMLElement
): ImageEditorOrigin => {
  const originalVisibility = image.style.visibility;
  let isHidden = false;

  return {
    getSnapshot: () => {
      if (!(image.isConnected && mask.isConnected)) {
        return null;
      }
      const bounds = intersectBounds(
        image.getBoundingClientRect(),
        mask.getBoundingClientRect()
      );
      if (bounds.width < 1 || bounds.height < 1) {
        return null;
      }
      const imageStyle = window.getComputedStyle(image);
      const maskStyle = window.getComputedStyle(mask);
      const borderRadius = Math.max(
        Number.parseFloat(maskStyle.borderTopLeftRadius) || 0,
        Number.parseFloat(maskStyle.borderTopRightRadius) || 0,
        Number.parseFloat(maskStyle.borderBottomRightRadius) || 0,
        Number.parseFloat(maskStyle.borderBottomLeftRadius) || 0,
        Number.parseFloat(imageStyle.borderTopLeftRadius) || 0,
        Number.parseFloat(imageStyle.borderTopRightRadius) || 0,
        Number.parseFloat(imageStyle.borderBottomRightRadius) || 0,
        Number.parseFloat(imageStyle.borderBottomLeftRadius) || 0
      );
      return {
        ...bounds,
        borderRadius,
        objectFit: imageStyle.objectFit === "cover" ? "cover" : "contain",
      };
    },
    setVisible: (isVisible) => {
      if (isVisible) {
        if (isHidden) {
          image.style.visibility = originalVisibility;
          isHidden = false;
        }
      } else if (image.isConnected && !isHidden) {
        image.style.visibility = "hidden";
        isHidden = true;
      }
    },
  };
};

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

const setInputFile = (input: HTMLInputElement, file: File): void => {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

class XImageEditorBridge {
  private readonly ctx: ContentScriptContext;
  private readonly editor: MountedImageEditor = mountImageEditor();
  private readonly observer: MutationObserver;
  private readonly picker = document.createElement("input");

  constructor(ctx: ContentScriptContext) {
    this.ctx = ctx;
    this.picker.accept = "image/jpeg,image/png,image/webp";
    this.picker.className = "better-x-image-editor__picker";
    this.picker.type = "file";
    this.picker.setAttribute("aria-hidden", "true");
    document.body.append(this.picker);
    this.observer = new MutationObserver(() => this.scanPage());
  }

  start(): void {
    this.scanPage();
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.ctx.onInvalidated(() => this.destroy());
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
    const trigger = document.createElement("button");
    trigger.className = "better-x-image-edit-trigger";
    trigger.textContent = "✦";
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
    const trigger = document.createElement("button");
    trigger.className = "better-x-image-preview-edit";
    trigger.textContent = "Edit";
    trigger.type = "button";
    trigger.setAttribute("aria-label", "Edit attached image");
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openPreview({
        image,
        nativeInput,
        removeButton: preview.removeButton,
        root: preview.root,
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
    root,
    trigger,
  }: {
    image: HTMLImageElement;
    nativeInput: HTMLInputElement;
    removeButton: HTMLButtonElement;
    root: HTMLElement;
    trigger: HTMLButtonElement;
  }): Promise<void> {
    const origin = createImageOrigin(image, root);
    const response = await fetch(image.currentSrc || image.src);
    if (!response.ok) {
      throw new Error("The attached image could not be opened.");
    }
    const blob = await response.blob();
    const type = getOutputType(blob.type);
    await this.open({
      file: new File([blob], `image.${getFileExtension(type)}`, { type }),
      nativeInput,
      origin,
      replaceButton: removeButton,
      trigger,
    });
  }

  private open({
    file,
    nativeInput,
    origin,
    replaceButton,
    trigger,
  }: OpenEditorOptions): Promise<void> {
    const composer = getComposer(nativeInput);
    const options: OpenImageEditorOptions = {
      file,
      onApply: (editedFile) =>
        this.applyEditedFile({
          composer,
          editedFile,
          nativeInput,
          replaceButton,
        }),
      origin,
      theme: getLiquidTheme(),
      trigger,
    };
    return this.editor.open(options);
  }

  private async applyEditedFile({
    composer,
    editedFile,
    nativeInput,
    replaceButton,
  }: {
    composer: HTMLElement | null;
    editedFile: File;
    nativeInput: HTMLInputElement;
    replaceButton: HTMLButtonElement | null;
  }): Promise<void> {
    if (replaceButton?.isConnected) {
      replaceButton.click();
      await nextFrame();
      await nextFrame();
    }
    const availableInput = nativeInput.isConnected
      ? nativeInput
      : (composer?.querySelector<HTMLInputElement>(IMAGE_INPUT_SELECTOR) ??
        document.querySelector<HTMLInputElement>(IMAGE_INPUT_SELECTOR));
    if (!availableInput) {
      throw new Error("X's image upload control is unavailable.");
    }
    setInputFile(availableInput, editedFile);
  }

  private destroy(): void {
    this.observer.disconnect();
    this.picker.remove();
    for (const trigger of document.querySelectorAll(
      ".better-x-image-edit-trigger, .better-x-image-preview-edit"
    )) {
      trigger.remove();
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      "[data-better-x-image-editor]"
    )) {
      delete element.dataset.betterXImageEditor;
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      "[data-better-x-image-preview]"
    )) {
      delete element.dataset.betterXImagePreview;
    }
    this.editor.destroy();
  }
}

export const startImageEditor = (ctx: ContentScriptContext): void => {
  new XImageEditorBridge(ctx).start();
};
