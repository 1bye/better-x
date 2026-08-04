import { describe, expect, it } from "bun:test";
import {
  type ManagedPostView,
  type ManagedPostWebContents,
  PostViewPool,
  type PostViewPoolStatus,
} from "../src/main/post-view-pool.js";
import type { ViewBounds } from "../src/shared/view-layout.js";

class FakePostWebContents implements ManagedPostWebContents {
  readonly abortedUrls = new Set<string>();
  closed = false;
  readonly loads: string[] = [];
  url = "";

  close(): void {
    this.closed = true;
  }

  getURL(): string {
    return this.url;
  }

  isDestroyed(): boolean {
    return this.closed;
  }

  loadURL(url: string): Promise<void> {
    this.loads.push(url);
    this.url = url;
    if (this.abortedUrls.delete(url)) {
      return Promise.reject(new Error(`ERR_ABORTED (-3) loading '${url}'`));
    }
    return Promise.resolve();
  }
}

class FakePostView implements ManagedPostView {
  bounds: ViewBounds | null = null;
  visible = false;
  readonly webContents = new FakePostWebContents();

  setBounds(bounds: ViewBounds): void {
    this.bounds = bounds;
  }

  setVisible(isVisible: boolean): void {
    this.visible = isVisible;
  }
}

const POST_A = "https://x.com/a/status/1";
const POST_B = "https://x.com/b/status/2";
const POST_C = "https://x.com/c/status/3";
const POST_D = "https://x.com/d/status/4";

const createHarness = () => {
  const statuses: PostViewPoolStatus[] = [];
  const views: FakePostView[] = [];
  const pool = new PostViewPool({
    capacity: 3,
    createView: () => {
      const view = new FakePostView();
      views.push(view);
      return view;
    },
    onStatusChanged: (status) => {
      statuses.push(status);
    },
  });
  return { pool, statuses, views };
};

describe("PostViewPool", () => {
  it("loads the active post and warms its next candidates", async () => {
    const { pool, statuses, views } = createHarness();

    await pool.select({
      currentUrl: POST_A,
      nextUrls: [POST_B, POST_C],
    });

    expect(
      views
        .map((view) => view.webContents.url)
        .sort((left, right) => left.localeCompare(right))
    ).toEqual([POST_A, POST_B, POST_C]);
    expect(views.filter((view) => view.visible)).toHaveLength(1);
    expect(views.find((view) => view.visible)?.webContents.url).toBe(POST_A);
    expect(statuses.at(-1)).toEqual({
      message: null,
      status: "ready",
      url: POST_A,
    });
  });

  it("reveals a warm post without navigating it again", async () => {
    const { pool, views } = createHarness();
    await pool.select({
      currentUrl: POST_A,
      nextUrls: [POST_B, POST_C],
    });
    const warmView = views.find((view) => view.webContents.url === POST_B);
    expect(warmView).toBeDefined();
    const loadCount = warmView?.webContents.loads.length;

    await pool.select({
      currentUrl: POST_B,
      nextUrls: [POST_C, POST_D],
    });

    expect(warmView?.visible).toBe(true);
    expect(warmView?.webContents.loads.length).toBe(loadCount);
    expect(pool.activeUrl).toBe(POST_B);
  });

  it("accepts X replacing a navigation after reaching the target URL", async () => {
    const { pool, statuses, views } = createHarness();
    const [activeView] = views;
    if (!activeView) {
      throw new Error("The post pool did not create its active view.");
    }
    activeView.webContents.abortedUrls.add(POST_A);

    await pool.select({
      currentUrl: POST_A,
      nextUrls: [],
    });

    expect(activeView.visible).toBe(true);
    expect(statuses.at(-1)).toEqual({
      message: null,
      status: "ready",
      url: POST_A,
    });
  });

  it("applies bounds to every pooled native view and closes them", () => {
    const { pool, views } = createHarness();
    const bounds = { height: 700, width: 500, x: 7, y: 47 };

    pool.setBounds(bounds);
    pool.destroy();

    expect(views.every((view) => view.bounds === bounds)).toBe(true);
    expect(views.every((view) => view.webContents.closed)).toBe(true);
    expect(views.every((view) => !view.visible)).toBe(true);
  });

  it("suspends and restores the active view without reloading it", async () => {
    const { pool, views } = createHarness();
    const bounds = { height: 700, width: 500, x: 7, y: 47 };
    pool.setBounds(bounds);
    await pool.select({
      currentUrl: POST_A,
      nextUrls: [POST_B, POST_C],
    });
    const activeView = views.find((view) => view.webContents.url === POST_A);
    const loadCount = activeView?.webContents.loads.length;

    pool.setSurfaceVisible(false);
    expect(views.every((view) => !view.visible)).toBe(true);

    pool.setBounds(bounds);
    pool.setSurfaceVisible(true);
    expect(activeView?.visible).toBe(true);
    expect(activeView?.webContents.loads.length).toBe(loadCount);
  });
});
