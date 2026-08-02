import type { ViewBounds } from "../shared/view-layout.js";
import type { XFeedSelection } from "../shared/x-post.js";

export interface ManagedPostWebContents {
  readonly close: () => void;
  readonly getURL: () => string;
  readonly isDestroyed: () => boolean;
  readonly loadURL: (url: string) => Promise<void>;
}

export interface ManagedPostView {
  readonly setBounds: (bounds: ViewBounds) => void;
  readonly setVisible: (isVisible: boolean) => void;
  readonly webContents: ManagedPostWebContents;
}

export interface PostViewPoolStatus {
  readonly message: string | null;
  readonly status: "error" | "idle" | "loading" | "ready";
  readonly url: string | null;
}

interface PostViewPoolOptions {
  readonly capacity: number;
  readonly createView: () => ManagedPostView;
  readonly onStatusChanged: (status: PostViewPoolStatus) => void;
}

interface PostViewEntry {
  generation: number;
  lastUsed: number;
  loadPromise: Promise<void> | null;
  ready: boolean;
  url: string | null;
  readonly view: ManagedPostView;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isAbortedNavigation = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("ERR_ABORTED");

const didReachTarget = (currentUrl: string, targetUrl: string): boolean =>
  currentUrl === targetUrl ||
  currentUrl.startsWith(`${targetUrl}/`) ||
  currentUrl.startsWith(`${targetUrl}?`) ||
  currentUrl.startsWith(`${targetUrl}#`);

export class PostViewPool {
  private activeEntry: PostViewEntry | null = null;
  private bounds: ViewBounds | null = null;
  private clock = 0;
  private readonly entries: PostViewEntry[];
  private selectionGeneration = 0;

