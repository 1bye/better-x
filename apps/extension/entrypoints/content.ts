import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { defineContentScript } from "wxt/utils/define-content-script";
import { fitFocusScale } from "../lib/focus-scale";
import { IMAGE_EDITOR_OPEN_ATTRIBUTE } from "../lib/image-editor";
import {
  FOCUS_SCALES,
  type FocusScale,
  type FocusSettings,
  focusAnimations,
  focusScale,
  focusSettings,
  isFocusScale,
} from "../lib/settings";
import { startImageEditor } from "../lib/start-image-editor";

import "../styles/content.css";

const ACTIVE_ATTRIBUTE = "data-better-x-focused";
const ANIMATIONS_ATTRIBUTE = "data-better-x-animations";
const BOOKMARK_SELECTOR =
  '[data-testid="bookmark"], [data-testid="removeBookmark"]';
const BOUNDARY_SELECTION_DELAY_MS = 300;
const CLOSE_DURATION_MS = 180;
const FEEDBACK_DURATION_MS = 1400;
const FOCUS_ATTRIBUTE = "data-better-x-focus-mode";
const FOCUS_BOTTOM_INSET = 82;
const FOCUS_OUTSET = 5;
const FOCUS_RADIUS = 18;
const FOCUS_TOP_INSET = 18;
const LIKE_SELECTOR = '[data-testid="like"], [data-testid="unlike"]';
const OPEN_DURATION_MS = 240;
const PEEKING_ATTRIBUTE = "data-better-x-peeking";
const POST_SELECTOR =
  '[data-testid="primaryColumn"] article[data-testid="tweet"]';
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const REPLY_COMPOSER_SELECTOR =
  '[role="dialog"] [data-testid^="tweetTextarea_"], [role="dialog"] [contenteditable="true"]';
const REPLY_DETECTION_TIMEOUT_MS = 1200;
const REPLY_SELECTOR = '[data-testid="reply"]';
const SCALE_ANIMATION_DURATION_MS = 360;
const SCALE_FIT_EPSILON = 0.005;
const SCALE_OVERSHOOT_MAX = 0.035;
const SCALE_OVERSHOOT_RATIO = 0.18;
const SCALED_CONTAINER_ATTRIBUTE = "data-better-x-scaled-container";
const STATUS_PATH_PATTERN = /^\/[^/]+\/status\/\d+\/?$/;
const TOOLBAR_IDLE_DELAY_MS = 2200;
const TRANSPARENT_BACKGROUNDS = new Set([
  "rgba(0, 0, 0, 0)",
  "rgba(0,0,0,0)",
  "transparent",
]);

type NavigationDirection = -1 | 1;

interface FocusElements {
  bookmarkLabel: HTMLSpanElement;
  feedback: HTMLDivElement;
  feedbackIcon: HTMLSpanElement;
  feedbackLabel: HTMLSpanElement;
  hole: SVGRectElement;
  host: HTMLElement;
  likeLabel: HTMLSpanElement;
  liveRegion: HTMLSpanElement;
  motionLabel: HTMLSpanElement;
  scaleLabel: HTMLSpanElement;
  toolbar: HTMLElement;
}

interface FocusState {
  activePost: HTMLElement | null;
  animationsEnabled: boolean;
  effectivePostScale: number;
  hasObservedReplyComposer: boolean;
  isActive: boolean;
  isPeeking: boolean;
  isReplying: boolean;
  postScale: FocusScale;
  returnUrl: string | null;
  settings: FocusSettings;
}

interface SpotlightRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface InlineStyleSnapshot {
  priority: string;
  value: string;
}

interface FeedbackOptions {
  dismissAfterMs?: number;
  symbol?: string;
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

  const motionShortcut = createShortcut(["A"], "Motion");
  const motionLabel = motionShortcut.querySelector<HTMLSpanElement>(
    ".better-x-focus__shortcut-label"
  );
  if (!motionLabel) {
    throw new Error("Focus Mode motion label could not be created.");
  }

