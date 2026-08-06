# Better X

A focused desktop reader and keyboard-first browser extension for X.

## Features

- **Desktop split view** — authenticated timeline on the right and the selected
  full conversation on the left.
- **Warm post switching** — a bounded Electron `WebContentsView` pool preloads
  nearby posts.
- **Persistent session** — every X view shares one isolated Chromium profile.
- **Browser Focus Mode** — spotlight one native post, move with the arrow keys,
  and like, reply, or open conversations without leaving the keyboard.
- **Shared design system** — the desktop shell uses the same subtle surfaces,
  tokens, typography, and macOS chrome as 1git.

## Getting Started

```bash
bun install
```

Run the desktop app:

```bash
bun run --cwd apps/desktop dev
```

Run the extension:

```bash
bun run --cwd apps/extension dev
```

## Project Structure

```
better-x/
├── apps/
│   ├── desktop/
│   │   └── src/feature/x-workspace/ # Workspace UI, model, main, and preload
│   └── extension/
│       └── feature/
│           ├── focus-mode/          # Native timeline focus workflow
│           └── image-editor/        # React canvas editor and X bridge
└── packages/
    ├── config/    # Shared TypeScript configuration
    └── ui/
        └── src/
            ├── components/          # Reusable UI primitives
            ├── fixture/liquid-menu/ # Composed Liquid UI fixture
            └── utils/               # Named cross-primitive utilities
```

## Available Scripts

- `bun run build`: Build every workspace.
- `bun run check-types`: Type-check every workspace.
- `bun run check`: Run Ultracite.
- `bun run fix`: Apply Ultracite fixes.
