# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

A userscript that translates text inside images in place, talking directly to
Google Lens's private `crupload` endpoint and rendering the result the way
Chromium's own Lens overlay does. Tampermonkey is the reference host; AdGuard's
own userscript engine is supported too, which is what `src/gm.ts` is for.

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
  gm.ts                 every difference between userscript hosts, in one place
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
  H`, both are a fraction of the line's height in pixels. It looks wrong for a
  vertical column, where the height is the long axis rather than the thickness —
  but measured against a live response the server already adapts: a vertical
  line comes back with paddings near 0.05 where a horizontal one gets 0.41.
  **Leave the formula alone.** Deriving the padding from `min(boxW, boxH)`
  instead under-covers the text roughly sevenfold; that was tried, and the black
  bars it was supposed to explain came from somewhere else entirely.
- **Word offsets are UTF-16 code units** (`icu::UnicodeString` on the server).
  JavaScript indexes strings the same way, so `slice` is already correct here —
  but the Python port has to encode to UTF-16 explicitly.

### No GM function may be called without feature-testing it

AdGuard ships a userscript engine (Extensions -> Add extension) and it is close
enough to Tampermonkey to support, but `GM_registerMenuCommand` is absent from
its documented API and missing from some builds - 1.2.7 has it, and it
sandboxes rather than running in the page, which is the opposite of what an
earlier build did. Nothing here may name-check a host or a version. `vite-plugin-monkey` compiles an
import from `$` into `typeof X != "undefined" ? X : void 0`, so the reference is
safe and the *call* is a TypeError - which, at the end of `main.ts`, aborted the
last of the module body. Everything host-specific therefore goes through
`src/gm.ts`, which detects rather than assumes. The commands are registered with
the host when it takes them and drawn in the settings panel regardless, because
the panel is the only way to reach them on AdGuard.

Two more differences live in the same file:

- **Binary bodies are not portable.** No host documents which shapes of request
  body it marshals. The Lens POST goes out as a typed array first; a `400` -
  exactly what a mangled protobuf produces - buys one retry as a binary string,
  and the shape that returns `200` is latched for the session. Any other status
  is a real answer and is not retried, so a bad API key costs one request, not
  two.
- **Binary responses are not portable either.** AdGuard has been loose about
  `responseType` (CoreLibs #1983), so responses are normalised from an
  ArrayBuffer, a typed array, a Blob or a string. The request always carries
  `overrideMimeType: text/plain; charset=x-user-defined`, which is what makes
  the string case lossless - a host that honours `responseType` ignores it,
  since it only governs how *text* is decoded.

Under both of those sits a third rung: a plain `fetch`. AdGuard for Android's
`GM_xmlhttpRequest` reported a network error without the request ever leaving
the device - the DNS log showed nothing - and the Lens endpoint turns out to
answer a CORS preflight, so a page-context request reaches it. It is **last**
because it is leakier: the browser attaches an `Origin` header that cannot be
removed. Whatever answers is latched, so dead rungs cost one request per page.

Only the Lens endpoint latches. What works there says nothing about an image
host, where `fetch` is blocked by the very CORS `GM_xmlhttpRequest` is there to
dodge; and a status other than `400` is a real answer, so nothing below it is
tried and a bad API key is not spent twice.

An empty body is a body. Returning `null` for an empty string here reported a
zero-byte 200 as "a response this script cannot read".

**Nothing but a string may be handed to `GM_setValue`.** GM4 promises to persist
strings, numbers and booleans, and AdGuard for Android honours exactly that in
the worst possible way: it accepts an object and hands it straight back for as
long as the page lives, so a read-after-write passes - and then the key reads
empty after a reload. Settings that held until you refreshed were the symptom.
`writeStored` JSON-encodes everything; `readStored` still accepts an object, so
a profile an older version wrote keeps loading.

### A userscript on a phone has to diagnose itself

There is no console to open and the host reports one word for every network
failure, so `diagnose.ts` asks the questions instead: both transports against
the Lens endpoint and against a control host, four requests, and a verdict that
reads them. Any HTTP status is a pass - a `GET` to `crupload` is refused,
because it wants a `POST`, and a refusal still proves the request went out and
came back. That is the distinction "network error" destroys, and it is what
separates a broken transport from a blocked domain from a dead connection.

Two mistakes in the first version of it are worth not repeating, because both
made a working setup look broken:

- **A probe must send the real request.** It used a `GET`, which the Lens
  endpoint answers `404` with no CORS headers, so the fetch rung reported
  `Failed to fetch` - indistinguishable from a blocked domain. The real `POST`,
  with its own headers, comes back `200` and `Access-Control-Allow-Origin`.
- **A status is an answer wherever it arrives.** AdGuard routes every non-2xx
  through `onerror`, so a `404` that proved the round trip worked was read as a
  network failure. `sendViaGm` now delivers any `onerror` carrying a status,
  which is also what lets the `400` encoding retry work on that host.

Past that, `chrome://inspect` over USB gives real DevTools against the phone's
page. AdGuard runs scripts in the page context, so its errors are in the
ordinary console; Tampermonkey's are behind its own context in the dropdown.

