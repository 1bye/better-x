# Better X Focus Mode

A WXT extension that turns the native X timeline into a quiet, keyboard-first
reading experience.

## Interaction model

Press `Shift + F` on X to enter or leave Focus Mode. The post nearest the center
of the viewport stays fully visible while the surrounding page is dimmed.

- `Arrow Up` and `Arrow Down` select the previous or next post.
- `L` uses X's native Like or Unlike action.
- `R` opens X's native reply composer.
- `Enter` or `Arrow Right` opens the selected conversation.
- `Arrow Left` returns after opening a conversation from Focus Mode.
- `Escape` exits Focus Mode.

Focus Mode operates on X's existing post elements and controls. It does not clone
posts, load embeds, or create a second conversation view, so authenticated actions,
media, and replies remain native to X.

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