  const scaleShortcut = createShortcut(["S"], "Scale 1×");
  const scaleLabel = scaleShortcut.querySelector<HTMLSpanElement>(
    ".better-x-focus__shortcut-label"
  );
  if (!scaleLabel) {
    throw new Error("Focus Mode scale label could not be created.");
  }

  const bookmarkShortcut = createShortcut(["B"], "Bookmark");
  const bookmarkLabel = bookmarkShortcut.querySelector<HTMLSpanElement>(
    ".better-x-focus__shortcut-label"
  );
  if (!bookmarkLabel) {
    throw new Error("Focus Mode bookmark label could not be created.");
  }

  toolbar.append(
    createShortcut(["Space"], "Peek"),
    likeShortcut,
    bookmarkShortcut,
    createShortcut(["C"], "Copy"),
    createShortcut(["R"], "Reply"),
    createShortcut(["↵"], "Open"),
    motionShortcut,
    scaleShortcut,
    createShortcut(["Esc"], "Exit")
  );

  const feedback = createElement("div", "better-x-focus__feedback");
  feedback.setAttribute("aria-hidden", "true");
  const feedbackIcon = createElement(
    "span",
    "better-x-focus__feedback-icon",
    "✓"
  );
  const feedbackLabel = createElement("span", "better-x-focus__feedback-label");
  feedback.append(feedbackIcon, feedbackLabel);

  const liveRegion = createElement("span", "better-x-focus__live-region");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("role", "status");

  host.append(backdropLayer, feedback, toolbar, liveRegion);
  document.body.append(host);

