import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { defineContentScript } from "wxt/utils/define-content-script";

import { type ReaderSettings, readerSettings } from "../lib/settings";

import "../styles/content.css";

const ACTIVE_ATTRIBUTE = "data-better-x-active";
const EMBED_LOAD_DELAY = 180;
const EMBED_URL = "https://platform.twitter.com/embed/Tweet.html";
const LANGUAGE_PATTERN = /^([a-z]{2,3})(?:-|$)/i;
const MINIMUM_SPLIT_WIDTH = 1040;
const PRIMARY_COLUMN_SELECTOR = '[data-testid="primaryColumn"]';
const PROFILE_PATH_PATTERN = /^\/[a-zA-Z0-9_]{1,30}\/?$/;
const STATUS_PATH_PATTERN = /^\/[^/]+\/status\/(\d+)\/?$/;
const SUPPORTED_ROUTES = new Set([
  "/bookmarks",
  "/explore",
  "/home",
  "/notifications",
  "/search",
]);
const TRAILING_SLASH_PATTERN = /\/$/;

type EmbedStatus = "error" | "idle" | "loading" | "ready";
type ReaderTheme = "dark" | "light";

interface PointerPosition {
  x: number;
  y: number;
}

interface ReaderElements {
  closeButton: HTMLButtonElement;
  embedFrame: HTMLIFrameElement;
  footerMode: HTMLSpanElement;
  host: HTMLElement;
  openLink: HTMLAnchorElement;
  pinButton: HTMLButtonElement;
  placeholder: HTMLDivElement;
  placeholderCopy: HTMLSpanElement;
  placeholderTitle: HTMLElement;
  status: HTMLSpanElement;
}

interface ReaderState {
  activePostUrl: string | null;
  activeSource: HTMLElement | null;
  embedStatus: EmbedStatus;
  embedTheme: ReaderTheme | null;
  isPinned: boolean;
  lastPointer: PointerPosition | null;
  loadedPostUrl: string | null;
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
  host.setAttribute("aria-label", "Better X embedded post reader");

  const reader = createElement("aside", "better-x-reader");
  reader.setAttribute("aria-label", "Selected X post");

  const toolbar = createElement("header", "better-x-reader__toolbar");
  const brand = createElement("div", "better-x-reader__brand");
  const mark = createElement("span", "better-x-reader__mark", "BX");
  mark.setAttribute("aria-hidden", "true");

  const titles = createElement("div", "better-x-reader__titles");
  const title = createElement("span", "better-x-reader__title", "Post");
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
  pinButton.title = "Keep this post selected (P)";

  const openLink = createElement(
    "a",
    "better-x-reader__open",
    "View replies ↗"
  );
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

  const viewport = createElement("div", "better-x-reader__viewport");
  const embedFrame = createElement("iframe", "better-x-reader__embed");
  embedFrame.allow =
    "autoplay; encrypted-media; fullscreen; picture-in-picture; web-share";
  embedFrame.hidden = true;
  embedFrame.loading = "eager";
  embedFrame.referrerPolicy = "strict-origin-when-cross-origin";
  embedFrame.title = "Official X embedded post";

  const placeholder = createElement("div", "better-x-reader__placeholder");
  placeholder.setAttribute("aria-live", "polite");
  placeholder.setAttribute("role", "status");
  const placeholderIcon = createElement(
    "span",
    "better-x-reader__placeholder-icon",
    "𝕏"
  );
  placeholderIcon.setAttribute("aria-hidden", "true");
  const placeholderTitle = createElement(
    "strong",
    "better-x-reader__placeholder-title",
    "Choose a post"
  );
  const placeholderCopy = createElement(
    "span",
    "better-x-reader__placeholder-copy",
    "Pause over a post to load its official X embed here."
  );
  placeholder.append(placeholderIcon, placeholderTitle, placeholderCopy);
  viewport.append(embedFrame, placeholder);

  const footer = createElement("footer", "better-x-reader__footer");
  const footerMode = createElement("span", undefined, "Official X embed");
  const shortcut = createElement("kbd", undefined, "P");
  const shortcutCopy = createElement(
    "span",
    undefined,
    "to pin · Esc to resume"
  );
  footer.append(footerMode, shortcut, shortcutCopy);

