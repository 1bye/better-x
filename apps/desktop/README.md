# Better X Desktop

An Electron desktop shell that keeps an authenticated X timeline beside a
full post conversation.

## Interaction

- X loads as a normal top-level browser page in the right pane.
- Pause over a timeline post to load its complete conversation in the left pane.
- The next two visible posts preload in a bounded three-view pool.
- Home and reload controls remain in the native-style titlebar.
- All replies, likes, bookmarks, media, and navigation remain user-driven X
  interactions.

## Session

All X browser views share Electron's `persist:better-x` session partition.
Chromium stores the session in the app's user-data directory and restores it
after a restart. Better X does not read credentials, export cookies, spoof a
browser fingerprint, or automate account actions.

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
