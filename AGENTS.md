# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

A Tampermonkey userscript that translates text inside images in place, talking
directly to Google Lens's private `crupload` endpoint and rendering the result
the way Chromium's own Lens overlay does.

It is **self-contained**: no server, no extension, no account. `GM_xmlhttpRequest`
runs in the extension's context and is not subject to CORS, which is what makes
that possible.

The Python sibling project, [chrome-lens-py](https://github.com/bropines/chrome-lens-py),
implements the same protocol and the same renderer. Protocol changes usually
need to land in both.

## Commands

```bash
bun install
bun run gen        # proto/ -> .protogen -> src/gen/fields.ts  (after updating protos)
bun run typecheck  # tsc --noEmit, strict
bun run build      # typecheck, then dist/lens-translate.user.js
bun run dev        # live-reload userscript for development
```

`bun run build` is the gate: it will not emit if the types do not check.

## Layout

```
proto/                  Chromium's Lens .proto files, copied verbatim
scripts/gen-fields.ts   descriptors -> typed field-number table (build time only)
src/
  protobuf.ts           minimal wire codec: varint, length-delimited, fixed32
  types.ts              shared domain types; every cross-module shape lives here
  settings.ts           GM-backed store, defaults, and the settings field list
  languages.ts          language codes; labels come from Intl.DisplayNames
  cache.ts              LRU over Lens responses, evicted by bytes
  image.ts              fetch, downscale, JPEG encode
  gen/fields.ts         GENERATED - do not edit
  lens/                 request builder, response parser, transport
  render/
    layout.ts           the pure layout maths, shared by both renderers
    canvas.ts           paints the translation into a bitmap
    cover.ts            lays that bitmap over the image as a sibling
    overlay.ts          the alternative DOM-lines renderer
  ui/                   shadow root, settings panel, styles
```

## Things that are the way they are for a reason

Each of these cost a debugging session. Please do not "simplify" them without
reading the reasoning first.

### Rendering must not fight the page

Three approaches were tried. Two failed:

1. **A layer parented to `<body>`**, positioned from `getBoundingClientRect`.
   Drifts on a virtualised feed, which recycles and moves its `<img>` elements
   constantly. It smeared across unrelated parts of the page.
2. **Overwriting the image's `src`.** Starts a tug-of-war with whoever owns the
   element; React re-asserts `src` on its next render and the translation
   vanishes. A `MutationObserver` putting it back lost after 30 rounds.
3. **A sibling element absolutely positioned over the image** (`render/cover.ts`).
   Shares the image's containing block, so `offsetLeft`/`offsetTop` need no
   scroll correction; the framework never touches it because it did not create
   it. This is the one that works.

### All UI lives in a shadow root

Page CSS beats `GM_addStyle` on equal specificity when it comes later, and
`!important` beats it outright. A shadow root is not a specificity contest.

But a shadow root blocks **selectors, not inheritance**. Font, colour,
direction and line-height still reach in through the host, so the host carries
`all: initial !important` — and then has to restate the font, because `initial`
for `font-family` is the browser's serif default and an inline `!important`
declaration outranks any `:host` rule.

### Reading image pixels: three ways in, cheapest first

1. The element as it stands — no network, no permission needed.
2. The same URL re-requested with `crossOrigin` — a plain `<img>` is not
   *requested* with CORS, so drawing it taints the canvas even when the host
   would have allowed it. Most hosts, `pbs.twimg.com` included, send
   `Access-Control-Allow-Origin: *`.
3. `GM_xmlhttpRequest` — only for hosts with no CORS headers. This is what
   `@connect *` is for, and it is rarely reached.

### Protobuf is hand-rolled, but field numbers are not

`@bufbuild/protobuf` with generated code measured 160.6 kB / 33.8 kB gzip for
the protobuf layer **alone**; the hand-rolled codec is a fraction of that for
the whole script. Its descriptors cannot be tree-shaken, and this script parses
on every page load.

Field numbers still come from the real `.proto` files: `bun run gen` compiles
`proto/` with buf and distils them into `src/gen/fields.ts`. **Never hand-write
a field number** — add the message to the `WANTED` set in
`scripts/gen-fields.ts` and regenerate.

### Rendering rules that are easy to get wrong

From `chrome/browser/resources/lens/overlay/text_layer.ts`:

- **No word wrap.** One translated line is one rendered line, scaled down by
  font size until it fits. Wrapping never matches Chromium.
- **The box comes from the original detected line.** The server sends no
  geometry for translated text at all, so the two must line up index for index
  — and a paragraph where they do not is dropped, as Chromium drops it.
- **Font size is a binary search over 3..150px**, testing measured width against
  the box width and `fontBoundingBoxAscent + fontBoundingBoxDescent` against the
  box height — the font's bounding box, not the ink extents of these glyphs.
- **The background patch is larger than the line box.** Chromium writes this as
  `hPad * box.h / aspect * W` and `vPad * box.h * H`, and since `W / aspect ===
  H`, both reduce to a fraction of the line's height **in pixels**. What that
  really means is *a fraction of the line's thickness* — which only equals the
  height for a horizontal line. On a vertical column the thickness is the
  width, and using the height there inflates the patch over sevenfold and
  paints black bars across the page. Use `min(boxW, boxH)`.
- **Word offsets are UTF-16 code units** (`icu::UnicodeString` on the server).
  JavaScript indexes strings the same way, so `slice` is already correct here —
  but the Python port has to encode to UTF-16 explicitly.

### The cache has two levels, and their order matters

`cache.ts` holds Lens responses *and* finished renderings, sharing one byte
budget. Two mistakes were made here and both are worth not repeating:

- The response cache was keyed on the raw image URL. Twitter serves one photo
  as `?name=small` / `medium` / `large` / `orig` and React rewrites `src`
  between them, so every layout change was a miss. Keys go through
  `normalizeUrl`, which drops rendition parameters.
- The cache check sat *after* `prepareImage`, so a hit still fetched pixels and
  JPEG-encoded an upload nobody would send. The render cache is now checked
  first and short-circuits everything; the response cache sits ahead of the
  encode.

Verified by counting `drawImage` calls and POSTs: three translations of the same
photo under three rendition URLs cost one POST and zero pixel reads after the
first.

### Deliberate departures from Chromium

- **Minimum readable size.** Lens fits text to the original line box, so fine
  print on a large image comes back at 2–3 px on screen. `minReadablePx` raises
  it past the box; lines can then overlap, which is why it is a setting.
- **Vertical CJK reflow.** Chromium keeps the column. A Russian translation set
  vertically is unreadable, so `verticalText: auto` keeps it only for CJK
  targets. Reflow is not just a flag: a vertical line box is a tall narrow
  column that horizontal text cannot occupy, so the *paragraph* box becomes one
  text area and the text is re-wrapped into it (`drawReflowedParagraph`). The
  per-line patches are still painted, to erase the source.

## Conventions

- Strict TypeScript. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
  are on; respect them rather than reaching for `any` or `!`.
- Comments explain **why**, not what. Most comments here record a constraint
  discovered the hard way; keep that habit.
- No emoji in code or commit messages. No decorative banner comments.
- `dist/` is committed so the script can be installed straight from the repo.
  Rebuild it in the same commit as any `src/` change.

## Verifying changes

There is no test runner. Changes to rendering or the protocol are verified in a
real browser against a recorded Lens response: build a page that inlines
`dist/lens-translate.user.js`, shim the `GM_*` functions, and drive the script
through a real hover and click. Past sessions have used this to confirm
alignment to the pixel, zero framework reverts, and cache hits.

Two traps that produced false passes:

- A `data:` image is same-origin, so it never exercises the tainted-canvas path.
  Use a cross-origin URL to test that branch.
- Measure after the page has actually laid out. A hidden preview pane returns
  zeroes from `getBoundingClientRect` for everything, which looks exactly like a
  positioning bug.

If you change the request builder, the strongest check is to serialize a request
in JS and parse it with Python's `protobuf` library in the sibling project — it
catches a wrong field number immediately.