  reader.append(toolbar, viewport, footer);
  host.append(reader);
  document.body.append(host);

  return {
    closeButton,
    embedFrame,
    footerMode,
    host,
    openLink,
    pinButton,
    placeholder,
    placeholderCopy,
    placeholderTitle,
    status,
  };
};

const getPostUrl = (article: HTMLElement): string | null => {
  const links = article.querySelectorAll<HTMLAnchorElement>("a[href]");
  let fallbackUrl: string | null = null;
  for (const link of links) {
    const url = new URL(link.href, window.location.origin);
    if (
      url.origin === window.location.origin &&
      STATUS_PATH_PATTERN.test(url.pathname)
    ) {
      if (link.querySelector("time")) {
        return url.href;
      }
      fallbackUrl ??= url.href;
    }
  }
  return fallbackUrl;
};

const getPostId = (postUrl: string): string | null => {
  const match = new URL(postUrl).pathname.match(STATUS_PATH_PATTERN);
  return match?.[1] ?? null;
};

const getEmbedLanguage = (): string => {
  const language = document.documentElement.lang.match(LANGUAGE_PATTERN)?.[1];
  return language?.toLowerCase() ?? "en";
};

const getEmbedUrl = (postUrl: string, theme: ReaderTheme): string | null => {
  const postId = getPostId(postUrl);
  if (!postId) {
    return null;
  }

  const url = new URL(EMBED_URL);
  url.searchParams.set("dnt", "true");
  url.searchParams.set("id", postId);
  url.searchParams.set("lang", getEmbedLanguage());
  url.searchParams.set("theme", theme);
  return url.href;
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

const getPageTheme = (): ReaderTheme => {
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
    embedStatus: "idle",
    embedTheme: null,
    isPinned: false,
    lastPointer: null,
    loadedPostUrl: null,
    settings: initialSettings,
  };

  let embedTimer = 0;
  let layoutFrame = 0;
  let positionFrame = 0;
  let selectionFrame = 0;

  const updateModeLabels = (): void => {
    elements.host.dataset.embedStatus = state.embedStatus;
    elements.host.dataset.pinned = String(state.isPinned);
    elements.pinButton.setAttribute("aria-pressed", String(state.isPinned));
    elements.pinButton.textContent = state.isPinned ? "Pinned" : "Pin";

    if (state.embedStatus === "error") {
      elements.status.textContent = "Embed unavailable";
      elements.footerMode.textContent = "View replies on X";
      return;
    }
    if (state.embedStatus === "loading") {
      elements.status.textContent = "Loading X embed…";
      elements.footerMode.textContent = "Official X embed";
      return;
    }
    if (state.isPinned) {
      elements.status.textContent = "Pinned post";
      elements.footerMode.textContent = "Selection locked";
      return;
    }

    elements.status.textContent = state.settings.followCursor
      ? "Following cursor"
      : "Following scroll";
    elements.footerMode.textContent = "Official X embed";
  };

  const renderSelection = (): void => {
    const hasSelection = Boolean(state.activePostUrl);
    const embedIsCurrent =
      hasSelection &&
      state.loadedPostUrl === state.activePostUrl &&
      state.embedStatus === "ready";

    elements.openLink.hidden = !hasSelection;
    elements.pinButton.disabled = !hasSelection;
    elements.embedFrame.hidden = !(
      hasSelection &&
      state.loadedPostUrl === state.activePostUrl &&
      state.embedStatus !== "error"
    );
    elements.placeholder.hidden = Boolean(embedIsCurrent);

    if (state.activePostUrl) {
      elements.openLink.href = state.activePostUrl;
    }

    if (!hasSelection) {
      elements.placeholderTitle.textContent = "Choose a post";
      elements.placeholderCopy.textContent =
        "Pause over a post to load its official X embed here.";
      updateModeLabels();
      return;
    }
    if (state.embedStatus === "error") {
      elements.placeholderTitle.textContent = "This post cannot be embedded";
      elements.placeholderCopy.textContent =
        "Protected or restricted posts may only be available directly on X.";
      updateModeLabels();
      return;
    }

    elements.placeholderTitle.textContent = "Loading post…";
    elements.placeholderCopy.textContent =
      "Fetching the official X embed with media and post actions.";
    updateModeLabels();
  };

  const loadActiveEmbed = (): void => {
    embedTimer = 0;
    const postUrl = state.activePostUrl;
    if (!postUrl) {
      return;
    }

    const theme = getPageTheme();
    const embedUrl = getEmbedUrl(postUrl, theme);
    if (!embedUrl) {
      state.embedStatus = "error";
      renderSelection();
      return;
    }
    if (
      state.loadedPostUrl === postUrl &&
      state.embedTheme === theme &&
      state.embedStatus !== "error"
    ) {
      return;
    }

    state.embedStatus = "loading";
    state.embedTheme = theme;
    state.loadedPostUrl = postUrl;
    elements.embedFrame.src = embedUrl;
    renderSelection();
  };

  const scheduleEmbedLoad = (): void => {
    if (!state.activePostUrl) {
      return;
    }
    if (embedTimer) {
      window.clearTimeout(embedTimer);
    }
    state.embedStatus = "loading";
    renderSelection();
    embedTimer = ctx.setTimeout(loadActiveEmbed, EMBED_LOAD_DELAY);
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
    if (!force && state.activePostUrl === postUrl) {
      if (state.activeSource !== article) {
        state.activeSource?.removeAttribute(ACTIVE_ATTRIBUTE);
        state.activeSource = article;
        article.setAttribute(ACTIVE_ATTRIBUTE, "true");
      }
      return;
    }

    state.activeSource?.removeAttribute(ACTIVE_ATTRIBUTE);
    state.activeSource = article;
    state.activePostUrl = postUrl;
    article.setAttribute(ACTIVE_ATTRIBUTE, "true");
    scheduleEmbedLoad();
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

  const clearSelection = (): void => {
    if (embedTimer) {
      window.clearTimeout(embedTimer);
      embedTimer = 0;
    }
    state.activeSource?.removeAttribute(ACTIVE_ATTRIBUTE);
    state.activeSource = null;
    state.activePostUrl = null;
    state.embedStatus = "idle";
    state.isPinned = false;
    renderSelection();
  };

  const applyLayout = (): void => {
    const primaryColumn = document.querySelector(PRIMARY_COLUMN_SELECTOR);
    const shouldShowReader =
      state.settings.enabled &&
      isSupportedRoute() &&
      Boolean(primaryColumn) &&
      window.innerWidth >= MINIMUM_SPLIT_WIDTH;

    document.documentElement.toggleAttribute(
      "data-better-x-layout",
      shouldShowReader
    );
    if (shouldShowReader) {
      document.documentElement.dataset.betterXLayout = "split";
    }

    const shouldCompact = shouldShowReader && state.settings.compactFeed;
    document.documentElement.toggleAttribute(
      "data-better-x-density",
      shouldCompact
    );
    if (shouldCompact) {
      document.documentElement.dataset.betterXDensity = "compact";
    }

    elements.host.hidden = !shouldShowReader;
    updateModeLabels();

    if (shouldShowReader) {
      scheduleReaderPosition();
      scheduleViewportSelection();
      return;
    }
    clearSelection();
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

  const handleEmbedLoad = (): void => {
    if (state.activePostUrl && state.loadedPostUrl === state.activePostUrl) {
      state.embedStatus = "ready";
      renderSelection();
    }
  };

  const handleEmbedError = (): void => {
    if (state.activePostUrl && state.loadedPostUrl === state.activePostUrl) {
      state.embedStatus = "error";
      renderSelection();
    }
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
  ctx.addEventListener(elements.embedFrame, "load", handleEmbedLoad);
  ctx.addEventListener(elements.embedFrame, "error", handleEmbedError);
  ctx.addEventListener(elements.pinButton, "click", () => {
    setPinned(!state.isPinned);
  });
  ctx.addEventListener(elements.closeButton, "click", async () => {
    await disableReader();
  });

  const observer = new MutationObserver(() => {
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
  main: startReader,
  matches: ["*://x.com/*", "*://*.x.com/*"],
  runAt: "document_idle",
});
