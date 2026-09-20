# Diagram sources

Every diagram in `architecture/diagrams/` is generated, so it can be kept honest as the code
changes instead of drifting into decoration.

```sh
node architecture/diagrams/src/render.mjs        # regenerate all SVG + PNG
node architecture/diagrams/src/render.mjs 04     # just the reconciliation diagram
```

- `svg-kit.mjs` — the shared vocabulary: `box()`, `panel()`, `arrow()`, `label()`, `title()`,
  the palette (which is the app's own avatar palette) and the SVG frame.
- `d1.mjs` … `d7.mjs` — one script per diagram; each writes its SVG to stdout.
- `render.mjs` — runs them and rasterises each at 2× with sharp.

Conventions: blue = the mail page, orange = the service worker, green = the offscreen parser,
purple = the side panel, gold = storage, media and limits, red = a path that refuses.

Both the `.svg` (source of truth) and the `.png` (for slides and tickets) are committed.
