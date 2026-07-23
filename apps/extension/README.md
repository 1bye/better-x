# Better X Reader

A WXT extension that turns desktop X timelines into a mail-style split view.

## Interaction model

- X's trends and follow rail is removed.
- Navigation and the existing timeline shift left.
- The post under the cursor is mirrored into a persistent reader on the right.
- Scrolling updates the reader without clicks or navigation.
- Press `P` to pin the current post and `Escape` to resume live preview.
- Reply, repost, like, and bookmark actions in the reader are forwarded to the
  original post.

The popup can disable the split view, keep full-height feed cards, or make the
reader follow the scroll position instead of the cursor.

## Development

```sh
bun run --cwd apps/extension dev
```

For a production build:

```sh
bun run --cwd apps/extension build
```

Then open `chrome://extensions`, enable Developer mode, choose **Load
unpacked**, and select `apps/extension/.output/chrome-mv3`.
