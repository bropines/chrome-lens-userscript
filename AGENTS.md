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
  detect.ts             what counts as a picture, and where they are
  settings.ts           GM-backed store, defaults, and the settings field list
  languages.ts          language codes; labels come from Intl.DisplayNames
  cache.ts              LRU over Lens responses, evicted by bytes
  store.ts              the same answers kept across reloads, keyed by content
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

It has to be reachable without the UI. `GM_registerMenuCommand` is not a way
in: some hosts do not have it, and the ones that do have nowhere to show it on
a phone - no mobile browser has a userscript menu. The settings button is not a
way in either, because it is the thing that is missing whenever anything is
wrong. `#lens-debug` on the end of any URL opens the report, and the report
carries a Settings button so the panel is reachable when the gear is not.

Past that, `chrome://inspect` over USB gives real DevTools against the phone's
page. AdGuard runs scripts in the page context, so its errors are in the
ordinary console; Tampermonkey's are behind its own context in the dropdown.

### A picture is a kind, not a tag

`<img>` is most of them and finding only those is not enough. `detect.ts`
classifies four kinds - `img`, `canvas`, `video` and a CSS `background` - and
everything downstream works on a `Target` (element, kind, url) rather than an
`HTMLImageElement`. Three things that cost a session each:

- **The document is not the page.** The site this was written for serves 24 kB
  of HTML holding three `<img>`: a banner, an icon and a spinner. Every picture
  worth translating arrives later from an API. A detector that reads the
  document once finds nothing, so the list is kept current by a
  MutationObserver - `childList` for new nodes and `src`/`srcset`/`style`/
  `class` for an element that becomes a picture without being replaced.
- **`document.images` does not cross a shadow boundary**, and neither does
  `querySelectorAll`. The walk recurses into open shadow roots. Closed ones
  stay invisible, which nothing can help.
- **A canvas and a video have no address.** They key on nothing, so they are
  never cached, and a tainted one cannot be recovered by re-fetching because
  there is no URL to fetch. That is the one dead end in the ladder.

**A lazily-loaded image has no box until it loads, and does not load until it
has one.** Real pages break that circle with an `aspect-ratio` or a placeholder
size; until something does, the image is 0 tall, fails the size test and is not
a picture. Nothing this listens for necessarily fires when it finally gets a
box, so an empty result schedules a bounded retry - unbounded it would be a
walk of the whole tree every quarter second on a page that has no pictures at
all. A mutation or a scroll resets the budget.

**A pointer that cannot reach it does not get the button.** The walk crosses
shadow boundaries, and so it finds whatever a devtools overlay put there: eruda
keeps a `luna-dom-highlighter` canvas the size of the viewport, which beat the
actual page on area and sent the button to the top corner. `pointer-events:
none` is what every such layer is made of, so it lowers the ranking - and only
lowers it, because a reader that sets it on its page image to stop dragging is a
real thing and there the picture is all there is. What it settles is a
disagreement: the hover path can never select an unpointable element, so the
pinned one must not prefer one. The walk also refuses to enter our own host,
whose settings panel has a canvas of its own.

Enumerating tags is free; deciding a background is not, because it costs a
computed style per element. The sweep is capped, and the hover path never
depends on it - it classifies whatever is under the cursor directly, so a
background always works there.

### The pinned button is a scan, not an observer

A touch screen has no hover, so in `buttonMode: auto` the button is pinned over
whichever image fills most of the viewport rather than summoned by the cursor -
on a reader, the tap that would summon it is the tap that turns the page.

It anchors to the **visible part** of that image, not its box: scroll a tall
page halfway and the image's top edge, and with it the button, is above the
viewport.

**Pinning may only stop the button going away, never stop it arriving.** It
used to switch the hover listeners off, so a device that pinned but found no
image - `document.images` does not reach a site's shadow roots - was left with
no button at all and no way to summon one. Hover stays live in both modes now;
only the hide-on-mouseout is suppressed while pinned.

And the touch test is `(hover: none), (pointer: coarse)`, re-read from a
`change` listener rather than snapshotted at document-idle. `hover: none` alone
misses a phone with a stylus or a mouse attached, and the answer is not always
settled by the time the script runs.

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

