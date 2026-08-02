import { ipcRenderer } from "electron";
import { normalizeXPostUrl, type XFeedSelection } from "../shared/x-post.js";

const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
// Sandboxed Electron preloads must remain single-file bundles. Keeping this
// channel local prevents Rollup from creating a shared preload chunk.
const FEED_SELECTION_CHANNEL = "better-x:feed-selection";
const SELECTION_DWELL_MS = 180;
const STATUS_LINK_SELECTOR = "a[href] time";

let lastPointer: { readonly x: number; readonly y: number } | null = null;
let lastSelectionSignature = "";
let pendingSelectionSignature = "";
let selectionTimer = 0;
let scrollFrame = 0;

const articleFromTarget = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest<HTMLElement>(ARTICLE_SELECTOR);
};

const postUrlFromArticle = (article: HTMLElement): string | null => {
  const timestamp = article.querySelector(STATUS_LINK_SELECTOR);
  const timestampLink = timestamp?.closest<HTMLAnchorElement>("a[href]");
  if (timestampLink) {
    const normalized = normalizeXPostUrl(timestampLink.href);
    if (normalized) {
      return normalized;
    }
  }

  for (const link of article.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const normalized = normalizeXPostUrl(link.href);
    if (normalized) {
      return normalized;
    }
  }
  return null;
};

const selectionFromArticle = (
  activeArticle: HTMLElement
): XFeedSelection | null => {
  const currentUrl = postUrlFromArticle(activeArticle);
  if (!currentUrl) {
    return null;
  }

  const articles = Array.from(
    document.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR)
  );
  const activeIndex = articles.indexOf(activeArticle);
  const nextUrls: string[] = [];
  if (activeIndex >= 0) {
    for (const article of articles.slice(activeIndex + 1)) {
      const candidate = postUrlFromArticle(article);
      if (
        candidate &&
        candidate !== currentUrl &&
        !nextUrls.includes(candidate)
      ) {
        nextUrls.push(candidate);
      }
      if (nextUrls.length === 2) {
        break;
      }
    }
  }

  return { currentUrl, nextUrls };
};

const scheduleSelection = (article: HTMLElement | null): void => {
  if (!article) {
    return;
  }
  const selection = selectionFromArticle(article);
  if (!selection) {
    return;
  }
  const signature = JSON.stringify([
    selection.currentUrl,
    ...selection.nextUrls,
  ]);
  if (
    signature === lastSelectionSignature ||
    signature === pendingSelectionSignature
  ) {
    return;
  }

  if (selectionTimer) {
    window.clearTimeout(selectionTimer);
  }
  pendingSelectionSignature = signature;
  selectionTimer = window.setTimeout(() => {
    selectionTimer = 0;
    lastSelectionSignature = signature;
    pendingSelectionSignature = "";
    ipcRenderer.send(FEED_SELECTION_CHANNEL, selection);
  }, SELECTION_DWELL_MS);
};

document.addEventListener(
  "pointermove",
  (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    scheduleSelection(articleFromTarget(event.target));
  },
  { passive: true }
);

document.addEventListener("focusin", (event) => {
  scheduleSelection(articleFromTarget(event.target));
});

document.addEventListener(
  "scroll",
  () => {
    if (scrollFrame || !lastPointer) {
      return;
    }
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!lastPointer) {
        return;
      }
      const target = document.elementFromPoint(lastPointer.x, lastPointer.y);
      scheduleSelection(articleFromTarget(target));
    });
  },
  { capture: true, passive: true }
);