  return {
    bookmarkLabel,
    feedback,
    feedbackIcon,
    feedbackLabel,
    hole,
    host,
    likeLabel,
    liveRegion,
    motionLabel,
    scaleLabel,
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

const isContextPeekShortcut = (event: KeyboardEvent): boolean =>
  event.code === "Space" &&
  !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);

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

const getPostBackgroundColor = (post: HTMLElement): string => {
  let element = post.parentElement;
  while (element) {
    const { backgroundColor } = getComputedStyle(element);
    if (!TRANSPARENT_BACKGROUNDS.has(backgroundColor)) {
      return backgroundColor;
    }
    element = element.parentElement;
  }
  return "Canvas";
};

const getPostContainer = (post: HTMLElement): HTMLElement | null =>
  post.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ??
  post.parentElement;

const clearFocusFill = (container: HTMLElement): void => {
  container.style.removeProperty("--better-x-focus-fill-background");
  container.style.removeProperty("--better-x-focus-fill-height");
  container.style.removeProperty("--better-x-focus-fill-left");
  container.style.removeProperty("--better-x-focus-fill-radius");
  container.style.removeProperty("--better-x-focus-fill-top");
  container.style.removeProperty("--better-x-focus-fill-width");
};

const updateFocusFill = (post: HTMLElement, spotlight: SpotlightRect): void => {
  const container = getPostContainer(post);
  if (!container?.hasAttribute(SCALED_CONTAINER_ATTRIBUTE)) {
    return;
  }
  const containerRect = container.getBoundingClientRect();
  container.style.setProperty(
    "--better-x-focus-fill-background",
    getPostBackgroundColor(post)
  );
  container.style.setProperty(
    "--better-x-focus-fill-height",
    `${spotlight.height}px`
  );
  container.style.setProperty(
    "--better-x-focus-fill-left",
    `${spotlight.left - containerRect.left}px`
  );
  container.style.setProperty(
    "--better-x-focus-fill-radius",
    `${Math.min(FOCUS_RADIUS, spotlight.height / 2)}px`
  );
  container.style.setProperty(
    "--better-x-focus-fill-top",
    `${spotlight.top - containerRect.top}px`
  );
  container.style.setProperty(
    "--better-x-focus-fill-width",
    `${spotlight.width}px`
  );
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

const getCanonicalPostUrl = (post: HTMLElement): string | null => {
  const link = getPostLink(post);
  if (!link) {
    return null;
  }
  const url = new URL(link.href, window.location.origin);
  url.hash = "";
  url.search = "";
  return url.href;
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

const formatFocusScale = (scale: number): string =>
  `${Number(scale.toFixed(2))}×`;

const getNextFocusScale = (currentScale: FocusScale): FocusScale => {
  const currentIndex = FOCUS_SCALES.indexOf(currentScale);
  return FOCUS_SCALES[currentIndex + 1] ?? FOCUS_SCALES[0];
};

const focusScrollBehavior = (animationsEnabled: boolean): ScrollBehavior =>
  animationsEnabled && !window.matchMedia(REDUCED_MOTION_QUERY).matches
    ? "smooth"
    : "auto";

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

const getAdaptivePostScale = (
  post: HTMLElement,
  requestedScale: FocusScale
): number => {
  const rect = post.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const availableHalfWidth = Math.max(
    0,
    Math.min(centerX, window.innerWidth - centerX) - FOCUS_OUTSET
  );
  return fitFocusScale({
    availableHeight: Math.max(
      0,
      window.innerHeight -
        FOCUS_TOP_INSET -
        FOCUS_BOTTOM_INSET -
        FOCUS_OUTSET * 2
    ),
    availableWidth: availableHalfWidth * 2,
    postHeight: post.offsetHeight,
    postWidth: post.offsetWidth,
    requestedScale,
  });
};

const scrollPostIntoSpotlight = (
  post: HTMLElement,
  animationsEnabled: boolean
): void => {
  const postRect = post.getBoundingClientRect();
  const spotlight = getSpotlightRect(post);
  const postTop = spotlight.top + FOCUS_OUTSET;
  window.scrollBy({
    behavior: focusScrollBehavior(animationsEnabled),
    top: postRect.top - postTop,
  });
};

const startFocusMode = async (ctx: ContentScriptContext): Promise<void> => {
  const [initialSettings, animationsEnabled, savedScale] = await Promise.all([
    focusSettings.getValue(),
    focusAnimations.getValue(),
    focusScale.getValue(),
  ]);
  if (ctx.isInvalid) {
    return;
  }

  const elements = createFocusElements();
  const initialScale = isFocusScale(savedScale) ? savedScale : FOCUS_SCALES[0];
  const state: FocusState = {
    activePost: null,
    animationsEnabled,
    effectivePostScale: initialScale,
    hasObservedReplyComposer: false,
    isActive: false,
    isPeeking: false,
    isReplying: false,
    postScale: initialScale,
    returnUrl: null,
    settings: initialSettings,
  };
  const inlineBackgroundSnapshots = new WeakMap<
    HTMLElement,
    InlineStyleSnapshot
  >();

  let geometryFrame = 0;
  let feedbackTimer = 0;
  let hideTimer = 0;
  let postScaleAnimation: Animation | null = null;
  let replyDetectionTimer = 0;
  let scaleTrackingEndTime = 0;
  let scaleTrackingFrame = 0;
  let selectionTimer = 0;
  let toolbarIdleTimer = 0;

  const activePostObserver = new ResizeObserver(() => {
    refreshAdaptiveScale();
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

  function clearToolbarIdleTimer(): void {
    if (!toolbarIdleTimer) {
      return;
    }
    window.clearTimeout(toolbarIdleTimer);
    toolbarIdleTimer = 0;
  }

  function revealToolbar(): void {
    clearToolbarIdleTimer();
    delete elements.host.dataset.toolbarQuiet;
    if (!(state.isActive && !state.isReplying)) {
      return;
    }
    toolbarIdleTimer = ctx.setTimeout(() => {
      if (state.isActive && !state.isReplying) {
        elements.host.dataset.toolbarQuiet = "true";
      }
      toolbarIdleTimer = 0;
    }, TOOLBAR_IDLE_DELAY_MS);
  }

  function hideFeedback(): void {
    if (feedbackTimer) {
      window.clearTimeout(feedbackTimer);
      feedbackTimer = 0;
    }
    delete elements.feedback.dataset.visible;
  }

  function showFeedback(
    message: string,
    {
      dismissAfterMs = FEEDBACK_DURATION_MS,
      symbol = "✓",
    }: FeedbackOptions = {}
  ): void {
    announce(message);
    revealToolbar();
    hideFeedback();
    elements.feedbackIcon.textContent = symbol;
    elements.feedbackLabel.textContent = message;
    elements.feedback.dataset.visible = "true";
    if (dismissAfterMs > 0) {
      feedbackTimer = ctx.setTimeout(() => {
        delete elements.feedback.dataset.visible;
        feedbackTimer = 0;
      }, dismissAfterMs);
    }
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

  function updateBookmarkLabel(): void {
    const isBookmarked = Boolean(
      state.activePost?.querySelector('[data-testid="removeBookmark"]')
    );
    const label = isBookmarked ? "Unbookmark" : "Bookmark";
    if (elements.bookmarkLabel.textContent !== label) {
      elements.bookmarkLabel.textContent = label;
    }
  }

  function updatePostActionLabels(): void {
    updateLikeLabel();
    updateBookmarkLabel();
  }

  function updateMotionPreference(): void {
    elements.host.dataset.animations = String(state.animationsEnabled);
    document.documentElement.setAttribute(
      ANIMATIONS_ATTRIBUTE,
      String(state.animationsEnabled)
    );
    elements.motionLabel.textContent = state.animationsEnabled
      ? "Motion"
      : "Instant";
  }

  function restorePostBackground(post: HTMLElement): void {
    const snapshot = inlineBackgroundSnapshots.get(post);
    if (!snapshot) {
      return;
    }
    if (snapshot.value) {
      post.style.setProperty(
        "background-color",
        snapshot.value,
        snapshot.priority
      );
    } else {
      post.style.removeProperty("background-color");
    }
    inlineBackgroundSnapshots.delete(post);
  }

  function cancelPostScaleAnimation(): void {
    const animation = postScaleAnimation;
    postScaleAnimation = null;
    animation?.cancel();
  }

  function clearPostScalePresentation(post: HTMLElement): void {
    cancelPostScaleAnimation();
    delete post.dataset.betterXScale;
    post.style.removeProperty("--better-x-post-scale");
    restorePostBackground(post);
    const container = getPostContainer(post);
    if (container) {
      container.removeAttribute(SCALED_CONTAINER_ATTRIBUTE);
      clearFocusFill(container);
    }
  }

  function updateScalePreference(preserveScaledSurface = false): void {
    elements.host.dataset.scale = String(state.postScale);
    const post = state.activePost;
    if (!post) {
      state.effectivePostScale = state.postScale;
      elements.host.dataset.effectiveScale = String(state.effectivePostScale);
      elements.scaleLabel.textContent = `Scale ${formatFocusScale(
        state.postScale
      )}`;
      return;
    }
    state.effectivePostScale = getAdaptivePostScale(post, state.postScale);
    const isFitted =
      state.effectivePostScale < state.postScale - SCALE_FIT_EPSILON;
    elements.host.dataset.effectiveScale = String(state.effectivePostScale);
    elements.scaleLabel.textContent = isFitted
      ? `Scale ${formatFocusScale(state.postScale)} · Fit ${formatFocusScale(
          state.effectivePostScale
        )}`
      : `Scale ${formatFocusScale(state.postScale)}`;
    post.dataset.betterXScale = String(state.effectivePostScale);
    post.style.setProperty(
      "--better-x-post-scale",
      String(state.effectivePostScale)
    );
    const container = getPostContainer(post);
    if (
      (state.effectivePostScale <= FOCUS_SCALES[0] + SCALE_FIT_EPSILON &&
        !preserveScaledSurface) ||
      !state.isActive ||
      state.isPeeking ||
      state.isReplying
    ) {
      restorePostBackground(post);
      if (container) {
        container.removeAttribute(SCALED_CONTAINER_ATTRIBUTE);
        clearFocusFill(container);
      }
      return;
    }
    if (!inlineBackgroundSnapshots.has(post)) {
      inlineBackgroundSnapshots.set(post, {
        priority: post.style.getPropertyPriority("background-color"),
        value: post.style.getPropertyValue("background-color"),
      });
    }
    post.style.setProperty(
      "background-color",
      getPostBackgroundColor(post),
      "important"
    );
    if (container) {
      container.setAttribute(SCALED_CONTAINER_ATTRIBUTE, "true");
      updateFocusFill(post, getSpotlightRect(post));
    }
  }

  function refreshAdaptiveScale(): void {
    const previousScale = state.effectivePostScale;
    updateScalePreference();
    if (
      Math.abs(state.effectivePostScale - previousScale) > SCALE_FIT_EPSILON
    ) {
      cancelPostScaleAnimation();
    }
  }

  function updateGeometry(): void {
    geometryFrame = 0;
    const post = state.activePost;
    if (
      !(
        state.isActive &&
        !state.isPeeking &&
        !state.isReplying &&
        post?.isConnected
      )
    ) {
      elements.hole.setAttribute("height", "0");
      elements.hole.setAttribute("width", "0");
      return;
    }

    const { height, left, top, width } = getSpotlightRect(post);
    elements.hole.setAttribute("height", String(height));
    elements.hole.setAttribute(
      "rx",
      String(Math.min(FOCUS_RADIUS, height / 2))
    );
    elements.hole.setAttribute("width", String(width));
    elements.hole.setAttribute("x", String(left));
    elements.hole.setAttribute("y", String(top));
    updateFocusFill(post, { height, left, top, width });
  }

  const scheduleGeometry = (): void => {
    if (geometryFrame) {
      return;
    }
    geometryFrame = ctx.requestAnimationFrame(updateGeometry);
  };

  const trackScaleGeometry = (): void => {
    scaleTrackingEndTime =
      window.performance.now() +
      (state.animationsEnabled ? SCALE_ANIMATION_DURATION_MS : 0);
    if (scaleTrackingFrame) {
      return;
    }
    const trackFrame = (): void => {
      scaleTrackingFrame = 0;
      scheduleGeometry();
      if (
        state.isActive &&
        !state.isReplying &&
        window.performance.now() < scaleTrackingEndTime
      ) {
        scaleTrackingFrame = ctx.requestAnimationFrame(trackFrame);
      }
    };
    trackFrame();
  };

  const isScaleMotionEnabled = (): boolean =>
    state.animationsEnabled &&
    state.isActive &&
    !state.isPeeking &&
    !state.isReplying &&
    !window.matchMedia(REDUCED_MOTION_QUERY).matches;

  const getRenderedPostScale = (
    post: HTMLElement,
    fallbackScale: number
  ): number => {
    const renderedScale = Number.parseFloat(getComputedStyle(post).scale);
    return Number.isFinite(renderedScale) ? renderedScale : fallbackScale;
  };

  const animatePostScale = (
    post: HTMLElement,
    fromScale: number,
    toScale: number
  ): void => {
    cancelPostScaleAnimation();
    const direction = Math.sign(toScale - fromScale);
    const overshoot =
      toScale +
      direction *
        Math.min(
          SCALE_OVERSHOOT_MAX,
          Math.abs(toScale - fromScale) * SCALE_OVERSHOOT_RATIO
        );
    const animation = post.animate(
      [
        {
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          offset: 0,
          scale: String(fromScale),
        },
        {
          easing: "ease-out",
          offset: 0.76,
          scale: String(overshoot),
        },
        { offset: 1, scale: String(toScale) },
      ],
      {
        duration: SCALE_ANIMATION_DURATION_MS,
      }
    );
    postScaleAnimation = animation;
    animation.onfinish = () => {
      if (postScaleAnimation !== animation) {
        return;
      }
      postScaleAnimation = null;
      updateScalePreference();
      scheduleGeometry();
    };
  };

  const applyPostScale = (nextScale: FocusScale): void => {
    const previousScale = state.postScale;
    if (nextScale === previousScale) {
      return;
    }
    const post = state.activePost;
    const fromScale = post
      ? getRenderedPostScale(post, state.effectivePostScale)
      : state.effectivePostScale;
    const nextEffectiveScale = post
      ? getAdaptivePostScale(post, nextScale)
      : nextScale;
    const shouldAnimate =
      Boolean(post) &&
      isScaleMotionEnabled() &&
      Math.abs(nextEffectiveScale - fromScale) > SCALE_FIT_EPSILON;
    state.postScale = nextScale;
    state.effectivePostScale = nextEffectiveScale;
    updateScalePreference(
      shouldAnimate &&
        state.effectivePostScale <= FOCUS_SCALES[0] + SCALE_FIT_EPSILON
    );
    if (post && shouldAnimate) {
      animatePostScale(post, fromScale, state.effectivePostScale);
    } else {
      cancelPostScaleAnimation();
    }
    trackScaleGeometry();
  };

  const selectPost = (post: HTMLElement, shouldScroll = true): void => {
    if (!post.isConnected) {
      return;
    }
    if (state.activePost !== post) {
      if (state.activePost) {
        activePostObserver.unobserve(state.activePost);
        state.activePost.removeAttribute(ACTIVE_ATTRIBUTE);
        clearPostScalePresentation(state.activePost);
      }
      state.activePost = post;
      updateScalePreference();
      post.setAttribute(ACTIVE_ATTRIBUTE, "true");
      activePostObserver.observe(post);
      trackScaleGeometry();
    }

    updatePostActionLabels();
    scheduleGeometry();
    if (shouldScroll) {
      scrollPostIntoSpotlight(post, state.animationsEnabled);
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
    clearToolbarIdleTimer();
    delete elements.host.dataset.toolbarQuiet;
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
    updateMotionPreference();
    updateScalePreference();
    elements.host.hidden = false;
    revealToolbar();
    ctx.requestAnimationFrame(() => {
      if (state.isActive && !state.isReplying) {
        elements.host.dataset.open = "true";
      }
    });
  };

  const startContextPeek = (): void => {
    if (!(state.isActive && !state.isPeeking && !state.isReplying)) {
      return;
    }
    state.isPeeking = true;
    cancelPostScaleAnimation();
    document.documentElement.setAttribute(PEEKING_ATTRIBUTE, "true");
    elements.host.dataset.peeking = "true";
    updateScalePreference();
    scheduleGeometry();
    showFeedback("Context peek", {
      dismissAfterMs: 0,
      symbol: "Space",
    });
  };

  const endContextPeek = ({
    showConfirmation = true,
  }: {
    showConfirmation?: boolean;
  } = {}): void => {
    if (!state.isPeeking) {
      return;
    }
    state.isPeeking = false;
    document.documentElement.removeAttribute(PEEKING_ATTRIBUTE);
    delete elements.host.dataset.peeking;
    updateScalePreference();
    const post = state.activePost;
    if (
      post &&
      state.effectivePostScale > FOCUS_SCALES[0] + SCALE_FIT_EPSILON &&
      isScaleMotionEnabled()
    ) {
      animatePostScale(post, FOCUS_SCALES[0], state.effectivePostScale);
      trackScaleGeometry();
    }
    scheduleGeometry();
    if (showConfirmation && state.isActive && !state.isReplying) {
      showFeedback("Focus restored");
    } else {
      hideFeedback();
    }
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
    state.isPeeking = false;
    state.isReplying = false;
    state.returnUrl = null;
    document.documentElement.removeAttribute(PEEKING_ATTRIBUTE);
    delete elements.host.dataset.peeking;
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
    endContextPeek({ showConfirmation: false });
    state.isReplying = false;
    state.returnUrl = null;
    clearReplyDetectionTimer();
    document.documentElement.removeAttribute(ANIMATIONS_ATTRIBUTE);
    document.documentElement.removeAttribute(FOCUS_ATTRIBUTE);
    document.documentElement.removeAttribute(PEEKING_ATTRIBUTE);
    if (state.activePost) {
      activePostObserver.unobserve(state.activePost);
      state.activePost.removeAttribute(ACTIVE_ATTRIBUTE);
      clearPostScalePresentation(state.activePost);
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
    trackScaleGeometry();
  };

  const suspendFocusSurfaceForReply = (): void => {
    state.hasObservedReplyComposer = false;
    state.isReplying = true;
    endContextPeek({ showConfirmation: false });
    cancelPostScaleAnimation();
    document.documentElement.removeAttribute(FOCUS_ATTRIBUTE);
    if (state.activePost) {
      state.activePost.removeAttribute(ACTIVE_ATTRIBUTE);
      restorePostBackground(state.activePost);
      const container = getPostContainer(state.activePost);
      if (container) {
        container.removeAttribute(SCALED_CONTAINER_ATTRIBUTE);
        clearFocusFill(container);
      }
    }
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
      behavior: focusScrollBehavior(state.animationsEnabled),
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
      showFeedback("Like unavailable", { symbol: "!" });
      return;
    }
    const wasLiked = button.dataset.testid === "unlike";
    button.click();
    showFeedback(wasLiked ? "Post unliked" : "Post liked");
    ctx.setTimeout(updatePostActionLabels, OPEN_DURATION_MS);
  };

  const toggleBookmark = (): void => {
    const button =
      state.activePost?.querySelector<HTMLButtonElement>(BOOKMARK_SELECTOR);
    if (!button) {
      showFeedback("Bookmark unavailable", { symbol: "!" });
      return;
    }
    const wasBookmarked = button.dataset.testid === "removeBookmark";
    button.click();
    showFeedback(wasBookmarked ? "Bookmark removed" : "Post bookmarked");
    ctx.setTimeout(updatePostActionLabels, OPEN_DURATION_MS);
  };

  const copyPostLink = async (): Promise<void> => {
    const url = state.activePost ? getCanonicalPostUrl(state.activePost) : null;
    if (!url) {
      showFeedback("Post link unavailable", { symbol: "!" });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showFeedback("Post link copied");
    } catch {
      showFeedback("Could not copy post link", { symbol: "!" });
    }
  };

  const toggleAnimations = async (): Promise<void> => {
    const previousValue = state.animationsEnabled;
    const nextValue = !previousValue;
    state.animationsEnabled = nextValue;
    updateMotionPreference();
    if (!nextValue) {
      cancelPostScaleAnimation();
      updateScalePreference();
      window.scrollTo({
        behavior: "auto",
        top: window.scrollY,
      });
    }
    showFeedback(nextValue ? "Animations on" : "Animations off");

    try {
      await focusAnimations.setValue(nextValue);
    } catch {
      state.animationsEnabled = previousValue;
      updateMotionPreference();
      showFeedback("Animation preference could not be saved", { symbol: "!" });
    }
  };

  const togglePostScale = async (): Promise<void> => {
    const previousScale = state.postScale;
    const nextScale = getNextFocusScale(previousScale);
    applyPostScale(nextScale);
    showFeedback(elements.scaleLabel.textContent);

    try {
      await focusScale.setValue(nextScale);
    } catch {
      applyPostScale(previousScale);
      showFeedback("Post scale could not be saved", { symbol: "!" });
    }
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
    if (event.key.toLowerCase() === "b") {
      toggleBookmark();
      return true;
    }
    if (event.key.toLowerCase() === "c") {
      copyPostLink().catch((error: unknown) => window.reportError(error));
      return true;
    }
    if (event.key.toLowerCase() === "r") {
      replyToPost();
      return true;
    }
    if (event.key.toLowerCase() === "a") {
      toggleAnimations().catch((error: unknown) => window.reportError(error));
      return true;
    }
    if (event.key.toLowerCase() === "s") {
      togglePostScale().catch((error: unknown) => window.reportError(error));
      return true;
    }
    return false;
  };

  const handleContextPeekKeyDown = (event: KeyboardEvent): boolean => {
    if (!isContextPeekShortcut(event)) {
      return false;
    }
    consumeKeyEvent(event);
    if (!event.repeat) {
      startContextPeek();
    }
    return true;
  };

  const handleFocusModeShortcut = (event: KeyboardEvent): boolean => {
    if (!isFocusShortcut(event)) {
      return false;
    }
    if (!state.settings.enabled) {
      return true;
    }
    consumeKeyEvent(event);
    if (state.isActive) {
      exitFocusMode();
    } else {
      enterFocusMode();
    }
    return true;
  };

  const shouldIgnoreKeyDown = (event: KeyboardEvent): boolean =>
    state.isReplying ||
    document.documentElement.hasAttribute(IMAGE_EDITOR_OPEN_ATTRIBUTE) ||
    isEditableTarget(event.target);

  const revealToolbarForKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat) {
      revealToolbar();
    }
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (shouldIgnoreKeyDown(event)) {
      return;
    }
    if (handleFocusModeShortcut(event)) {
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
    revealToolbarForKeyDown(event);
    if (handleContextPeekKeyDown(event)) {
      return;
    }
    if (state.isPeeking) {
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

  const handleKeyUp = (event: KeyboardEvent): void => {
    if (!(state.isActive && state.isPeeking && event.code === "Space")) {
      return;
    }
    consumeKeyEvent(event);
    endContextPeek();
  };

  ctx.addEventListener(window, "keydown", handleKeyDown, { capture: true });
  ctx.addEventListener(window, "keyup", handleKeyUp, { capture: true });
  ctx.addEventListener(
    window,
    "blur",
    () => endContextPeek({ showConfirmation: false }),
    { passive: true }
  );
  ctx.addEventListener(
    document,
    "visibilitychange",
    () => {
      if (document.hidden) {
        endContextPeek({ showConfirmation: false });
      }
    },
    { passive: true }
  );
  ctx.addEventListener(
    window,
    "resize",
    () => {
      refreshAdaptiveScale();
      scheduleGeometry();
    },
    { passive: true }
  );
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
      clearPostScalePresentation(state.activePost);
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
        clearPostScalePresentation(state.activePost);
        state.activePost = null;
      }
      selectNearestPost();
      return;
    }
    updatePostActionLabels();
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
  const unwatchAnimations = focusAnimations.watch((enabled) => {
    state.animationsEnabled = enabled;
    updateMotionPreference();
    if (!enabled) {
      cancelPostScaleAnimation();
      updateScalePreference();
    }
  });
  const unwatchScale = focusScale.watch((scale) => {
    if (!isFocusScale(scale)) {
      return;
    }
    applyPostScale(scale);
  });

  ctx.onInvalidated(() => {
    activePostObserver.disconnect();
    pageObserver.disconnect();
    unwatchAnimations();
    unwatchScale();
    unwatchSettings();
    if (geometryFrame) {
      window.cancelAnimationFrame(geometryFrame);
    }
    if (hideTimer) {
      window.clearTimeout(hideTimer);
    }
    clearToolbarIdleTimer();
    hideFeedback();
    clearReplyDetectionTimer();
    if (scaleTrackingFrame) {
      window.cancelAnimationFrame(scaleTrackingFrame);
    }
    if (selectionTimer) {
      window.clearTimeout(selectionTimer);
    }
    state.activePost?.removeAttribute(ACTIVE_ATTRIBUTE);
    if (state.activePost) {
      clearPostScalePresentation(state.activePost);
    }
    document.documentElement.removeAttribute(ANIMATIONS_ATTRIBUTE);
    document.documentElement.removeAttribute(FOCUS_ATTRIBUTE);
    document.documentElement.removeAttribute(PEEKING_ATTRIBUTE);
    elements.host.remove();
  });
};

const startExtension = async (ctx: ContentScriptContext): Promise<void> => {
  startImageEditor(ctx);
  await startFocusMode(ctx);
};

export default defineContentScript({
  main: startExtension,
  matches: ["*://x.com/*", "*://*.x.com/*"],
  runAt: "document_idle",
});
