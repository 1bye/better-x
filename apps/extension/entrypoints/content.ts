import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { defineContentScript } from "wxt/utils/define-content-script";

import { type ReaderSettings, readerSettings } from "../lib/settings";

import "../styles/content.css";

const ACTIVE_ATTRIBUTE = "data-better-x-active";
const MINIMUM_SPLIT_WIDTH = 1040;
const PRIMARY_COLUMN_SELECTOR = '[data-testid="primaryColumn"]';
const PROFILE_PATH_PATTERN = /^\/[a-zA-Z0-9_]{1,30}\/?$/;
const STATUS_PATH_PATTERN = /^\/[^/]+\/status\/\d+\/?$/;
const SUPPORTED_ACTIONS = new Set(["bookmark", "like", "reply", "retweet"]);
const SUPPORTED_ROUTES = new Set([
  "/bookmarks",
  "/explore",
  "/home",
  "/notifications",
  "/search",
]);
const TRAILING_SLASH_PATTERN = /\/$/;

interface PointerPosition {
  x: number;
  y: number;
}

interface ReaderElements {
  closeButton: HTMLButtonElement;
  footerMode: HTMLSpanElement;
  host: HTMLElement;
  openLink: HTMLAnchorElement;
  pinButton: HTMLButtonElement;
  placeholder: HTMLDivElement;
  preview: HTMLDivElement;
  status: HTMLSpanElement;
}

interface ReaderState {
  activePostUrl: string | null;
  activeSource: HTMLElement | null;
  isPinned: boolean;
  lastPointer: PointerPosition | null;
  settings: ReaderSettings;
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

const createReaderElements = (): ReaderElements => {
  const host = document.createElement("better-x-reader");
  host.hidden = true;
  host.setAttribute("aria-label", "Better X post reader");

  const reader = createElement("aside", "better-x-reader");
  reader.setAttribute("aria-label", "Selected post");

  const toolbar = createElement("header", "better-x-reader__toolbar");
  const brand = createElement("div", "better-x-reader__brand");
  const mark = createElement("span", "better-x-reader__mark", "BX");
  mark.setAttribute("aria-hidden", "true");

  const titles = createElement("div", "better-x-reader__titles");
  const title = createElement("span", "better-x-reader__title", "Reader");
  const status = createElement(
    "span",
    "better-x-reader__status",
    "Following cursor"
  );
  titles.append(title, status);
  brand.append(mark, titles);

  const actions = createElement("div", "better-x-reader__actions");
  const pinButton = createElement(
    "button",
    "better-x-reader__button better-x-reader__button--pin",
    "Pin"
  );
  pinButton.type = "button";
  pinButton.disabled = true;
  pinButton.setAttribute("aria-pressed", "false");
  pinButton.title = "Keep this post in the reader (P)";

  const openLink = createElement("a", "better-x-reader__open", "Open ↗");
  openLink.hidden = true;
  openLink.rel = "noopener";
  openLink.target = "_blank";

  const closeButton = createElement(
    "button",
    "better-x-reader__button better-x-reader__button--icon",
    "×"
  );
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Turn off Better X");
  closeButton.title = "Turn off Better X";

  actions.append(pinButton, openLink, closeButton);
  toolbar.append(brand, actions);

  const scroller = createElement("div", "better-x-reader__scroller");
  const preview = createElement("div", "better-x-reader__preview");
  preview.setAttribute("aria-live", "off");

  const placeholder = createElement("div", "better-x-reader__placeholder");
  const placeholderIcon = createElement(
    "span",
    "better-x-reader__placeholder-icon",
    "↘"
  );
  placeholderIcon.setAttribute("aria-hidden", "true");
  const placeholderTitle = createElement(
    "strong",
    "better-x-reader__placeholder-title",
    "Move across the feed"
  );
  const placeholderCopy = createElement(
    "span",
    "better-x-reader__placeholder-copy",
    "The post under your cursor will appear here while the timeline keeps moving."
  );
  placeholder.append(placeholderIcon, placeholderTitle, placeholderCopy);
  preview.append(placeholder);
  scroller.append(preview);

  const footer = createElement("footer", "better-x-reader__footer");
  const footerMode = createElement("span", undefined, "Live preview");
  const shortcut = createElement("kbd", undefined, "P");
  const shortcutCopy = createElement(
    "span",
    undefined,
    "to pin · Esc to resume"
  );
  footer.append(footerMode, shortcut, shortcutCopy);

  reader.append(toolbar, scroller, footer);
  host.append(reader);
  document.body.append(host);

  return {
    closeButton,
    footerMode,
    host,
    openLink,
    pinButton,
    placeholder,
    preview,
    status,
  };
};

const getPostUrl = (article: HTMLElement): string | null => {
  const links = article.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const link of links) {
    const url = new URL(link.href, window.location.origin);
    if (
      url.origin === window.location.origin &&
      STATUS_PATH_PATTERN.test(url.pathname)
    ) {
      return url.href;
    }
  }
  return null;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false;
  }
  return target.matches("input, textarea, select, [contenteditable='true']");
};

