# Lens Translate

Hover any image, click the button, and the text inside it is translated **in place** — rendered the way Chromium's own Google Lens overlay does it: the original text is erased with the server's inpainted background patch, and the translation is drawn over it in the original colours, at the original angle, sized to fit the original line.

No server, no extension, no account. TypeScript, built with Vite.

## Install

[**Install the userscript**](https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.user.js) — Tampermonkey picks it up straight from the repo. Or build it yourself:

```bash
bun install
bun run build
```

Alt+click an image, or use the button that appears when you hover one. Click again to undo. Settings live in the Tampermonkey menu under **Lens Translate: settings**.

## How it talks to Lens

Directly. `GM_xmlhttpRequest` runs in the extension's context and is not subject to CORS, so the script posts protobuf straight to `lensfrontend-pa.googleapis.com/v1/crupload` — the same endpoint Chrome's Lens overlay uses.

The only awkward part is protobuf, and that is handled by about 130 lines in [`src/protobuf.ts`](src/protobuf.ts). A real protobuf runtime was measured against it:

| | raw | gzip |
|---|---|---|
| `@bufbuild/protobuf` + generated code, protobuf layer alone | 160.6 kB | 33.8 kB |
| hand-rolled codec, **entire script** | 40.3 kB | 11.4 kB |

The descriptors a generated runtime needs cannot be tree-shaken, and this script parses on every page load, so the hand-rolled codec wins clearly here.

What it does *not* do is hard-code field numbers. Chromium's `.proto` files live in [`proto/`](proto/), and `bun run gen` compiles them and distils them into a typed table of field numbers at [`src/gen/fields.ts`](src/gen/fields.ts). The bundle gets the numbers without the runtime, and re-syncing after Chromium changes its protos is one command.

```bash
bun run gen     # buf generate -> .protogen -> src/gen/fields.ts
```

## Rendering

Doing this in the browser is genuinely easier than in an image library, because Chromium's reference implementation *is* CSS — `text-shadow`, `writing-mode`, `transform: rotate`, `measureText`. Bidi, text shaping and font fallback all come free, which the Python port has to solve by hand.

Four details are easy to get wrong and are the reason this matches Chromium:

1. **No word wrap.** One translated line is one rendered line, scaled down by font size until it fits. Wrapping never matches.
2. **The box comes from the original detected line.** The server sends no geometry for translated text at all.
3. **Font size is a binary search over 3..150px**, testing `measureText().width` against the box width and `fontBoundingBoxAscent + fontBoundingBoxDescent` against the box height — the font's bounding box, not the ink extents of these particular glyphs.
4. **The background patch is larger than the line box.** Its paddings are fractions of the line *height*; the horizontal one is divided by the image aspect ratio to become a fraction of width.

Word offsets index the translation by **UTF-16 code unit**, which is what `icu::UnicodeString` uses on the server — and conveniently exactly how JavaScript indexes strings, so `String.prototype.slice` is already correct here.

Vertical CJK gets a fifth rule of its own: setting a Russian translation vertically is faithful to the source and miserable to read, so the `verticalText` setting defaults to `auto` and keeps the column only when the target language is itself CJK.

## Which images, and how they are read

Detection is `<img>` elements only, found by walking `event.composedPath()` so images inside a site's own shadow DOM are caught too. An image qualifies when its **rendered** size — not its natural size — is at least `minImageSize` on both axes, so a 4000px asset scaled down to a 20px icon is correctly ignored.

Not covered: CSS `background-image`, `<canvas>`, `<svg>`, and video frames. Images inside a cross-origin `<iframe>` work only if the script runs in that frame too, which `@match *://*/*` arranges.

Reading the pixels has three ways in, cheapest first:

1. **The element as it stands.** The browser has already downloaded and decoded it, so this costs no network request at all. Works for same-origin images.
2. **The same URL re-requested with `crossOrigin`.** A plain `<img>` is not *requested* with CORS, so drawing it taints the canvas even when the host would have allowed it — and most image hosts, `pbs.twimg.com` included, send `Access-Control-Allow-Origin: *`. Asking again with CORS usually comes straight out of the HTTP cache.
3. **`GM_xmlhttpRequest`.** Only for hosts that send no CORS headers at all. This is the one that needs `@connect *`, and it is rarely reached.

If step 3 does get reached and fails with "permanently blocked by the user", clear the domain under Tampermonkey → Settings → Security → Blocked domains.

Uploads use Chromium's own budget: JPEG quality 40, and a resize only when the image is both over 1.5 MP and over 1600px on a side.

## Manga mode

A preset for pages of vertical Japanese, off by default:

- **Always reflows** vertical text, whatever the target language.
- **Lays out wider than the detected box.** That box hugs the glyphs, but a
  speech bubble is round and has room around them, so reflowed text otherwise
  wraps into a thin column. `mangaBoxGrowth` controls how far past it to go.
- **Wipes the bubble.** The server's inpainting erases the source imperfectly,
  leaving the anti-aliased edges of the original glyphs behind; on a page of
  vertical text that residue reads as noise. Bubble interiors are one flat
  colour, so the detected area is covered with that colour — as an ellipse,
  since a rectangle would cut across the bubble's outline.
- **Raises the size floor** to at least 14 px and gives reflowed text the
  four-offset outline that per-line text already had.