### The pinned button is a scan, not an observer

A touch screen has no hover, so in `buttonMode: auto` the button is pinned over
whichever image fills most of the viewport rather than summoned by the cursor -
on a reader, the tap that would summon it is the tap that turns the page.

It anchors to the **visible part** of that image, not its box: scroll a tall
page halfway and the image's top edge, and with it the button, is above the
viewport.

The obvious implementation is an IntersectionObserver over the candidates, and
it was written that way first. It only reports while the document is being
rendered: in a tab that is never painted it never fires at all, and the button
simply never appears with nothing logged to say why. A scan of `document.images`
answers from layout, which is always there, and a few hundred rects once per
animation frame cost nothing next to that. The one thing it gives up is images
inside a site's own shadow root, which the hover path reaches via
`composedPath`.

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
  it past the box; lines can then overlap, which is why it is a setting. It is
  measured in *displayed* CSS pixels, so the narrower the image is shown the
  harder it multiplies - which is why a phone needs a lower value than a desktop
  for the same page, and why settings being per-host storage is a feature here.
- **Vertical CJK reflow.** Chromium keeps the column. A Russian translation set
  vertically is unreadable, so `verticalText: auto` keeps it only for CJK
  targets. Reflow is not just a flag: a vertical line box is a tall narrow
  column that horizontal text cannot occupy, so the *paragraph* box becomes one
  text area and the text is re-wrapped into it (`drawReflowedParagraph`). The
  per-line patches are still painted, to erase the source.

### The outline is a stroke, not four shadows

Chromium draws it as a four-offset `text-shadow`, because CSS has no portable
text stroke. Canvas has `strokeText`, and the difference shows up as soon as the
radius grows: four diagonal copies only read as an outline while the offset is
small, and past a couple of pixels they separate into four ghosts with gaps
between them. The canvas renderer strokes; the DOM renderer, which has no
stroke available, uses eight directions rather than four.

`strokeText` straddles the glyph outline, so the visible thickness is half the
line width.

### The readable-size floor must not size a box by ratio

When `minReadablePx` raises the font past what its box can hold, the background
behind it has to grow too. Growing it by `size / fitted` is what actually
painted the bars: a vertical column fitted at 3px and floored at 24px grows
eightfold, turning a 27x264 box into a 216x2112 rectangle on a 760x560 image.
Measure the text and size the fill to that; a ratio has nothing bounding it.

### A widened line must be nudged back inside the image

The readable-size floor grows a line past its box, and the line is drawn centred
on that box, so one near an edge runs off the canvas and is simply clipped -
half a sentence gone. It shows up on a phone first because the floor multiplies
by `canvasWidth / displayedWidth`: the same image at 375 CSS px instead of 610
asks for roughly twice the font, and the same page that is fine on a desktop
loses its left-hand column on a phone.