const isSupportedRoute = (): boolean => {
  const normalizedPath =
    window.location.pathname.replace(TRAILING_SLASH_PATTERN, "") || "/";
  return (
    SUPPORTED_ROUTES.has(normalizedPath) ||
    PROFILE_PATH_PATTERN.test(normalizedPath)
  );
};

const getPageTheme = (): "dark" | "light" => {
  const background = getComputedStyle(document.body).backgroundColor;
  const channels = background.match(/\d+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length < 3) {
    return "light";
  }
  const [red, green, blue] = channels;
  const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
  return luminance < 100 ? "dark" : "light";
};

const getArticleFromTarget = (
  target: EventTarget | null
): HTMLElement | null => {
  if (!(target instanceof Element)) {
    return null;
  }
  const article = target.closest<HTMLElement>('article[data-testid="tweet"]');
  const primaryColumn = article?.closest(PRIMARY_COLUMN_SELECTOR);
  return primaryColumn ? article : null;
};

const getAnchorY = (
  pointer: PointerPosition | null,
  viewportHeight: number
): number => {
  const defaultY = viewportHeight * 0.38;
  const pointerY = pointer ? pointer.y : defaultY;
  return pointerY < 100 || pointerY > viewportHeight - 100
    ? defaultY
    : pointerY;
};

const cloneArticle = (source: HTMLElement): HTMLElement => {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.dataset.betterXPreview = "true";
  clone.removeAttribute(ACTIVE_ATTRIBUTE);

  for (const element of clone.querySelectorAll<HTMLElement>("[id]")) {
    element.removeAttribute("id");
  }

  for (const element of clone.querySelectorAll<HTMLElement>(
    "[aria-describedby]"
  )) {
    element.removeAttribute("aria-describedby");
  }

  for (const link of clone.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    link.rel = "noopener";
    link.target = "_blank";
  }

  for (const video of clone.querySelectorAll<HTMLVideoElement>("video")) {
    video.autoplay = false;
    video.muted = true;
    video.preload = "metadata";
  }

  return clone;
};

const findArticleAtAnchor = (
  primaryColumn: Element,
  anchorY: number
): HTMLElement | null => {
  const articles = primaryColumn.querySelectorAll<HTMLElement>(
    'article[data-testid="tweet"]'
  );
  let closestArticle: HTMLElement | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const article of articles) {
    const rect = article.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      continue;
    }
    if (rect.top <= anchorY && rect.bottom >= anchorY) {
      return article;
    }
    const distance = Math.min(
      Math.abs(rect.top - anchorY),
      Math.abs(rect.bottom - anchorY)
    );
    if (distance < closestDistance) {
      closestArticle = article;
      closestDistance = distance;
    }
  }

  return closestArticle;
};

