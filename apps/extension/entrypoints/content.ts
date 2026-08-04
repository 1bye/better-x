import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { defineContentScript } from "wxt/utils/define-content-script";

import { type FocusSettings, focusSettings } from "../lib/settings";

import "../styles/content.css";

const ACTIVE_ATTRIBUTE = "data-better-x-focused";
const BOUNDARY_SELECTION_DELAY_MS = 300;
const CLOSE_DURATION_MS = 180;
const FOCUS_ATTRIBUTE = "data-better-x-focus-mode";
const FOCUS_BOTTOM_INSET = 82;
const FOCUS_OUTSET = 5;
const FOCUS_RADIUS = 18;
const FOCUS_TOP_INSET = 18;
const LIKE_SELECTOR = '[data-testid="like"], [data-testid="unlike"]';
const OPEN_DURATION_MS = 240;
const POST_SELECTOR =
  '[data-testid="primaryColumn"] article[data-testid="tweet"]';
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const REPLY_COMPOSER_SELECTOR =
  '[role="dialog"] [data-testid^="tweetTextarea_"], [role="dialog"] [contenteditable="true"]';
const REPLY_DETECTION_TIMEOUT_MS = 1200;
const REPLY_SELECTOR = '[data-testid="reply"]';
const STATUS_PATH_PATTERN = /^\/[^/]+\/status\/\d+\/?$/;

type NavigationDirection = -1 | 1;
type PageTheme = "dark" | "light";

interface FocusElements {
  backdrop: SVGRectElement;
  frame: HTMLDivElement;
  hole: SVGRectElement;
  host: HTMLElement;
  likeLabel: HTMLSpanElement;
  liveRegion: HTMLSpanElement;
  toolbar: HTMLElement;
}

interface FocusState {
  activePost: HTMLElement | null;
  hasObservedReplyComposer: boolean;
  isActive: boolean;
  isReplying: boolean;
  returnUrl: string | null;
  settings: FocusSettings;
}

interface SpotlightRect {
  height: number;
  left: number;
  top: number;
  width: number;
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

const createSvgElement = <K extends keyof SVGElementTagNameMap>(
  tagName: K
): SVGElementTagNameMap[K] =>
  document.createElementNS("http://www.w3.org/2000/svg", tagName);

const createShortcut = (
  keys: readonly string[],
  label: string
): HTMLSpanElement => {
  const shortcut = createElement("span", "better-x-focus__shortcut");
  const keyGroup = createElement("span", "better-x-focus__keys");
  keyGroup.dataset.name = "KbdGroup";
  keyGroup.dataset.slot = "kbd-group";
  for (const key of keys) {
    const keycap = createElement("kbd", undefined, key);
    keycap.dataset.name = "Kbd";
    keycap.dataset.slot = "kbd";
    keyGroup.append(keycap);
  }
  shortcut.append(
    keyGroup,
    createElement("span", "better-x-focus__shortcut-label", label)
  );
  return shortcut;
};

const createFocusElements = (): FocusElements => {
  const host = document.createElement("better-x-focus");
  host.hidden = true;
  host.setAttribute("aria-label", "Better X Focus Mode");

  const maskId = "better-x-focus-mask";
  const backdropLayer = createSvgElement("svg");
  backdropLayer.classList.add("better-x-focus__backdrop-layer");
  backdropLayer.setAttribute("aria-hidden", "true");
  backdropLayer.setAttribute("preserveAspectRatio", "none");

  const definitions = createSvgElement("defs");
  const mask = createSvgElement("mask");
  mask.id = maskId;
  mask.setAttribute("height", "100%");
  mask.setAttribute("maskContentUnits", "userSpaceOnUse");
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  mask.setAttribute("width", "100%");
  mask.setAttribute("x", "0");
  mask.setAttribute("y", "0");

  const maskFill = createSvgElement("rect");
  maskFill.setAttribute("fill", "white");
  maskFill.setAttribute("height", "100%");
  maskFill.setAttribute("width", "100%");

  const hole = createSvgElement("rect");
  hole.classList.add("better-x-focus__hole");
  hole.setAttribute("fill", "black");
  hole.setAttribute("height", "0");
  hole.setAttribute("rx", String(FOCUS_RADIUS));
  hole.setAttribute("width", "0");

  const backdrop = createSvgElement("rect");
  backdrop.classList.add("better-x-focus__backdrop");
  backdrop.setAttribute("fill", "black");
  backdrop.setAttribute("height", "100%");
  backdrop.setAttribute("mask", `url(#${maskId})`);
  backdrop.setAttribute("width", "100%");

  mask.append(maskFill, hole);
  definitions.append(mask);
  backdropLayer.append(definitions, backdrop);

  const frame = createElement("div", "better-x-focus__frame");
  frame.hidden = true;

  const toolbar = createElement("div", "better-x-focus__toolbar");
  toolbar.setAttribute("aria-label", "Focus Mode keyboard shortcuts");
  toolbar.append(createShortcut(["↑", "↓"], "Navigate"));

  const likeShortcut = createShortcut(["L"], "Like");
  const likeLabel = likeShortcut.querySelector<HTMLSpanElement>(
    ".better-x-focus__shortcut-label"
  );
  if (!likeLabel) {
    throw new Error("Focus Mode like label could not be created.");
  }

  toolbar.append(
    likeShortcut,
    createShortcut(["R"], "Reply"),
    createShortcut(["↵"], "Open"),
    createShortcut(["Esc"], "Exit")
  );

  const liveRegion = createElement("span", "better-x-focus__live-region");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("role", "status");

  host.append(backdropLayer, frame, toolbar, liveRegion);
  document.body.append(host);

  return {
    backdrop,
    frame,
    hole,
    host,
    likeLabel,
    liveRegion,
    toolbar,
  };
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])"
    )
  );
};