`nudgeInside` shifts the draw box back in. Three things about it:

- The bounds are in canvas space and the context is in the line's rotated frame,
  so the shift is computed in the first and rotated into the second. An
  axis-aligned clamp applied to a rotated line moves it the wrong way.
- It runs **before** anything is painted, so the enlarged background travels
  with its text. The inpainted patch is drawn earlier and deliberately stays:
  it erases the original, which has not moved.
- A box too big to fit at all is aligned to the start of the line - left, or
  right when the block is RTL - because the half that survives should be the
  half you read first.

A line that already fits is not touched, which is what keeps the desktop
rendering identical.

### Line spacing only exists where text was re-wrapped

`lineSpacing` reaches `drawReflowedParagraph` and nothing else, because that is
the only place this script decides where a line goes. Everywhere else each line
is painted at the box the server reported for it, and the gap between two of
them is the source's, not ours.

It has to reach **both** halves of the reflow: the multiple `fitTextBlock`
measures against and the one the draw loop advances by. Fitting against 1.25 and
then painting at 1.9 chooses a size for a box the text no longer fits.

A looser spacing therefore yields a *smaller* font, not a taller block - the fit
trades one for the other, and the block stays inside the box either way. Anyone
measuring this from pixels should measure that invariant; the pitch between
bands merges into one at tight spacings and is not a reliable read.

### Wrapping is a property of the language, not the string

`wrapText` decides between word and character breaking from `wrapsPerCharacter`,
which looks at the *target language*. It used to check whether the string
contained a space, which meant a short Russian word with none in it got split
letter by letter down a column.

### The inpainting leaves residue

The patches erase the source glyphs but keep their anti-aliased edges. On one
horizontal line that is barely visible; on a page of vertical text it reads as
noise under the translation. Nothing on the client can improve the patch itself
— the Python renderer shows the same.

`eraseMode: 'hull'` covers the area instead, and the *shape* is the point
(`render/hull.ts`). The paragraph's bounding box is wrong for it: for columns
at an angle, or ragged lines, a rectangle takes in far more than the text and an
ellipse inscribed in it takes in too little at the corners. The convex hull of
every line box's corners is exactly the text's extent. Growing it and rounding
its corners is one operation — stroke the hull path with a round-joined line of
width `2 * pad`, then fill.

## Conventions

- Strict TypeScript. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
  are on; respect them rather than reaching for `any` or `!`.
- Comments explain **why**, not what. Most comments here record a constraint
  discovered the hard way; keep that habit.
- No emoji in code or commit messages. No decorative banner comments.
- `dist/` is committed so the script can be installed straight from the repo.
  Rebuild it in the same commit as any `src/` change - CI rebuilds and refuses
  a diff, because a stale `dist/` ships silently: the header claims the new
  version and the code is the old one.
- Bump `version` in `package.json` with anything users will install. CI tags
  `v<version>` and cuts a release from it on every push to `main` that carries
  a version it has not seen; the tag is the only way back to a build that
  worked.

## Verifying changes

There is no test runner. Changes to rendering or the protocol are verified in a
real browser against a recorded Lens response: build a page that inlines
`dist/lens-translate.user.js`, shim the `GM_*` functions, and drive the script
through a real hover and click.

`src/gm.ts` is verified the same way but without a browser: build it as its own
entry, then `eval` the bundle under a fake host, re-evaluating for each shape
worth covering - `vite-plugin-monkey` captures the `GM_*` globals when the
bundle starts, so a fresh `eval` is what picks up a different host. The shapes
that matter are Tampermonkey (typed array in, ArrayBuffer out), AdGuard (string
only in, text out, no menu), a host with only the GM4 `GM.xmlHttpRequest`, and
one with no transport at all. A body covering all 256 byte values is what
catches a lossy path; a short ASCII one passes through nearly anything. Past sessions have used this to confirm
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
