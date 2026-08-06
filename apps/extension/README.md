# Better X Focus Mode

A WXT extension that turns the native X timeline into a quiet, keyboard-first
reading experience.

## Interaction model

Press `Shift + F` on X to enter or leave Focus Mode. The post nearest the center
of the viewport stays fully visible while the surrounding page is dimmed.

- `Arrow Up` and `Arrow Down` select the previous or next post.
- `L` uses X's native Like or Unlike action.
- Hold `Space` to temporarily reveal the surrounding timeline.
- `B` uses X's native Bookmark or Remove Bookmark action.
- `C` copies the selected post's canonical link.
- `R` opens X's native reply composer.
- `Enter` or `Arrow Right` opens the selected conversation.
- `Arrow Left` returns after opening a conversation from Focus Mode.
- `A` switches between animated and instant navigation.
- `S` cycles the selected post through `1×`, `1.25×`, and `1.5×`.
- `Escape` exits Focus Mode.

Focus Mode operates on X's existing post elements and controls. It does not clone
posts, load embeds, or create a second conversation view, so authenticated actions,
media, and replies remain native to X. The spotlight is suspended while the native
reply composer is open and returns when the composer closes. The shortcut toolbar
fades after a brief idle period and returns on the next key press. Selected scales
act as maximums, automatically fitting unusually large posts to the viewport.

## Image editor

Use the sparkle button beside X's media control to choose an image, or use the
`Edit` badge on an attached image. The local editor supports centered X crop
presets, arrows, rectangles, text, blur/redaction, a presentation background, and
undo/redo. `A`, `R`, `T`, and `B` select tools, `G` toggles the background,
`Command + Z` undoes, `Enter` applies the rendered image to X's native composer,
and `Escape` cancels without changing the attachment.

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