const isFocusShortcut = (event: KeyboardEvent): boolean =>
  event.code === "KeyF" &&
  event.shiftKey &&
  !(event.altKey || event.ctrlKey || event.metaKey);

const isReplyComposerOpen = (): boolean => {
  const composer = document.querySelector(REPLY_COMPOSER_SELECTOR);
  if (!composer) {
    return false;
  }
  const nativeDialog = composer.closest<HTMLDialogElement>("dialog");
  if (nativeDialog) {
    return nativeDialog.open;
  }
  const dialog = composer.closest('[role="dialog"]');
  return Boolean(dialog?.getClientRects().length);
};

const getPageTheme = (): PageTheme => {
  const background = getComputedStyle(document.body).backgroundColor;
  const channels = background
    .match(/\d+(?:\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length < 3) {
    return "light";
  }
  const [red, green, blue] = channels;
  const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
  return luminance < 100 ? "dark" : "light";
};

const getPostLink = (post: HTMLElement): HTMLAnchorElement | null => {
  const links = post.querySelectorAll<HTMLAnchorElement>("a[href]");
  let fallbackLink: HTMLAnchorElement | null = null;
  for (const link of links) {
    const url = new URL(link.href, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      !STATUS_PATH_PATTERN.test(url.pathname)
    ) {
      continue;
    }
    if (link.querySelector("time")) {
      return link;
    }
    fallbackLink ??= link;
  }
  return fallbackLink;
};

const getPosts = (): readonly HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(POST_SELECTOR)).filter(
    (post) => post.isConnected && getPostLink(post)
  );

const findNearestVisiblePost = (): HTMLElement | null => {
  const viewportCenter = window.innerHeight / 2;
  let nearestPost: HTMLElement | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const post of getPosts()) {
    const rect = post.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      continue;
    }
    const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
    if (distance < nearestDistance) {
      nearestPost = post;
      nearestDistance = distance;
    }
  }

  return nearestPost;
};

const focusScrollBehavior = (): ScrollBehavior =>
  window.matchMedia(REDUCED_MOTION_QUERY).matches ? "auto" : "smooth";

const getSpotlightRect = (post: HTMLElement): SpotlightRect => {
  const rect = post.getBoundingClientRect();
  const availableHeight = Math.max(
    0,
    window.innerHeight - FOCUS_TOP_INSET - FOCUS_BOTTOM_INSET
  );
  const height = Math.min(rect.height + FOCUS_OUTSET * 2, availableHeight);
  const left = Math.max(0, rect.left - FOCUS_OUTSET);
  const right = Math.min(window.innerWidth, rect.right + FOCUS_OUTSET);
  return {
    height,
    left,
    top: FOCUS_TOP_INSET + (availableHeight - height) / 2,
    width: Math.max(0, right - left),
  };
};

const scrollPostIntoSpotlight = (post: HTMLElement): void => {
  const postRect = post.getBoundingClientRect();
  const spotlight = getSpotlightRect(post);
  const postTop = spotlight.top + FOCUS_OUTSET;
  window.scrollBy({
    behavior: focusScrollBehavior(),
    top: postRect.top - postTop,
  });
};

