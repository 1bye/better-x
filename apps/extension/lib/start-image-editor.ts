import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
  type MountedImageEditor,
  mountImageEditor,
  type OpenImageEditorOptions,
} from "../components/image-editor-view";

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

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

const setInputFile = (input: HTMLInputElement, file: File): void => {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

class ImageEditorBridge {
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

  private open({
    file,
    nativeInput,
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
  new ImageEditorBridge(ctx).start();
};