## Text that would be too small to read

Lens sizes translated text to fit the *original* line box. On a 2400px page shown 600px wide, fine print measured here fitted at 9–13px, which is 2–3px on screen — no more readable than the original was, and that is the complaint.

Two settings address it. **Minimum text size** (default 12 CSS px as displayed) raises anything below the floor, growing its background to match; lines in a dense paragraph can then overlap, which is the trade and why it is adjustable — 0 turns it off. **Render sharpness** draws the canvas at 1x/2x/3x the image's natural size, so zooming in or opening the image full size keeps the text crisp rather than smearing.

## Two ways to draw

| | `canvas` (default) | `overlay` |
|---|---|---|
| how | the translation is painted into a picture laid over the image as a sibling element | absolutely positioned DOM lines float above the image |
| text | raster, scales with the image | stays crisp at any zoom, selectable |
| dynamic pages | tracks the image with no bookkeeping | drifts on virtualised feeds that recycle and move `<img>` elements |

Getting this right took three attempts, and the two that failed are worth recording:

1. **A layer parented to `<body>`**, positioned from `getBoundingClientRect`. It drifts on a virtualised feed, which moves and recycles its `<img>` elements constantly — the translation ends up smeared across unrelated parts of the page.
2. **Overwriting the image's own `src`.** Nothing to keep in sync, but it starts a tug-of-war with whoever owns the element: React re-asserts `src` on its next render and the translation vanishes within a second. A `MutationObserver` that puts it back measured 30 rounds against a harness that re-asserts on every change, then conceded.
3. **A sibling element, absolutely positioned over the image.** It shares the image's containing block, so `offsetLeft`/`offsetTop` need no correction for scrolling and it tracks the image through reflow for free; and the framework never touches it, because it did not create it. Measured zero framework reverts and pixel-exact alignment.

Both modes are reversible: click the button again, or use **undo all on this page** from the menu.

## Caching

Two levels, sharing one byte budget (32 MB by default, adjustable, 0 disables,
clearable from the menu):

- **Lens responses**, keyed by the image plus the three language settings. Only
  the response — re-rendering from it is local, so changing a render setting
  takes effect without invalidating anything.
- **Finished renderings**, keyed additionally by everything that changes how it
  looks. A repeat toggle hits this one and costs *nothing*: no pixels fetched,
  no canvas painted, no round trip.

Two details that took measuring to get right:

- The key normalizes the URL. Twitter serves one photo as `?name=small` /
  `medium` / `large` / `orig` and React rewrites `src` between them, so keying
  on the raw URL made every layout change a miss.
- The cache check sits *ahead* of the JPEG encode. Encoding an upload that is
  never sent was the expensive half of a cache hit.

Eviction is by total bytes rather than entry count, because the weight is
almost entirely the inpainted WebP patches and the rendered PNGs, and those vary
hugely between a two-word sign and a page of manga.

## Turning it off

Three menu commands: **settings**, **undo all on this page**, and **toggle on/off**. There is also an `enabled` checkbox in settings; with it off, the hover button does nothing and says so.

Hovering an image shows the translate button, and holding the cursor there for another half second brings up a settings button next to it.

## Surviving other people's CSS

All UI — button, toast, settings panel and the translation overlay itself — lives in a **shadow root**, not in the page. Injecting with `GM_addStyle` loses on sites that ship rules like `div { display: inline !important }`: page CSS wins on equal specificity when it comes later, and `!important` beats an injected sheet outright. A shadow root is not a specificity contest; page rules cannot reach inside it.

The shadow host is a fixed, full-viewport, click-through layer, which also means everything inside is positioned in viewport coordinates and follows scrolling by re-reading `getBoundingClientRect`, with no page-offset arithmetic.

One subtlety: a shadow root blocks *selectors*, not *inheritance*. Font, colour, direction and line-height still reach in through the host, so the host carries `all: initial !important` — and then has to restate the font, because `initial` for `font-family` is the browser's serif default and an inline `!important` declaration outranks any `:host` rule.

Sites with a strict Content-Security-Policy may still block `blob:` URLs in `background-image`. There is no workaround from inside a userscript.

## Layout

```
proto/               Chromium's Lens .proto files
scripts/gen-fields.ts   descriptors -> typed field-number table
src/
  protobuf.ts        minimal wire codec
  types.ts           shared domain types
  settings.ts        GM-backed settings store
  image.ts           fetch, downscale, JPEG encode
  gen/fields.ts      generated; do not edit
  lens/              request builder, response parser, transport
  render/            layout maths, canvas painter, DOM overlay, image swap
  ui/                settings panel, styles
```

```bash
bun run dev        # live-reload userscript for development
bun run typecheck  # tsc --noEmit, strict
bun run build      # typecheck, then dist/lens-translate.user.js
```

## For agents

`AGENTS.md` records the architecture and, more usefully, the constraints that
were discovered the hard way — why the renderer is a sibling element, why the
protobuf codec is hand-rolled while the field numbers are not, and which test
setups produce false passes.

## Related

[chrome-lens-py](https://github.com/bropines/chrome-lens-py) is the Python implementation of the same protocol, with the same renderer, a CLI, region queries and a local daemon.

## License

MIT