  constructor({ capacity, createView, onStatusChanged }: PostViewPoolOptions) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Post view pool capacity must be a positive integer.");
    }
    this.onStatusChanged = onStatusChanged;
    this.entries = Array.from({ length: capacity }, () => {
      const view = createView();
      view.setVisible(false);
      return {
        generation: 0,
        lastUsed: 0,
        loadPromise: null,
        ready: false,
        url: null,
        view,
      };
    });
  }

  private readonly onStatusChanged: (status: PostViewPoolStatus) => void;

  get activeUrl(): string | null {
    return this.activeEntry?.url ?? null;
  }

  destroy(): void {
    this.selectionGeneration += 1;
    for (const entry of this.entries) {
      entry.view.setVisible(false);
      if (!entry.view.webContents.isDestroyed()) {
        entry.view.webContents.close();
      }
    }
    this.activeEntry = null;
  }

  handleNavigation(view: ManagedPostView, url: string | null): void {
    const entry = this.entries.find((candidate) => candidate.view === view);
    if (!(entry?.ready && entry === this.activeEntry)) {
      return;
    }
    entry.url = url;
    if (!url) {
      entry.ready = false;
    }
  }

  hide(): void {
    this.selectionGeneration += 1;
    for (const entry of this.entries) {
      entry.view.setVisible(false);
    }
    this.onStatusChanged({
      message: null,
      status: "idle",
      url: this.activeEntry?.url ?? null,
    });
  }

  async select(selection: XFeedSelection): Promise<void> {
    this.selectionGeneration += 1;
    const { selectionGeneration } = this;
    const urls = [selection.currentUrl, ...selection.nextUrls];
    const reservedEntries = new Set<PostViewEntry>();
    const selectedEntries = urls.map((url) => {
      const entry = this.reserveEntry(url, reservedEntries);
      reservedEntries.add(entry);
      return entry;
    });
    const [activeEntry] = selectedEntries;
    if (!activeEntry) {
      return;
    }
    this.activeEntry = activeEntry;
    this.touch(activeEntry);

    const activeWasReady =
      activeEntry.ready && activeEntry.url === selection.currentUrl;
    if (activeWasReady) {
      this.show(activeEntry);
      this.onStatusChanged({
        message: null,
        status: "ready",
        url: selection.currentUrl,
      });
    } else {
      for (const entry of this.entries) {
        entry.view.setVisible(false);
      }
      this.onStatusChanged({
        message: null,
        status: "loading",
        url: selection.currentUrl,
      });
    }

    const activeResultPromise = this.loadEntry(
      activeEntry,
      selection.currentUrl
    ).then(
      () => ({ error: null, succeeded: true }) as const,
      (error: unknown) => ({ error, succeeded: false }) as const
    );
    const preloadTasks = selectedEntries.slice(1).map((entry, index) => {
      const url = selection.nextUrls[index];
      if (!url) {
        return Promise.resolve();
      }
      return this.loadEntry(entry, url).catch(() => undefined);
    });

    const activeResult = await activeResultPromise;
    if (activeResult.succeeded) {
      if (
        selectionGeneration === this.selectionGeneration &&
        activeEntry === this.activeEntry &&
        activeEntry.url === selection.currentUrl
      ) {
        this.show(activeEntry);
        this.onStatusChanged({
          message: null,
          status: "ready",
          url: selection.currentUrl,
        });
      }
    } else if (selectionGeneration === this.selectionGeneration) {
      this.onStatusChanged({
        message: `Could not open this post: ${errorMessage(activeResult.error)}`,
        status: "error",
        url: selection.currentUrl,
      });
    }

    await Promise.all(preloadTasks);
  }

  setBounds(bounds: ViewBounds): void {
    this.bounds = bounds;
    for (const entry of this.entries) {
      entry.view.setBounds(bounds);
    }
  }

  private async loadEntry(entry: PostViewEntry, url: string): Promise<void> {
    if (entry.url === url && entry.ready) {
      return;
    }
    if (entry.url === url && entry.loadPromise) {
      await entry.loadPromise;
      return;
    }

    entry.generation += 1;
    const { generation } = entry;
    entry.url = url;
    entry.ready = false;
    const loadPromise = entry.view.webContents.loadURL(url);
    entry.loadPromise = loadPromise;

    try {
      await loadPromise;
      if (entry.generation !== generation || entry.url !== url) {
        return;
      }
      entry.ready = true;
      entry.url = url;
    } catch (error: unknown) {
      if (entry.generation !== generation || entry.url !== url) {
        return;
      }
      if (
        isAbortedNavigation(error) &&
        didReachTarget(entry.view.webContents.getURL(), url)
      ) {
        entry.ready = true;
        return;
      }
      entry.ready = false;
      throw new Error(`Navigation to ${url} failed.`, { cause: error });
    } finally {
      if (entry.generation === generation) {
        entry.loadPromise = null;
      }
    }
  }

  private reserveEntry(
    url: string,
    excluded: ReadonlySet<PostViewEntry>
  ): PostViewEntry {
    const matching = this.entries.find(
      (entry) => !excluded.has(entry) && entry.url === url
    );
    if (matching) {
      this.touch(matching);
      return matching;
    }

    const [available] = this.entries
      .filter((entry) => !excluded.has(entry))
      .sort((left, right) => {
        if (left.url === null && right.url !== null) {
          return -1;
        }
        if (left.url !== null && right.url === null) {
          return 1;
        }
        return left.lastUsed - right.lastUsed;
      });
    if (!available) {
      throw new Error("The post view pool has no reusable entry.");
    }
    available.generation += 1;
    available.loadPromise = null;
    available.ready = false;
    available.url = url;
    this.touch(available);
    return available;
  }

  private show(entry: PostViewEntry): void {
    for (const candidate of this.entries) {
      candidate.view.setVisible(candidate === entry);
    }
    if (this.bounds) {
      entry.view.setBounds(this.bounds);
    }
    this.touch(entry);
  }

  private touch(entry: PostViewEntry): void {
    this.clock += 1;
    entry.lastUsed = this.clock;
  }
}