const startReader = async (ctx: ContentScriptContext): Promise<void> => {
  const initialSettings = await readerSettings.getValue();
  if (ctx.isInvalid) {
    return;
  }

  const elements = createReaderElements();
  const state: ReaderState = {
    activePostUrl: null,
    activeSource: null,
    isPinned: false,
    lastPointer: null,
    settings: initialSettings,
  };

  let layoutFrame = 0;
  let positionFrame = 0;
  let renderTimer = 0;
  let selectionFrame = 0;

  const updateModeLabels = (): void => {
    elements.host.dataset.pinned = String(state.isPinned);
    elements.pinButton.setAttribute("aria-pressed", String(state.isPinned));
    elements.pinButton.textContent = state.isPinned ? "Pinned" : "Pin";

    if (state.isPinned) {
      elements.status.textContent = "Pinned post";
      elements.footerMode.textContent = "Reader locked";
      return;
    }

    elements.status.textContent = state.settings.followCursor
      ? "Following cursor"
      : "Following scroll";
    elements.footerMode.textContent = "Live preview";
  };

  const renderActiveArticle = (force = false): void => {
    const { activePostUrl, activeSource } = state;
    if (!(activeSource?.isConnected && activePostUrl)) {
      elements.preview.replaceChildren(elements.placeholder);
      elements.openLink.hidden = true;
      elements.pinButton.disabled = true;
      return;
    }

    const existingPreview = elements.preview.querySelector<HTMLElement>(
      "[data-better-x-preview]"
    );
    if (!force && existingPreview?.dataset.postUrl === activePostUrl) {
      return;
    }

    const clone = cloneArticle(activeSource);
    clone.dataset.postUrl = activePostUrl;
    elements.preview.replaceChildren(clone);
    elements.openLink.href = activePostUrl;
    elements.openLink.hidden = false;
    elements.pinButton.disabled = false;
  };

  const scheduleActiveRender = (): void => {
    if (renderTimer) {
      window.clearTimeout(renderTimer);
    }
    renderTimer = ctx.setTimeout(() => {
      renderTimer = 0;
      renderActiveArticle(true);
    }, 120);
  };

  const setPinned = (isPinned: boolean): void => {
    if (isPinned && !state.activeSource) {
      return;
    }
    state.isPinned = isPinned;
    if (state.activeSource) {
      state.activeSource.setAttribute(
        ACTIVE_ATTRIBUTE,
        isPinned ? "pinned" : "true"
      );
    }
    updateModeLabels();
  };

  const selectArticle = (article: HTMLElement | null, force = false): void => {
    if (!(article?.isConnected && !state.isPinned)) {
      return;
    }
    const postUrl = getPostUrl(article);
    if (!postUrl) {
      return;
    }
    if (
      !force &&
      state.activePostUrl === postUrl &&
      state.activeSource === article
    ) {
      return;
    }

    state.activeSource?.removeAttribute(ACTIVE_ATTRIBUTE);
    state.activeSource = article;
    state.activePostUrl = postUrl;
    article.setAttribute(ACTIVE_ATTRIBUTE, "true");
    renderActiveArticle(true);
  };

  const selectFromViewport = (): void => {
    if (state.isPinned || !state.settings.enabled) {
      return;
    }
    const primaryColumn = document.querySelector(PRIMARY_COLUMN_SELECTOR);
    if (!primaryColumn) {
      return;
    }

    if (state.settings.followCursor && state.lastPointer) {
      const { x, y } = state.lastPointer;
      const primaryRect = primaryColumn.getBoundingClientRect();
      const pointerIsOverFeed =
        x >= primaryRect.left &&
        x <= primaryRect.right &&
        y >= 0 &&
        y <= window.innerHeight;
      if (pointerIsOverFeed) {
        const pointedArticle = getArticleFromTarget(
          document.elementFromPoint(x, y)
        );
        if (pointedArticle) {
          selectArticle(pointedArticle);
          return;
        }
      }
    }

    const anchorY = getAnchorY(state.lastPointer, window.innerHeight);
    selectArticle(findArticleAtAnchor(primaryColumn, anchorY));
  };

  const scheduleViewportSelection = (): void => {
    if (selectionFrame) {
      return;
    }
    selectionFrame = ctx.requestAnimationFrame(() => {
      selectionFrame = 0;
      selectFromViewport();
    });
  };

  const updateReaderPosition = (): void => {
    const primaryColumn = document.querySelector<HTMLElement>(
      PRIMARY_COLUMN_SELECTOR
    );
    if (!primaryColumn || elements.host.hidden) {
      return;
    }
    const { right } = primaryColumn.getBoundingClientRect();
    elements.host.style.left = `${Math.round(right)}px`;
    elements.host.dataset.theme = getPageTheme();
  };

  const scheduleReaderPosition = (): void => {
    if (positionFrame) {
      return;
    }
    positionFrame = ctx.requestAnimationFrame(() => {
      positionFrame = 0;
      updateReaderPosition();
    });
  };

  const applyLayout = (): void => {
    const primaryColumn = document.querySelector(PRIMARY_COLUMN_SELECTOR);
    const shouldShow =
      state.settings.enabled &&
      isSupportedRoute() &&
      window.innerWidth >= MINIMUM_SPLIT_WIDTH &&
      Boolean(primaryColumn);

    document.documentElement.toggleAttribute(
      "data-better-x-layout",
      shouldShow
    );
    if (shouldShow) {
      document.documentElement.dataset.betterXLayout = "split";
    }

    document.documentElement.toggleAttribute(
      "data-better-x-density",
      shouldShow && state.settings.compactFeed
    );
    if (shouldShow && state.settings.compactFeed) {
      document.documentElement.dataset.betterXDensity = "compact";
    }

    elements.host.hidden = !shouldShow;
    updateModeLabels();

    if (shouldShow) {
      scheduleReaderPosition();
      scheduleViewportSelection();
      return;
    }

    state.activeSource?.removeAttribute(ACTIVE_ATTRIBUTE);
    state.activeSource = null;
    state.activePostUrl = null;
    state.isPinned = false;
    renderActiveArticle(true);
  };

  const scheduleLayout = (): void => {
    if (layoutFrame) {
      return;
    }
    layoutFrame = ctx.requestAnimationFrame(() => {
      layoutFrame = 0;
      applyLayout();
    });
  };

  const handlePointerMove = (event: PointerEvent): void => {
    state.lastPointer = { x: event.clientX, y: event.clientY };
    if (!state.settings.followCursor || state.isPinned) {
      return;
    }
    selectArticle(getArticleFromTarget(event.target));
  };

  const handleFocusIn = (event: FocusEvent): void => {
    selectArticle(getArticleFromTarget(event.target));
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) {
      return;
    }
    if (event.key === "Escape" && state.isPinned) {
      event.preventDefault();
      setPinned(false);
      scheduleViewportSelection();
      return;
    }
    if (event.key.toLowerCase() === "p" && state.activeSource) {
      event.preventDefault();
      setPinned(!state.isPinned);
    }
  };

  const handlePreviewClick = (event: Event): void => {
    if (!(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest("a[href]")) {
      return;
    }
    const button = event.target.closest<HTMLButtonElement>("button");
    if (!button) {
      return;
    }

    const action = button.dataset.testid;
    if (!(action && SUPPORTED_ACTIONS.has(action) && state.activeSource)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const sourceAction = state.activeSource.querySelector<HTMLElement>(
      `[data-testid="${action}"]`
    );
    sourceAction?.click();
    scheduleActiveRender();
  };

  const disableReader = async (): Promise<void> => {
    try {
      await readerSettings.setValue({
        ...state.settings,
        enabled: false,
      });
    } catch {
      elements.status.textContent = "Could not save";
    }
  };

  ctx.addEventListener(document, "pointermove", handlePointerMove, {
    passive: true,
  });
  ctx.addEventListener(document, "focusin", handleFocusIn);
  ctx.addEventListener(document, "keydown", handleKeyDown);
  ctx.addEventListener(window, "scroll", scheduleViewportSelection, {
    passive: true,
  });
  ctx.addEventListener(window, "resize", scheduleLayout, { passive: true });
  ctx.addEventListener(window, "wxt:locationchange", () => {
    setPinned(false);
    scheduleLayout();
  });
  ctx.addEventListener(elements.preview, "click", handlePreviewClick);
  ctx.addEventListener(elements.pinButton, "click", () => {
    setPinned(!state.isPinned);
  });
  ctx.addEventListener(elements.closeButton, "click", async () => {
    await disableReader();
  });

  const observer = new MutationObserver((mutations) => {
    const activeSourceChanged = mutations.some(
      (mutation) =>
        state.activeSource?.contains(mutation.target as Node) ?? false
    );
    if (activeSourceChanged) {
      scheduleActiveRender();
    }
    scheduleLayout();
    scheduleViewportSelection();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  const unwatchSettings = readerSettings.watch((settings) => {
    state.settings = settings;
    if (!settings.enabled) {
      setPinned(false);
    }
    scheduleLayout();
  });

  ctx.onInvalidated(() => {
    observer.disconnect();
    unwatchSettings();
    state.activeSource?.removeAttribute(ACTIVE_ATTRIBUTE);
    elements.host.remove();
    document.documentElement.removeAttribute("data-better-x-density");
    document.documentElement.removeAttribute("data-better-x-layout");
  });

  applyLayout();
};

export default defineContentScript({
  main(ctx) {
    return startReader(ctx);
  },
  matches: ["*://x.com/*", "*://*.x.com/*"],
  runAt: "document_idle",
});
