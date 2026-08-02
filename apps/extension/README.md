# Better X Reader

A WXT extension that turns desktop X timelines into a mail-style split view.

## Interaction model

- X's trends and follow rail is removed.
- Navigation and the existing timeline shift left.
- The post under the pointer loads in the right pane using X's official embed.
- Media and the actions provided by the official embedded Post stay available.
- Press `P` to pin the current Post and `Escape` to resume live selection.
- Use **View replies** to open the complete native conversation on X.

Regular `x.com/.../status/...` pages block framing. Better X therefore uses the
frameable embedded-Post renderer served by `platform.twitter.com`. It does not
remove X security headers, inject remote scripts, or use inline `srcdoc` code.

Official embeds support public Posts and parent context, but they do not include
the complete replies timeline. Protected or restricted Posts fall back to
**View replies**.

The popup can disable the split view, keep full-height feed cards, or make the
embedded Post follow the scroll position instead of the cursor.

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
