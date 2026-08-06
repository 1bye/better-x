# Better X Desktop

An Electron desktop shell that keeps an authenticated X timeline beside a
full post conversation.

## Interaction

- X loads as a normal top-level browser page in the left tile.
- Pause over a timeline post to load its complete conversation in the right tile.
- The next two visible posts preload in a bounded three-view pool.
- Drag tile tabs to split, reorder, or group the timeline and post as tabs.
- Tile geometry persists across restarts; the titlebar layout control restores
  the default side-by-side arrangement.
- Home and reload controls remain in the native-style titlebar.
- All replies, likes, bookmarks, media, and navigation remain user-driven X
  interactions.

## Session

All X browser views share Electron's `persist:better-x` session partition.
Chromium stores the session in the app's user-data directory and restores it
after a restart. Better X does not read credentials, export cookies, spoof a
browser fingerprint, or automate account actions.

## Architecture

The workspace is owned by `src/feature/x-workspace`. Its `components`, `hooks`,
and `lib` folders contain renderer UI, renderer lifecycle, and shared models;
the `main` and `preload` folders contain the Electron-specific edges. Files in
`src/main`, `src/preload`, and `src/renderer` are composition entrypoints only.

## Development

```sh
bun run --cwd apps/desktop dev
```

Run the desktop checks:

```sh
bun run --cwd apps/desktop check-types
bun run --cwd apps/desktop test
bun run --cwd apps/desktop build
```
