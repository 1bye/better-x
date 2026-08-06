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
`Edit` badge on an attached image. Attached media expands from its visible
composer bounds into the editor and returns there on Cancel; reduced-motion
preferences skip the spatial transition. The local editor treats images, text,
rectangles, arrows, and blur regions as independent objects. Select an object
directly on the canvas, then move, resize, or rotate it with the visible handles.
A small contextual Liquid card exposes typography, appearance, image adjustments,
opacity, arrangement, and solid or gradient canvas backgrounds. The canvas stays
uniformly scaled inside a spacious adaptive viewport; it never crops or distorts
the scene and has no navigation mode.

Double-click an image or press `C` to enter non-destructive freeform crop mode.
Drag to reposition its contents, resize the frame to change the crop, and scroll
to zoom inside it. Press `Enter` to keep the crop or `Escape` to restore it.

- `V`, `T`, `R`, `A`, and `B` select, add text, draw a rectangle, draw an arrow,
  or add a blur region.
- Arrow keys nudge the selected object. Hold `Shift` to nudge by ten pixels or
  snap rotation and proportional resize.
- `Command + D` duplicates. `[` and `]` change layer order.
- `Command + Z` and `Shift + Command + Z` undo and redo.
- `Command + Enter` renders the scene back into X's native composer.
- `Escape` cancels the current crop, clears the selection, then closes without
  changing the attachment.

## Architecture

WXT entrypoints only compose the extension. Focus Mode lives in
`feature/focus-mode`, while the React editor, canvas model, renderer, and
X upload bridge live in `feature/image-editor`. Each feature keeps its
components, hooks, library code, and styles with the behavior that owns them.

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
