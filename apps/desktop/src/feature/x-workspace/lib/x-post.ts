const X_HOSTS = new Set([
  "mobile.twitter.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "www.x.com",
  "x.com",
]);
const X_POST_PATH_PATTERN = /^\/([a-zA-Z0-9_]{1,30})\/status\/(\d+)(?:\/|$)/;
const PRELOAD_POST_LIMIT = 2;

export interface XFeedSelection {
  readonly currentUrl: string;
  readonly nextUrls: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isAllowedXNavigation = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && X_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

export const normalizeXPostUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    const match = url.pathname.match(X_POST_PATH_PATTERN);
    if (url.protocol !== "https:" || !X_HOSTS.has(url.hostname) || !match) {
      return null;
    }
    const [, username, postId] = match;
    if (!(username && postId)) {
      return null;
    }
    return `https://x.com/${username}/status/${postId}`;
  } catch {
    return null;
  }
};

export const parseXFeedSelection = (value: unknown): XFeedSelection | null => {
  if (!isRecord(value)) {
    return null;
  }
  const currentUrl = normalizeXPostUrl(value.currentUrl);
  if (!(currentUrl && Array.isArray(value.nextUrls))) {
    return null;
  }

  const nextUrls: string[] = [];
  for (const candidate of value.nextUrls) {
    const normalized = normalizeXPostUrl(candidate);
    if (
      normalized &&
      normalized !== currentUrl &&
      !nextUrls.includes(normalized)
    ) {
      nextUrls.push(normalized);
    }
    if (nextUrls.length === PRELOAD_POST_LIMIT) {
      break;
    }
  }

  return { currentUrl, nextUrls };
};