**The render key is an exclusion list, not an inclusion list.** It used to name
the settings that matter, and a setting added later was simply not in it: the
cache then handed back a picture drawn with the old value, so changing line
spacing did nothing at all even on a fresh translate. Listing what *cannot*
change a drawing fails the safe way - forget to exclude one and you pay for a
re-render nobody notices.

**A settings change redraws what is already on screen.** A finished rendering is
a picture drawn under the settings of the moment; leaving it there means the
panel says one thing and the page shows another, reconcilable only by toggling
every image by hand. `redrawShowing` goes back through `translate`, so a change
to the drawing comes out of the response cache and costs nothing, while changing
the target language asks Lens again - the right answer in both cases, and not
one that has to be decided here.

### The address is the unreliable half of a picture's identity

`cache.ts` keys on the URL, which is free but wrong often enough to matter: a
CDN serves one photo under a dozen addresses, a reader re-mints a `blob:` URL
every load, and none of it survives a reload at all. `store.ts` keys on the
*content* - a 128x128 downscale run through two FNV lanes, plus the natural size
- and keeps the answer in IndexedDB.

Three things about where it sits in the flow:

- **After the pixels, before the encode.** The decode has happened by then, so
  the fingerprint is nearly free, and the JPEG encode - the expensive half of a
  miss - is skipped entirely on a hit, along with the round trip.
- **Only the answer is kept, never the picture.** Drawing from it is local work
  in milliseconds, and a stored rendering would be wrong the moment a setting
  changed.
- **The languages are part of the entry**, not the key, so asking for a
  different target language misses rather than returning the old translation.

It is per-origin, being IndexedDB, and it degrades to nothing when storage is
blocked - every call resolves to null rather than throwing, including a blocked
upgrade, which would otherwise hang every caller waiting on the database.

Downscaling is deterministic within a browser but not promised across versions.
The worst an upgrade can do is miss and ask Lens again.

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

### The wrap must be measured at the size that gets painted

`fitTextBlock` returns the largest size that fits *and* the lines wrapped for
it. Then the readable-size floor overrides the size - and the lines were still
the ones measured against the box at a font nobody used, so every one of them
overran. On a 600x800 thumbnail shown at 390 px the floor is a 1.5x override,
and whole words left the picture; `fitInside` had put the box inside the image
and the text walked out of the box.

So the wrap is redone at the size actually drawn. `wrapText` still keeps a token
it cannot break even when that token overruns, so one proportional step down
follows - `fontSize * boxW / widest` - which turns the box from a target into a
guarantee.

Reproducing this needed the real geometry, not invented boxes: a synthetic case
with plausible numbers rendered clean. The response was in the store on the
device, so `indexedDB.open('lens-translate')` over the debugger handed back the
exact paragraph and line rects to replay.

### Nothing may be drawn where the canvas will only clip it

The picture is a hard bound, and there are exactly two ways back inside it.
They are not equal: **moving** a box changes nothing about the text, while
**shrinking** it costs a smaller font. So `fitInside` shrinks only by what no
amount of moving could fix - `scale = min(1, W / spanX, H / spanY)` - and then
clamps the centre. A box that already fits comes back untouched.

For a rotated box the bound is its axis-aligned extent, `w * |cos| + h * |sin|`,
because that is the shape the canvas clips against.

The order matters for the reflow path in particular: the box is corrected
*before* `fitTextBlock` runs, so the text is laid out for the room that actually
exists rather than being wrapped for a box half of which is off the picture.
Growing the box by `mangaBoxGrowth` is exactly what pushes a bubble near an edge
over the edge, so it is the grown box that gets corrected.

A test that only checks the ink is inside the image will pass on a rendering
that lost half its words. Count the ink too: every edge case must produce the
same pixel count as the same paragraph drawn with room to spare, because it was
moved rather than cut.

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
the only place this script decides where a line goes. Keeping the server's lines
is what leaves the gap between them out of anyone's hands, which is why
`reflowHorizontal` exists: a vertical column *has* to be re-wrapped, horizontal
text does not, and Chromium never does - but a speech bubble is one text area,
not a transcript of where the source happened to break. Re-wrapping also mends
a word the server split across two of its lines.

It is off by default, because repeating the source layout is the faithful
behaviour and the one people get without asking.

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