const startFocusMode = async (ctx: ContentScriptContext): Promise<void> => {
  const initialSettings = await focusSettings.getValue();
  if (ctx.isInvalid) {
    return;
  }

  const elements = createFocusElements();
  const state: FocusState = {
    activePost: null,
    hasObservedReplyComposer: false,
    isActive: false,
    isReplying: false,
    returnUrl: null,
    settings: initialSettings,
  };

  let geometryFrame = 0;
  let hideTimer = 0;
  let replyDetectionTimer = 0;
  let selectionTimer = 0;

  const activePostObserver = new ResizeObserver(() => {
    if (!geometryFrame) {
      geometryFrame = ctx.requestAnimationFrame(updateGeometry);
    }
  });

  function announce(message: string): void {
    elements.liveRegion.textContent = "";
    ctx.requestAnimationFrame(() => {
      elements.liveRegion.textContent = message;
    });
  }

  function updateLikeLabel(): void {
    const isLiked = Boolean(
      state.activePost?.querySelector('[data-testid="unlike"]')
    );
    const label = isLiked ? "Unlike" : "Like";
    if (elements.likeLabel.textContent !== label) {
      elements.likeLabel.textContent = label;
    }
  }

  function updateGeometry(): void {
    geometryFrame = 0;
    const post = state.activePost;
    if (!(state.isActive && !state.isReplying && post?.isConnected)) {
      elements.frame.hidden = true;
      elements.hole.setAttribute("height", "0");
      elements.hole.setAttribute("width", "0");
      return;
    }

    const { height, left, top, width } = getSpotlightRect(post);
    const isVisible = width > 0 && height > 0;

    elements.frame.hidden = !isVisible;
    elements.hole.setAttribute("height", String(height));
    elements.hole.setAttribute(
      "rx",
      String(Math.min(FOCUS_RADIUS, height / 2))
    );
    elements.hole.setAttribute("width", String(width));
    elements.hole.setAttribute("x", String(left));
    elements.hole.setAttribute("y", String(top));
    elements.frame.style.setProperty("--better-x-focus-height", `${height}px`);
    elements.frame.style.setProperty("--better-x-focus-left", `${left}px`);
    elements.frame.style.setProperty("--better-x-focus-top", `${top}px`);
    elements.frame.style.setProperty("--better-x-focus-width", `${width}px`);
  }

  const scheduleGeometry = (): void => {
    if (geometryFrame) {
      return;
    }
    geometryFrame = ctx.requestAnimationFrame(updateGeometry);
  };

  const animateSelection = (): void => {
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      return;
    }
    for (const animation of elements.frame.getAnimations()) {
      animation.cancel();
    }
    elements.frame.animate(
      [
        { opacity: 0.45, scale: "0.985" },
        { opacity: 1, scale: "1" },
      ],
      {
        duration: OPEN_DURATION_MS,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      }
    );
  };

  const selectPost = (post: HTMLElement, shouldScroll = true): void => {
    if (!post.isConnected) {
      return;
    }
    if (state.activePost !== post) {
      if (state.activePost) {
        activePostObserver.unobserve(state.activePost);
        state.activePost.removeAttribute(ACTIVE_ATTRIBUTE);
      }
      state.activePost = post;
      post.setAttribute(ACTIVE_ATTRIBUTE, "true");
      activePostObserver.observe(post);
      animateSelection();
    }

    updateLikeLabel();
    scheduleGeometry();
    if (shouldScroll) {
      scrollPostIntoSpotlight(post);
    }
  };

  const selectNearestPost = (shouldScroll = false): boolean => {
    const post = findNearestVisiblePost();
    if (!post) {
      return false;
    }
    selectPost(post, shouldScroll);
    return true;
  };

  const clearReplyDetectionTimer = (): void => {
    if (!replyDetectionTimer) {
      return;
    }
    window.clearTimeout(replyDetectionTimer);
    replyDetectionTimer = 0;
  };

  const hideFocusSurface = (): void => {
    delete elements.host.dataset.open;
    if (hideTimer) {
      window.clearTimeout(hideTimer);
    }
    hideTimer = ctx.setTimeout(() => {
      if (!state.isActive || state.isReplying) {
        elements.host.hidden = true;
      }
      hideTimer = 0;
    }, CLOSE_DURATION_MS);
  };

  const showFocusSurface = (): void => {
    if (!(state.isActive && !state.isReplying)) {
      return;
    }
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = 0;
    }
    elements.host.dataset.theme = getPageTheme();
    elements.host.hidden = false;
    ctx.requestAnimationFrame(() => {
      if (state.isActive && !state.isReplying) {
        elements.host.dataset.open = "true";
      }
    });
  };

  const enterFocusMode = (): void => {
    if (!state.settings.enabled) {
      return;
    }
    const post = findNearestVisiblePost();
    if (!post) {
      return;
    }
    state.isActive = true;
    state.isReplying = false;
    state.returnUrl = null;
    document.documentElement.setAttribute(FOCUS_ATTRIBUTE, "true");
    showFocusSurface();
    selectPost(post);
    announce("Focus Mode on");
  };

  const exitFocusMode = (): void => {
    if (!state.isActive) {
      return;
    }
    state.isActive = false;
    state.hasObservedReplyComposer = false;
    state.isReplying = false;
    state.returnUrl = null;
    clearReplyDetectionTimer();
    document.documentElement.removeAttribute(FOCUS_ATTRIBUTE);
    if (state.activePost) {
      activePostObserver.unobserve(state.activePost);
      state.activePost.removeAttribute(ACTIVE_ATTRIBUTE);
      state.activePost = null;
    }
    hideFocusSurface();
  };

  const resumeFocusSurface = (): void => {
    if (!state.isReplying) {
      return;
    }
    clearReplyDetectionTimer();
    state.hasObservedReplyComposer = false;
    state.isReplying = false;
    if (!state.isActive) {
      return;
    }
    if (!(state.activePost?.isConnected || selectNearestPost())) {
      exitFocusMode();
      return;
    }
    document.documentElement.setAttribute(FOCUS_ATTRIBUTE, "true");
    state.activePost?.setAttribute(ACTIVE_ATTRIBUTE, "true");
    showFocusSurface();
    scheduleGeometry();
  };

  const suspendFocusSurfaceForReply = (): void => {
    state.hasObservedReplyComposer = false;
    state.isReplying = true;
    document.documentElement.removeAttribute(FOCUS_ATTRIBUTE);
    state.activePost?.removeAttribute(ACTIVE_ATTRIBUTE);
    hideFocusSurface();
    clearReplyDetectionTimer();
    replyDetectionTimer = ctx.setTimeout(() => {
      if (state.isReplying && !state.hasObservedReplyComposer) {
        resumeFocusSurface();
      }
    }, REPLY_DETECTION_TIMEOUT_MS);
  };

  const syncReplySurface = (): boolean => {
    if (!state.isReplying) {
      return false;
    }
    const hasReplyComposer = isReplyComposerOpen();
    if (hasReplyComposer) {
      state.hasObservedReplyComposer = true;
      clearReplyDetectionTimer();
      return true;
    }
    if (state.hasObservedReplyComposer) {
      resumeFocusSurface();
    }
    return true;
  };

  const scheduleBoundarySelection = (direction: NavigationDirection): void => {
    if (selectionTimer) {
      window.clearTimeout(selectionTimer);
    }
    window.scrollBy({
      behavior: focusScrollBehavior(),
      top: direction * window.innerHeight * 0.72,
    });
    selectionTimer = ctx.setTimeout(() => {
      selectionTimer = 0;
      const posts = getPosts();
      const currentIndex = state.activePost
        ? posts.indexOf(state.activePost)
        : -1;
      const nextPost =
        currentIndex >= 0 ? posts[currentIndex + direction] : null;
      if (nextPost) {
        selectPost(nextPost);
        return;
      }
      selectNearestPost(true);
    }, BOUNDARY_SELECTION_DELAY_MS);
  };

  const moveSelection = (direction: NavigationDirection): void => {
    const posts = getPosts();
    if (posts.length === 0) {
      return;
    }
    const currentIndex = state.activePost
      ? posts.indexOf(state.activePost)
      : -1;
    if (currentIndex < 0) {
      selectNearestPost(true);
      return;
    }
    const nextPost = posts[currentIndex + direction];
    if (!nextPost) {
      scheduleBoundarySelection(direction);
      return;
    }
    selectPost(nextPost);
    announce(direction > 0 ? "Next post" : "Previous post");
  };

  const likePost = (): void => {
    const button =
      state.activePost?.querySelector<HTMLButtonElement>(LIKE_SELECTOR);
    if (!button) {
      announce("Like is unavailable for this post");
      return;
    }
    const wasLiked = button.dataset.testid === "unlike";
    button.click();
    announce(wasLiked ? "Post unliked" : "Post liked");
    ctx.setTimeout(updateLikeLabel, OPEN_DURATION_MS);
  };

  const replyToPost = (): void => {
    const button =
      state.activePost?.querySelector<HTMLButtonElement>(REPLY_SELECTOR);
    if (!button) {
      announce("Reply is unavailable for this post");
      return;
    }
    suspendFocusSurfaceForReply();
    button.click();
    announce("Reply composer opened");
  };

  const openPost = (): void => {
    if (!state.activePost) {
      return;
    }
    const link = getPostLink(state.activePost);
    if (!link) {
      announce("This conversation cannot be opened");
      return;
    }
    state.returnUrl = window.location.href;
    link.click();
    announce("Conversation opened");
  };

  const returnToFeed = (): void => {
    if (!state.returnUrl) {
      return;
    }
    state.returnUrl = null;
    window.history.back();
  };

  const consumeKeyEvent = (event: KeyboardEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const handleNavigationKey = (event: KeyboardEvent): boolean => {
    if (event.key === "ArrowDown") {
      moveSelection(1);
      return true;
    }
    if (event.key === "ArrowUp") {
      moveSelection(-1);
      return true;
    }
    if (event.key === "ArrowRight" || event.key === "Enter") {
      openPost();
      return true;
    }
    if (event.key === "ArrowLeft" && state.returnUrl) {
      returnToFeed();
      return true;
    }
    return false;
  };

  const handlePostActionKey = (event: KeyboardEvent): boolean => {
    if (event.repeat) {
      return false;
    }
    if (event.key.toLowerCase() === "l") {
      likePost();
      return true;
    }
    if (event.key.toLowerCase() === "r") {
      replyToPost();
      return true;
    }
    return false;
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) {
      return;
    }
    if (state.isReplying) {
      return;
    }
    if (isFocusShortcut(event)) {
      if (!state.settings.enabled) {
        return;
      }
      consumeKeyEvent(event);
      if (state.isActive) {
        exitFocusMode();
      } else {
        enterFocusMode();
      }
      return;
    }
    if (!state.isActive) {
      return;
    }
    if (event.key === "Escape") {
      consumeKeyEvent(event);
      exitFocusMode();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (handleNavigationKey(event)) {
      consumeKeyEvent(event);
      return;
    }
    if (handlePostActionKey(event)) {
      consumeKeyEvent(event);
    }
  };

  ctx.addEventListener(window, "keydown", handleKeyDown, { capture: true });
  ctx.addEventListener(window, "resize", scheduleGeometry, { passive: true });
  ctx.addEventListener(window, "scroll", scheduleGeometry, {
    capture: true,
    passive: true,
  });
  ctx.addEventListener(window, "wxt:locationchange", () => {
    if (!state.isActive) {
      return;
    }
    if (state.activePost && !state.activePost.isConnected) {
      activePostObserver.unobserve(state.activePost);
      state.activePost.removeAttribute(ACTIVE_ATTRIBUTE);
      state.activePost = null;
    }
    scheduleGeometry();
  });

  const pageObserver = new MutationObserver(() => {
    if (!state.isActive) {
      return;
    }
    if (syncReplySurface()) {
      return;
    }
    if (!state.activePost?.isConnected) {
      if (state.activePost) {
        activePostObserver.unobserve(state.activePost);
        state.activePost.removeAttribute(ACTIVE_ATTRIBUTE);
        state.activePost = null;
      }
      selectNearestPost();
      return;
    }
    updateLikeLabel();
    scheduleGeometry();
  });
  pageObserver.observe(document.body, {
    attributeFilter: ["aria-hidden", "open"],
    attributes: true,
    childList: true,
    subtree: true,
  });

  const unwatchSettings = focusSettings.watch((settings) => {
    state.settings = settings;
    if (!settings.enabled) {
      exitFocusMode();
    }
  });

  ctx.onInvalidated(() => {
    activePostObserver.disconnect();
    pageObserver.disconnect();
    unwatchSettings();
    if (geometryFrame) {
      window.cancelAnimationFrame(geometryFrame);
    }
    if (hideTimer) {
      window.clearTimeout(hideTimer);
    }
    clearReplyDetectionTimer();
    if (selectionTimer) {
      window.clearTimeout(selectionTimer);
    }
    state.activePost?.removeAttribute(ACTIVE_ATTRIBUTE);
    document.documentElement.removeAttribute(FOCUS_ATTRIBUTE);
    elements.host.remove();
  });
};

export default defineContentScript({
  main: startFocusMode,
  matches: ["*://x.com/*", "*://*.x.com/*"],
  runAt: "document_idle",
});
