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
bun run typecheck  # tsc --noEmit, strict (src and test)
bun run check      # layering: the engine stays clean, the host stays in gm.ts
bun test           # unit tests, no browser; CI runs them before the build
bun run locales:check  # locales/*.json against the English keys (the tests run the same rules)
bun run build      # typecheck, check, then dist/lens-translate.user.js + .meta.js
bun run dev        # live-reload userscript for development
```

`bun run build` is the gate: it will not emit if the types do not check, or if
the layering is broken. It does not run the tests - `bun test` is its own step,
in CI and before you commit.

Bun is pinned in CI (`bun-version` in the workflow) because `dist/` is compared
byte for byte; bump it deliberately, with a rebuilt `dist/`. `.gitattributes`
pins text files to LF for the same reason: on a Windows checkout with autocrlf
`src/ui/styles.css` arrives with CRLF and is inlined into the bundle as such,
so a local build differs from CI's. Write files with LF.

## Layout

```
proto/                  Chromium's Lens .proto files, copied verbatim
scripts/gen-fields.ts   descriptors -> typed field-number table (build time only)
scripts/check-layers.ts the engine may not import the application; the host
                        is only named in gm.ts; no dynamic import()
scripts/locales-check.ts every locales/*.json has exactly the English keys
locales/                the interface in other languages - downloaded at run
                        time from this repo, never bundled
test/                   bun test; setup.ts stubs the page with a predictable ruler
src/
  engine.ts             the engine's public entry - everything below the line
  boot.ts               the userscript's entry: start now, or sleep in a frame
  main.ts               the front end, as one function: start()
  frame.ts              when a frame wakes; nothing before that but listeners
  protobuf.ts           minimal wire codec: varint, length-delimited, fixed32
  types.ts              shared domain types; every cross-module shape lives here
  transport.ts          the privileged request the engine cannot make itself
  gm.ts                 every difference between userscript hosts, in one place
  detect.ts             what counts as a picture, and where they are
  settings.ts           GM-backed store, defaults, the field schema (which tab,
                        which type, which range), export and import
  state.ts              the last action and the last question, under their own key
  version.ts            the version, as a build-time constant
  i18n/                 en.ts is every string by key; locale.ts is the pure part
                        (validate, pick, fetch); index.ts is t() and the loading
  sites.ts              per-hostname rules: default, off, auto-translate
  languages.ts          language codes; labels come from Intl.DisplayNames
  cache.ts              LRU over Lens responses and renderings, one byte budget
  store.ts              the same answers kept across reloads, keyed by content
  likeness.ts           the same frame at another size: a grey copy, then the
                        lines that were read, compared where they are (pure)
  textlike.ts           could this picture have text in it, from its pixels
                        and language, with recency in a store of its own
  image.ts              fetch, downscale, JPEG encode
  gen/fields.ts         GENERATED - do not edit
  lens/                 request builder, response parser, transport, plain text;
                        tiles.ts cuts a long strip and merges the answers (pure),
                        ask.ts sends them
  render/
    layout.ts           the pure layout maths, shared by both renderers
    bubble.ts           a speech bubble as a text area: is it one, its shape
                        from the pixels, the largest type that shape holds (pure)
    background.ts       a CSS background as geometry (pure)
    edits.ts            a person's corrections to a drawing, as data (pure)
    canvas.ts           paints the translation into a bitmap
    cover.ts            lays that bitmap over the image as a sibling
    watch.ts            notices that a covered element is no longer that picture
    overlay.ts          the alternative DOM-lines renderer
  ui/                   shadow root, settings window, menu, styles;
                        buttons.ts and shortcuts.ts are the row and the key
                        chords as plain data
    geometry.ts         pure: object-fit rect, drag -> region, keyboard inset
    sample.ts           the picture the settings preview translates, as data:
                        its boxes, a hand-written Lens answer, what redraws it
    preview.ts          paints that picture and runs the real renderer over it
    schematics.ts       small pictures for spatial choices, as lists of shapes
    tools.ts            the layer over a picture: area, objects, words
    editor.ts           the quick editor: the drawing, a box per paragraph
    icons.ts            stroke icons as path data
```

## Things that are the way they are for a reason

Each of these cost a debugging session. Please do not "simplify" them without
reading the reasoning first.

### The engine may not import the application

`src/engine.ts` is the line. Everything reachable from it asks Lens and draws
the answer; nothing reachable from it knows what a userscript is. Above the
line are `main.ts`, `settings.ts`, `gm.ts`, `diagnose.ts` and `ui/`, and they
may import downwards as much as they like.

The reason is a second consumer: the same engine drives another script, and it
cannot bring this one's button, shadow root and settings panel with it. But the
property is negative, which is the kind that decays. It held on the day it was
arranged and three imports had already crossed the line before anyone looked:

| module | pulled | what exactly |
|---|---|---|
| `render/overlay.ts` | `ui/root.ts` | drew its layer into **our** shadow root |
| `detect.ts` | `ui/root.ts` | knew our `HOST_ID` |
| `detect.ts` | `render/cover.ts` | knew **our** cover marker |

Each was a one-line convenience at the time. So it is checked rather than
intended: `scripts/check-layers.ts` walks the import closure of the entry point
and fails the build if it reaches the application or any bare specifier - which
is what catches `$`, and with it `vite-plugin-monkey`. Run it against a
deliberate violation before trusting it; a checker that cannot fail proves
nothing, and this one was written by adding the import back and watching it go
red.

It also checks two rules about the whole tree, which decay the same way:

- **`GM_*`, `GM` and `unsafeWindow` are named in `gm.ts` and nowhere else**, and
  only `gm.ts` imports `$`. It looks at transpiled output (so a comment
  mentioning `GM_xmlhttpRequest` is not a call) with string literals skipped.
  Everything host-specific is a feature test in one file; a direct call
  elsewhere is a TypeError on the next host.
- **No dynamic `import()`.** The bundle is one file and the closure walk only
  follows static specifiers, so a dynamic one would be a module nothing checks.

Add a violation of each before trusting a change to the checker.

Three things came out of drawing the line, and all three are better designs
independently of the consumer:

- **The options are split three ways.** `Settings` was one 32-field object and
  would have become the public API, so a caller wanting to draw a picture had to
  invent a value for `hotkey`. `LensOptions` is what is asked of Lens,
  `RenderOptions` how the answer is drawn, `CacheOptions` what is kept;
  `EngineOptions` is the three together and `Settings` is that plus this
  script's own `AppSettings`. Each module takes the narrowest one it uses, which
  is also documentation: `renderToBlob` cannot read an API key.
- **The transport is injected.** `lens/client.ts` imported `gm.ts`, which
  imports `$`, which is the whole dependency on a userscript host. Now the
  engine declares `Transport` and the front end calls `setTransport`. `gm.ts`
  exports `gmTransport`, and the Tampermonkey blocked-domain hint moved with it,
  since only a host knows where a blocked domain is undone.
- **The detector is told what to ignore.** `ignoreElements` takes a predicate;
  `main.ts` passes `(el) => el.id === HOST_ID || isCover(el)`. It must be
  installed before anything scans, which is why it sits at the top of `main.ts`
  next to `setTransport`.

The DOM renderer's CSS travels with it as `OVERLAY_CSS` rather than living in
`ui/styles.css`, because `position: absolute` and `white-space: pre` are not
decoration there - they are how a line lands where the geometry says it does,
and a front end that drops them gets a correct layout stacked in one corner.

What CI cannot check is a breaking change to the engine's surface, since there
is no consumer here to break. The tag is the contract: pin it.

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

What the sibling does not do by itself is notice that the framework changed
what the image *is*. A virtualised feed reuses the `<img>` for the next post by
assigning a new `src`, and a cover that nobody told sits on top of a different
photograph - and then a settings change "redraws" it by the stale address. A
framework that makes a new element instead leaves the cover orphaned in the page
and its object URL unrevocable, because the only way to a cover was through its
image. So:

- `render/watch.ts` watches a covered element: `src`/`srcset`/`sizes` (or
  `style`/`class` for a background), plus `load` and `error`, which are the only
  report of a `<picture>` source switching under a media query. A new address
  that **normalises to the same one** is not a change (Twitter's
  `?name=small` -> `large`), and re-asserting the same `src`, which React does
  every render, is not news either. While a change is unresolved the cover is
  hidden, not left over the new picture; `currentSrc` lags the attribute, hence
  the short settle delay.
- Covers are registered by the **cover element**, which is in the page, and
  callbacks hold a `WeakRef` to the image, so the registry is not what keeps a
  discarded element alive. `coverImage` owns the object URL it is given,
  including when it fails to lay the cover.
- `main.ts` sweeps every few seconds and prunes `showing`. The resize observer
  is what reports a removal quickly - but **it, `requestAnimationFrame` and
  `IntersectionObserver` do not fire in a pane that is not being painted**, so
  a test in a hidden browser pane sees covers that never go. Test in a painting
  browser.
- The tail of the same lesson: `mouseover` only fires on *entering* an element,
  so a test that leaves the cursor where it was and expects the button after a
  state change is testing the test.

A cover for a CSS background is not the element's box. `render/background.ts`
works out where `background-size`/`-position`/`-origin` put the one painted copy
and `place` in `cover.ts` puts the cover there, clipped to `background-clip`
with the element's rounded corners as a `clip-path`; for `<img>`, `<canvas>` and
`<video>` it is the **content** box, with `object-position` copied alongside
`object-fit`. Measured by screenshotting the original and then the cover alone
over a hidden original: identical to the pixel for replaced elements, and
differing only on rows where a half-pixel offset antialiases the edge for
backgrounds.

### All UI lives in a shadow root

Page CSS beats `GM_addStyle` on equal specificity when it comes later, and
`!important` beats it outright. A shadow root is not a specificity contest.

But a shadow root blocks **selectors, not inheritance**. Font, colour,
direction and line-height still reach in through the host, so the host carries
`all: initial !important` — and then has to restate the font, because `initial`
for `font-family` is the browser's serif default and an inline `!important`
declaration outranks any `:host` rule.

### Every word is a key, and the other languages are not in the bundle

`src/i18n/en.ts` is the one place a user-visible string is written. Everything
above the line calls `t('some.key', { name })`; the engine does not, cannot
(the layering check lists `src/i18n/` as the application), and its error
messages stay English - they arrive inside `Lens: {message}`.

- **Other languages are downloaded, not bundled.** Ten locales are ~250 kB of
  strings that would be parsed on every page load by people who read one of
  them. The script fetches `locales/<code>.json` from
  `raw.githubusercontent.com` at `v<version>`, falls back to `main` when the
  tag answers 404 (a beta has no tag), and keeps the result in host storage
  under `{ version, code }`. English, or *Auto* in an English browser, makes
  no request at all - which the verification harness depends on: it counts
  requests, so it pins `navigator.languages`.
- **Through `gmTransport.get`, not `fetch`.** A page's CSP decides what its own
  `fetch` may reach.
- **The version is a build-time constant** (`src/version.ts`, `define` in
  vite.config.ts), not `GM_info`: a tag is fetched by that number and
  "unknown" is not a tag.
- **A locale is somebody else's file by the time it arrives.** Unknown keys are
  dropped, a string whose `{placeholders}` differ from English falls back to
  English, and strings go in as `textContent`, never markup. Do not build UI
  with `innerHTML` from a translated string.
- **No plurals.** One key cannot hold the three or four forms Russian needs, and
  the key sets must be identical across files, so counts are written as a
  figure after a label ("Images restored: {count}").
- **Nothing waits for a locale.** The UI is English until it lands; then
  `onLocaleChange` listeners redraw - the control row, and the settings window
  where it stands, on the same tab with the same unsaved values.
- **The settings schema carries no words.** A field's label is
  `set.<key>.label`, its hint `set.<key>.hint`, a choice
  `set.<key>.opt.<value>`; `test/settings.test.ts` walks `FIELDS` and asks the
  dictionary for each, and `test/i18n.test.ts` holds every locale to the
  English key set. Add a setting and both fail until its words exist; then run
  `bun run locales:check` and translate the new keys in all ten files.

### The settings window draws every field at once

A tab is only which pane is shown. That is what lets the search box look across
all of them and `collect` read the whole form without knowing which tab was
open - and it is why `[data-key]` is on exactly one element per setting, the
one whose `.value` (or `.checked`) is the value. A compound field (the button
list, a shortcut, a colour) keeps its value in one input and treats the rest as
a way of editing it.

One function decides what a setting may hold: `sanitize` in settings.ts. The
form goes through it (`coerce`) and so does an imported file, so the two cannot
disagree about a range. Import, reset and "reset all" write into the *form*;
only Save writes the store.

The Appearance tab carries a sample translation (`ui/preview.ts`): a scene
painted in code, an answer for it written by hand (`ui/sample.ts`) and the real
`renderToBlob` in between, redrawn from the form's values a moment after any
edit. Three things about it:

- **It is one node for the life of the window**, put back into its pane each
  time `fill` rebuilds the form. Rebuilt with the rest, every reset blanked the
  picture and waited for the next one.
- **It is drawn for the sample's own width, not the width it is shown at.** The
  readable-size floor is in displayed pixels, and at a thumbnail's 240 of them
  the floor nearly doubles every size and is all the sample shows. The sample
  stands for a picture at its natural size.
- **Its patches keep a faint copy of the source lettering**, as the server's
  inpainting does. With clean ones the outline and the hull would have nothing
  to do and look like settings that change nothing.

A select about where something goes (`buttonCorner`, `eraseMode`, ...) has a
small picture of the chosen value beside it, from `ui/schematics.ts` - shapes
as data, drawn with `createElementNS`, coloured by class so the theme applies.

The control row is rebuilt from settings (`buildControls` in main.ts), so
nothing may hold a reference to a control across a save: listeners are attached
at build time or on `#lt-controls` itself. The main button is always first,
in the corner, because it arrives alone a beat before the rest.

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
  150 is in the picture's own pixels; the canvas is drawn at the supersample
  factor, so the cap handed to `fitFontSize`/`fitTextBlock` is `150 * scale`.
  Applying 150 to canvas pixels capped a headline at 75 natural pixels on 2x.
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

**An image fetch is sent as the browser's own would have been.** `getBinary`
takes the page as `Referer` (the engine's `Transport.get` has an optional
`referer`, so another front end can supply its own) and sends cookies
(`anonymous: false`). Hotlink-protected hosts - pixiv's image host, most manga
CDNs - answer `403` to a bare `GM_xmlhttpRequest`. The Lens POST gets neither.

**Storage has three shapes.** The synchronous `GM_getValue`; the promise-only
`GM.getValue` of Greasemonkey 4 and Safari's Userscripts, which cannot be read
synchronously and so are loaded into memory once (`preloadStored`) with the
settings and site rules re-read when they land; and `localStorage`, which is the
*site's* and only a last resort. Falling to it silently is how Safari settings
became per-site. Both grant names are declared.

**Frames sleep until they hold a picture.** The header carried `@noframes`
for a long time, because the script ran in every ad and embed on a page, each
with a copy of the bundle, an observer and a shadow root, and offered to
translate an advert. Its cost was a reader or gallery that renders pages in an
iframe of its own, which got no button at all - and there is no per-frame
opt-in in the metadata. So `@noframes` is gone and `src/boot.ts` decides
instead: the top window calls `start()` in `main.ts` at once; a frame reads
the settings and site rules, exits if `frames` is off or its own hostname (or
the top page's, when `ancestorOrigins` or the referrer can name it - Firefox
often cannot, and unknown is not off) is switched off, and otherwise sleeps
(`src/frame.ts`). Asleep means no shadow root, no MutationObserver, no sweep
timer, no hotkeys, no auto-translate: only a capture-phase `load`, a
`pointerover` and a `resize`, each looking at one element (or the plain
`img`/`canvas`/`video` list for a resize). It wakes, running `start()`
once, when its own viewport is at least 400x300 **and** it holds a picture that
passes `isBigEnough`. Both halves, the hover path included: every IAB ad unit
(300x250, 728x90, 970x250, 300x600, ...) fails the viewport test, so an ad
never wakes however big the picture in it is. `main.ts` is therefore a
function, `start`, not a module body - a frame imports it and may never call
it. A woken frame keeps its commands out of the host's menu (ten frames would
list each one ten times) and does not answer `#lens-debug`; and a frame
sandboxed without `allow-popups` refuses both `window.open` and
`target=_blank`, so a failed open in a frame prints the address with a Copy
button. The harness proves the sleep by counting `MutationObserver.observe`
calls inside a 300x250 cross-origin frame: there must be none.

`updateURL` points at `dist/lens-translate.meta.js` (the header
alone, emitted by `metaFileName`) so a manager's version poll does not download
the whole bundle; `downloadURL` stays the full script.

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
whose settings panel has a canvas of its own - through the predicate the front
end installs with `ignoreElements`, not by knowing what our host is.

Enumerating tags is free; deciding a background is not, because it costs a
computed style per element. The sweep is capped, and the hover path never
depends on it - it classifies whatever is under the cursor directly, so a
background always works there.

**A background is a picture only if it is painted once.** `url()` on `<body>`,
`<html>` or a wrapper is a texture, and because a hover takes the nearest
classified element up the tree, one patterned ancestor made every spot of the
page without a picture of its own offer to translate it. So: `body`/`html` are
never pictures; a repeating background counts only when its size always fills
the box (`cover`, or an explicit size at least that big) - `repeat` with `auto`
size is the signature of a pattern, decided from the style alone before the
image has loaded; a size the style settles that is under `minImageSize` fails
the size test (a 24px icon on a wide bar); and what is not modelled (fixed
attachment, text clipping, `space`/`round`, a position it cannot resolve) is
refused, not guessed. The exact "was it tiled" test waits for the picture's own
size and happens when the cover is laid. The first `url()` layer is used, with
its siblings looked up at the same index of each list.

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
budget **and one clock** (it said so for a while before it was true: each map
evicted against the full limit on its own). It is the memory allowance;
`store.ts` is a separate allowance of the same size on disk. Mistakes made here
that are worth not repeating:

- The response cache was keyed on the raw image URL. Twitter serves one photo
  as `?name=small` / `medium` / `large` / `orig` and React rewrites `src`
  between them, so every layout change was a miss. Keys go through
  `normalizeUrl`, which drops rendition parameters.
- ...and that list was too long. `w`, `h`, `s`, `fit`, `crop` and `resize` do not
  pick a *resolution* of a picture, they pick *which part*, so two crops of one
  path collided and the second got the first one's translation laid out for a
  different frame. Only parameters that change the pixel count of the same frame
  are dropped (`name`, `format`, `fm`, `q`, `quality`, `dpr`, `auto`), and each
  only when its value looks like that kind of value (`name` on another CDN is a
  filename). An entry also remembers the proportions of the pixels it was made
  from and a hit that disagrees by more than rounding is a miss - compared as an
  aspect ratio, since `small` and `orig` are different sizes of one frame.
- The cache check sat *after* `prepareImage`, so a hit still fetched pixels and
  JPEG-encoded an upload nobody would send. The render cache is now checked
  first and short-circuits everything; the response cache sits ahead of the
  encode.

Verified by counting `drawImage` calls and POSTs: three translations of the same
photo under three rendition URLs cost one POST and zero pixel reads after the
first.

**The render key names the settings that matter, and the compiler checks the
list.** It named them once before and went stale: a setting added later was
simply not in it, the cache handed back a picture drawn with the old value, and
changing line spacing did nothing at all even on a fresh translate. The fix at
the time was to invert it and list what *cannot* change a drawing, which fails
the safe way but only by giving up on being right.

Splitting `RenderOptions` out of `Settings` is what makes naming them safe
again. `DRAWN` is written `satisfies Record<keyof RenderOptions, 0>`, so a field
added to that type fails the build until it is listed. Do not put it back as an
exclusion list - that was a workaround for a list nothing was checking, and now
something is.

**A settings change redraws what is already on screen.** A finished rendering is
a picture drawn under the settings of the moment; leaving it there means the
panel says one thing and the page shows another, reconcilable only by toggling
every image by hand. `redrawShowing` goes back through `translate`, so a change
to the drawing comes out of the response cache and costs nothing, while changing
the target language asks Lens again - the right answer in both cases, and not
one that has to be decided here.

### A long strip is several pictures to Lens and one to everything else

The upload budget is an area *and* a longest side. A page is bound by the area
and its text survives; a webtoon strip of 800x12000 is bound by the side, goes
up 107 pixels wide, and Lens finds nothing in it - measured live on an 800x11352
strip: 0 lines from one upload, 456 from ten tiles, in three seconds.

`lens/tiles.ts` is the arithmetic and `lens/ask.ts` the sending; `askLens` is
what a front end calls, and for a picture that is not tiled it is the old
`encodeForUpload` + `callLens`, unchanged. It lives in the engine, so the other
consumer gets it too.

- **Tiled only when the long side is what binds.** One upload's scale
  (`maxSide / long`) against what the area alone would allow, and tiled under
  0.7 of it. 1500x2000 is 0.80 against 0.71 and goes up once; so does anything
  Chromium's rule does not scale at all.
- **A tile spans the short side and is as long as still uploads unscaled**, at
  least 1.5 of the short side (a page), at most 4. For 800 wide that is 1600.
  Neighbours share a quarter - the size of a bubble, since a paragraph cut by an
  edge is whole in the neighbour only if it is shorter than the overlap. Twelve
  at most; past that tiles grow longer, not more numerous, and are scaled like
  any oversized upload.
- **A tile is a crop, so its boxes move by a translation in pixels.** The angle
  is untouched; only the normalisation changes, per axis. The patch padding is a
  fraction of the line's height in pixels and needs nothing.
- **Bands rank, they do not decide.** Each tile owns the stretch between the
  middles of its overlaps, and a paragraph belongs to the band its centre is in.
  Applied as a filter that loses text: two readings of one paragraph disagree on
  the centre by a pixel, a seam falls between them and each tile defers to the
  other. So: whole and in band first, whole out of band, then cut, larger first;
  a paragraph is kept unless one already kept *from another tile* is the same
  paragraph (half of the smaller inside the other). Nothing goes for where it
  is, only for being a duplicate of something that stays.
- **"Cut" is ending within a glyph and a half of a tile's inner edge.** A line
  the edge runs through is usually not reported, so the paragraph stops a line
  short. A paragraph taller than the overlap is whole nowhere: the larger piece
  stays and the smaller keeps the lines past it, with its translation cut to
  those lines' word ranges - a second paragraph, not a hole.
- **A failed tile fails the translation.** One retry first unless the failure is
  an answer (a 4xx other than 408/429) or a timeout. The first tile goes alone,
  so a bad key still costs one request; the rest go two at a time.
- **The keys.** `cacheKey` gains a field only for `tileLongImages: 'off'`, so
  switching it asks again. The store's key is the fingerprint - of the whole
  picture, as before - plus `tilingTag`, which is empty unless the picture is
  really tiled: every answer stored before this is still found, except a
  strip's, which was the unreadable one. A hit in either costs no request.

The setting is in `LensOptions`, not `RenderOptions`: it changes what is asked.
It is optional there, and left out it is `auto`.

Searching is not tiled. A region search already sends its crop at full
resolution, which is the same idea.

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
- **The languages are part of the key**, with the hash. They were a field to
  compare, which made a miss on a different language correct but made translating
  to a second language *overwrite* the first, and going back paid Lens again.
- **Recency lives in a small `meta` store**, and eviction walks its `used` index
  with a cursor. A hit used to rewrite the whole record (megabytes of patches) to
  update one number, and every write ran `getAll()` on the responses to total the
  bytes. A hit now touches only the small record, at most once a minute per
  entry; the total is kept by arithmetic and recounted from the small records now
  and then, since other tabs write too.
- Version 1 data is keyed the wrong way round and cannot be migrated, so the
  upgrade drops it. It is tested against `fake-indexeddb`, upgrade included.

It is per-origin, being IndexedDB - what was translated on a site sits in that
site's origin, readable by the site's own scripts, which the README says
plainly. It degrades to nothing when storage is
blocked - every call resolves to null rather than throwing, including a blocked
upgrade, which would otherwise hang every caller waiting on the database.

Downscaling is deterministic within a browser but not promised across versions.
The worst an upgrade can do is miss and ask Lens again.

### A thumbnail and its original are one picture, if the text says so

The fingerprint hashes the pixels with the size, so the commonest repeat - a
feed's thumbnail today, the original tomorrow - shares nothing with it. Lens
answers in fractions of the picture, so either answer draws on the other.
`likeness.ts` decides when that is safe, and the danger is all on one side:
handing back another picture's translation is worse than asking again.

- **The picture as a whole cannot decide it.** Measured on real pictures,
  JPEG'd and scaled the way a CDN does: two captions 1.5% of the picture tall
  differ in 0.1% of the cells of a 64x64 grey copy, and resampling a thumbnail
  moves 1-2%. At 128 or 256 cells the resampling grows with the resolution and
  "same text, smaller" and "other text, smaller" measured the same. So the grey
  copy (with an 8x8 hash to find candidates) only rules out other crops, other
  photographs and large changes, at under 1% of cells off by more than 24.
- **The lines decide.** Every line the answer read is kept as a strip 12 cells
  across its short side (`markStrips`, the browser's own filtering, from the
  region straight to the strip), and the same boxes are cut from the picture
  being asked about. Same line at half or a third the size: correlation 0.98
  and over. Other words: 0.3-0.45. One word changed in the line: 0.88-0.90.
  Every comparable line must reach 0.94. A line under 10 pixels tall in the
  smaller picture is noise and is not counted; with nothing countable the match
  is refused - and so an answer with no lines is only ever found exactly.
- **What it cannot see** is text the stored answer never read: a copy with a
  small caption added keeps every stored line and gains one. Only the grey copy
  can notice, which is why its threshold is as tight as resampling allows. A
  difference away from the text - a square in a corner - is served the same
  answer, and correctly: the harness found that by accident.
- **Detail flows down, not up.** A larger answer serves a smaller picture
  always; a smaller one serves down to half the detail, measured in what Lens
  was sent (an original goes up at 1600 at most, so a 1200 thumbnail's answer
  is reused and a 400 preview's is not - that better answer then serves both).
- Version 3 of the database adds a `faces` store beside the answers, read only
  for the few candidates the small records nominate, deleted with its answer and
  weighed into its bytes. Version 2 data is kept.

### Translating as you scroll is mostly not sending

`autoTranslate` turns the per-site auto rule into a setting for everywhere (a
site rule still wins either way), and a feed is mostly photographs. What keeps
it from being a request per picture, cheapest first:

1. **A size floor** on the shorter displayed side (`autoMinPx`), which avatars,
   icons and previews fail.
2. **Most of it on screen** (`autoVisible`, of the picture or, for one taller
   than the screen, of the screen), **checked again when its turn in the queue
   comes** - a picture queued while in view and scrolled past before a slot was
   free is `deferred`, not sent.
3. **The scroll settles first.** Every event pushes the look back 350 ms, so a
   fling sends nothing for what flew past; a slow steady scroll is looked at
   every 1.2 s anyway.
4. **Both caches and likeness**, where a picture seen before costs nothing.
5. **`textlike.ts`**, only on a miss: the pixels at 1024 on the long side, in
   8-pixel cells, sixteen cells with many strong edges both ways and a wide
   grey range, each beside another. It refuses the plainly bare and nothing
   else: measured, a meme caption down to 2% of the height and dark print on a
   sky down to about 11 pixels pass, a plain sky is refused, and foliage and a
   sharp-featured face pass too, which is the direction to err in. At 256 it
   lost captions under 3%, and a threshold as a share of the picture made the
   finer analysis worse, since one caption is a smaller share of more cells.
   Where the browser has `TextDetector` (Shape Detection API, behind a flag) it
   is asked instead. A WASM detector would be better and was weighed: 4-5 MB
   of model plus a runtime, re-downloaded per origin since IndexedDB is, and
   some CSPs refuse to compile it.
6. **A budget of requests a minute**, a bucket holding a minute's worth; what
   finds it empty is deferred and looked at again when a request is free. Most
   on screen goes first, so the picture being read is the one that gets it.

The automatic pass never takes a translation down - `translate` with `auto`
returns `skipped` for a picture that is already translated rather than
toggling it - and one the reader undid stays undone.

### The General tab says what is true now

It is the one most people only ever see, and it was four fields over a wall of
identical buttons, three of which were toggles that did not say which way they
were set. Now: a card with the switches (enabled, translate as you scroll) and
this site as a three-way choice; the interface as two cards; language and
opacity; the quick actions with icons, the cache's size on its button. The
toggle commands stay in the host's menu.

The site choice applies at once and says so, as it always did, and without the
toast `chooseSite` gives from the menu - from the window it would sit over Save
on a phone. The interface cards edit a hidden select that holds the value, so
`[data-key]` is still one element per setting. A checkbox is a switch
everywhere: its knob is a radial gradient, not a pseudo-element, since an
`<input>` has no `::before` in every engine.

The theme and the tint are attributes on the host (`data-theme`,
`data-accent`, written by `applyLook` in `ui/root.ts`), and 'auto' and the
neutral tint are their absence, so the defaults are the stylesheet as it always
was. A tint replaces only `--primary` and `--ring`, so it reads the same on
either theme, and it is declared after the theme rules, which have the same
specificity. The controls over a picture stay dark glass whatever the theme;
only the main button takes the tint, and not while it is green or red, which
is news.

### Searching, and the UI around it

`lens/search.ts` is the engine half; `main.ts` keeps one `ImageSearch` per
picture (keyed like the response cache, four at most, never for a canvas or a
video) so a second search of the same picture is one request. `uiMode` decides
only what is *shown*: `simple` is translate / search / ask / copy and six
settings, `pro` adds the tools in `ui/tools.ts` and every field. A field or
command marked `essential` is in both.

- **A tab is asked for in the press and told where to go later.** The address
  exists only after Lens answers, and a browser grants a tab only before the
  first `await`. `gm.ts`'s `prepareTab` is called on the first line of the
  handler and `go(url)` when the address arrives. With `GM_openInTab` nothing
  happens until `go` - the host needs no gesture. Without it a blank tab is
  pre-opened only where there is a mouse; on touch `go` answers false and the
  toast carries a real `<a target=_blank>`, which is the one path known to work
  on every phone host. That link is shown after a successful open as well: an
  opener can report success and open nothing.
- **`GM_openInTab(url, false)`, never an option bag.** Both signatures read the
  second argument as "in the background", and an object is truthy.
- **A sheet closes on the scrim's `click`, not on `pointerdown`.** Closed on the
  press, the scrim is gone when the finger lifts and the click lands on the
  page - on a reader, the page turns. Nothing closes on `resize` either: an
  address bar sliding away fires one.
- **`rem` in a shadow root is still the page's.** `--radius` is `8px`, not
  `0.5rem`; a site with `html { font-size: 10px }` shrank every control.
- **The keyboard is measured, not styled around.** Android Chrome shrinks only
  the visual viewport, so a bottom sheet sits under the keyboard its own field
  summons. `ui/root.ts` writes `--lt-kb` from `visualViewport`; sheets add it to
  `bottom` and take it off a `max-height` in `svh`.
- **Fullscreen renders one subtree.** The host moves into the fullscreen
  element (into its shadow root, if it has one) on `fullscreenchange` and back
  out after; an element that cannot show children (`<video>`) leaves it where
  it was. `tendHost`, on the slow sweep, re-appends the host when a later
  sibling ties its z-index - at most five times, in case the rival does the same.
- **Layers over a picture use the picture's rectangle, not the element's.**
  `pictureRect` in `main.ts` takes off border and padding and applies
  `object-fit`/`object-position` (or `paintRect` for a background), because
  everything Lens reports is a fraction of the picture.
- **A region search must send the crop** (`encodeRegion`); with only the box
  Lens answers about the whole picture.

A trap in the browser test: an emulated touch drag lifted mid-flight starts a
fling, and Chrome swallows the next tap as the one that stops it. Come to rest
before `touchEnd` or the tap after a drag "does nothing".

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

### A paragraph's room is bounded by its neighbours, not by a multiple

The detected box hugs the glyphs, so it has to grow - a bubble is round and has
space the box does not describe. `mangaBoxGrowth` guessed at how much, and a
guess is wrong in both directions at once: too little where a bubble is
generous, too much where the next one is close, which is how a translation came
to be written across its neighbour.

`roomFor` grows each side until it would reach another paragraph, capped by the
multiple and by the picture. Only a paragraph sharing the band on the
perpendicular axis can block a side - one diagonally away is not in the way.
Rotation is ignored there on purpose: these boxes come back within a tenth of a
degree of upright, and an approximation erring towards *less* room cannot cause
an overlap.

Room alone is not enough, because the readable-size floor can still ask for more
than any room has. `fitToBox` decides who yields, and the answer is the floor:
the size comes down until the paragraph fits, repeatedly, because a smaller font
rewraps into fewer lines and may then fit outright. Text that shrinks is
readable; text written over the next bubble is not.

This makes `mangaBoxGrowth` safe to raise - the neighbours are the real cap, so
a bigger multiple only takes room that is genuinely free.

Measured rather than eyeballed: render each paragraph alone, then count pixels
where two of those renders are both inked. On the page this came from it was 576
before and 0 after.

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

It was off by default, because repeating the source layout is the faithful
behaviour. It is `auto` now, which is still that for everything except the one
case where faithful is unreadable - see the next section.

It has to reach **both** halves of the reflow: the multiple `fitTextBlock`
measures against and the one the draw loop advances by. Fitting against 1.25 and
then painting at 1.9 chooses a size for a box the text no longer fits.

A looser spacing therefore yields a *smaller* font, not a taller block - the fit
trades one for the other, and the block stays inside the box either way. Anyone
measuring this from pixels should measure that invariant; the pitch between
bands merges into one at tight spacings and is not a reliable read.

### A bubble is one text area, and its shape is in the picture

Lens returns a speech bubble as a column of short lines, one or two words each.
A Russian translation is longer per line, so the per-line fit shrinks it, the
readable-size floor puts the size back, and the lines - still pinned to boxes a
pitch apart - are drawn through each other. Measured on a real page shown at
half its natural width: 1102 pixels inked by two lines at once, and at phone
width 33726, with 40-58% of each paragraph's ink outside its bubble.
`reflowHorizontal` could always fix that, but as a switch it also re-wrapped
every screenshot, so it was off and nobody found it.

It is `'off' | 'auto' | 'on'` now and `auto` is the default. `render/bubble.ts`
holds all of it, as arithmetic that runs without a page.

**The decision is two tests, and the second is the guard.** `isBubbleColumn`
reads geometry alone: at least three lines (two in manga mode - two-line
bubbles are common and so are two-line captions, and only manga mode knows which
the page has), stacked rather than side by side, a median line no wider than 12
line heights, a paragraph no wider than 2.5 of its height, and every line centre
within 0.15 of the paragraph's width of the common axis. The real bubbles sit at
0.55-1.75 for the aspect and under 0.04 for the centring; left-aligned text with
a short last line is off-centre by 0.25, which is what that test is for. But a
centred three-line headline passes all of it, so the column is re-wrapped only
if `crowdsAtFloor` also holds: some line's fitted size is under the floor. A
fitted line is inside its own box by construction, so "under the floor" and
"will overlap" are one event, and a column that fits is left exactly as Chromium
lays it out. Verified by rendering two non-bubble fixtures with the old tree and
the new one and comparing the decoded pixels: identical, as is the manga page
with the setting `off`.

**Geometry is not a promise, so there is a net under the test.** The same page
translated twice came back once with all three bubbles as columns and once with
one of them refused - drawn line by line, every line raised to the floor and
printed through the next. Widening the thresholds after each such report is a
chase. `collidesAtFloor` asks the only question that matters for that outcome:
raised to `max(fitted, floor)`, are two neighbours closer than half their sizes
added up? If so the paragraph is re-wrapped whatever it is - into an outline if
the picture has one, else into its own rectangle where the floor yields - but
it is not called a bubble, so it never gets the invented ellipse. A paragraph
whose lines stay clear of each other is untouched, which keeps the
non-bubble renders as they were.

**The shape comes from the pixels** (`bubbleMask`, fed by `findBubble` in
`canvas.ts`, which reads the *source* at a reduced size - never the canvas,
which by the third paragraph has two translations on it). The background is the
commonest colour inside the line boxes, as a mode over 16-level bins: the boxes
hug the glyphs, so what is not ink there is bubble, and a mode survives the ink
being nearly half the pixels. From those pixels a four-connected fill spreads
over everything within 32 levels of that colour - compared with the colour, not
with the neighbouring pixel, so a gradient cannot walk it out - and stops at the
outline. Things that were each wrong first:

- **The window has open and closed edges.** It is the paragraph padded by 1.5 of
  its longer side, cut back by the picture and by a neighbour in the same band
  (`roomFor` with no cap). A fill that reaches an edge the padding put there was
  not inside anything, and the mask is discarded; reaching the picture's edge or
  a neighbour's is normal - two paragraphs in one bubble each get their half.
- **The line boxes are inside by fiat**, because glyphs are holes and a shape
  with holes has no span per row. That is not enough: a comma or a descender
  crosses the row between two boxes and cuts that row in half, which showed as
  lines pushed to one side of a symmetrical bubble. On the rows the text stood
  on, a gap in the fill narrower than a line is tall is bridged.
- **One span per row, chosen by overlap with the row before**, walking out from
  the middle line - so a lobe reached round a corner is not text area - and rows
  under 0.3 of the widest are trimmed from the ends, because a tail included in
  the shape pulls the centred block towards the speaker.
- Refused: under 0.4 of the line boxes is the background colour (text over
  artwork), or the mask is over half the picture. Then a paragraph that is a
  bubble by the decision above, or by manga mode, gets an ellipse inscribed in
  its room grown by the square root of two - the smallest ellipse that contains
  a box is that box grown by exactly that - and anything else gets the rectangle
  it always had.

A mask is axis-aligned, so it is only used for text within a degree of upright.

**The fit is not a binary search**, though `fitTextBlock` is one. Each line is
as wide as the narrowest row of its own band, less a quarter-em margin; the
block is centred vertically, so the bands depend on the line count and the line
count on the bands, and counts are tried from one upwards. That makes feasible
and infeasible sizes interleave, and a bisection returns whichever feasible size
its midpoints visit: one bubble came out at 36px or 40px depending only on the
upper bound, and the upper bound depends on the displayed width, so the same
paragraph changed size as the window was resized. `fitShaped` tries every size
from the top down - token widths measured once and scaled, which is arithmetic,
and only a size that looks feasible measured for real. That last measurement is
the layout that is painted, so the wrap is still measured at the size drawn.

The ceiling is 1.6 of the source's line height (or the floor, if higher): a
bubble is often far larger than what is said in it. Below the floor, the floor
yields, as `fitToBox` has it for rectangles; with `fitToBox` off the shape is
abandoned for the rectangle instead, since someone asked for size over fit.

Measured as the overlap section above describes, by replaying every `fillText`
alone: overlap 1102 -> 0 and 33726 -> 0, no ink outside any mask, and sizes of
27-46 canvas pixels against 19-30 for the rectangle. Reading a mask takes 1-4 ms
once warm; the first on a page is 10-40.

`bubbleShape` turns the mask off and leaves the rectangle: for textured or
open bubbles, where the outline is misread, and it is in `DRAWN`.

A profile saved by an older version stores `reflowHorizontal: false` whether or
not anyone chose it, because saving writes every key. It reads as `off`. That
is deliberate - turning on what may have been refused is the worse mistake -
and it means only new profiles and reset ones get `auto`.

The engine's `RenderOptions.reflowHorizontal` changed type with this. The
renderer still takes `true` and `false` through `reflowMode`, so a consumer
that has not caught up draws as before, but its type check will say so.

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

### The quick editor changes data, and the renderer draws it

Copying or saving the translated picture, and correcting it by hand, are one
feature: the picture each cover shows is kept (`drawnAs` in main.ts, weak like
`results`), and the editor draws new ones. Four things about it:

- **An edit is a record, not a drawing.** `BlockEdit` (types.ts) is a few
  optional fields per paragraph - text, size, colours, offset, hidden, original
  - and `renderToBlob` takes them as its last argument. The window never paints
  anything itself; every change is drawn again by the real renderer a moment
  later, so what it shows is what Apply lays down. `cleanEdit` decides what an
  edit may hold, for the window and for whatever storage hands back, the way
  `sanitize` does for settings: "scale 1" is the absence of an edit, not one.
- **A changed text, size or position re-sets the paragraph as one area**
  (`resets`). New words have no line ranges to follow, and moving or resizing
  has to leave the erased source where it was - which is exactly the split the
  re-wrap path already makes: patches per line, then the text. Size and offset
  are a canvas transform about the paragraph's centre around that text pass, so
  they reach the rectangle, the bubble mask and the ellipse alike. The room and
  the neighbours are still measured from the answer as it came, so correcting
  one paragraph does not move another. Colour and hiding need none of this and
  leave the layout alone.
- **Edits live on the answer** (`LensResult.edits`). The response cache holds
  the same object, so a toggle or a settings redraw keeps them; `putEdits`
  writes them into the stored record the answer came from - the key it was
  *found* under, which for a likeness hit is the other picture's, so an edit
  made on a thumbnail follows it to the original. The render key gains
  `editsTag`, empty without edits, so nothing cached before them misses.
- **A copy is asked for during the press.** `ClipboardItem` gets the picture
  as a promise, because the clipboard is granted only while the gesture is being
  handled and downscaling to the picture's own size (the cover is supersampled)
  takes longer. Refused - an older Firefox, most phones - it is saved instead
  and the message says so. Saving uses the share sheet on a touch screen, where
  the gallery and the messengers are, and a download elsewhere.

The menu offers edit, copy and save only on a picture that has a drawing; three
greyed-out entries on every untranslated picture would be noise. The DOM
renderer has no picture to copy and no editor.

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

`bun test` covers what can be checked without a page: the protobuf codec, URL
normalisation and the cache budget, tiling a long strip and its seams
(`test/tiles.test.ts`), bubbles on synthetic pictures
(`test/bubble.test.ts`), the layout maths (`test/layout.test.ts`,
partly ported from `chrome-lens-py/tests/test_units.py` - and the rotated
punctuation set is compared with the Python one when the sibling checkout is
there), background geometry, the IndexedDB store, `gm.ts`, the per-site rules,
the settings schema and import (`test/settings.test.ts`), the button list and
key chords (`test/controls.test.ts`), the settings preview's sample answer and
the schematics (`test/preview.test.ts`), the editor's edits as data
(`test/edits.test.ts`) and the locales (`test/i18n.test.ts`).

- `test/setup.ts` stands in for the page with a ruler anyone can do in their
  head (a Latin glyph is half an em, a CJK one a full em, the font box one em
  tall). The layout maths promises a relationship between measurements and the
  size chosen, not what a browser's metrics are. `layout.ts` makes its measuring
  context on first use so importing it needs no DOM.
- A module that imports `$` is tested by replacing `$` with
  `mock.module('$', ...)` and importing a **fresh copy** of the module under a
  query string (`import('../src/gm.ts?host=1')`):
  `vite-plugin-monkey` captures the host's globals when the bundle starts, so a
  different host needs a different evaluation. The shapes that matter are
  Tampermonkey (typed array in, ArrayBuffer out), AdGuard (string only in, text
  out, no menu), a host with only the GM4 `GM.xmlHttpRequest`, one with
  promise-only storage, and one with no transport at all. A body covering all
  256 byte values is what catches a lossy path.
- A test that swaps `globalThis.document` must put it back: the other files'
  tests run in the same process.
- `fake-indexeddb` runs `store.ts` for real, including the upgrade from a
  version 1 database built by hand.

Rendering, the cover and anything that depends on layout are verified in a real,
**painting** browser against a recorded Lens response: build a page that inlines
`dist/lens-translate.user.js`, shim the `GM_*` functions, answer
`GM_xmlhttpRequest` for `crupload` with a response built by `src/protobuf.ts`'s
`writer()` and the field table (two paragraphs, three lines is enough), and drive
the script through a real hover and click. `puppeteer-core` against the
installed Chrome in headless mode paints, which an embedded preview pane that is
hidden does not - there `requestAnimationFrame`, `ResizeObserver` and
`IntersectionObserver` never fire and a cover looks as if it never goes. Past
sessions have used this to confirm alignment to the pixel, zero framework
reverts, cache hits, the hold-to-peek and batch paths, and the per-site rules.
For geometry, screenshot the original, hide it, put the cover over it and
compare the two images: a cover that is a pixel out shows immediately, and what
remains should be antialiasing along half-pixel edges.

Two traps that produced false passes:

- A `data:` image is same-origin, so it never exercises the tainted-canvas path.
  Use a cross-origin URL to test that branch.
- Measure after the page has actually laid out. A hidden preview pane returns
  zeroes from `getBoundingClientRect` for everything, which looks exactly like a
  positioning bug.

If you change the request builder, the strongest check is to serialize a request
in JS and parse it with Python's `protobuf` library in the sibling project — it
catches a wrong field number immediately.

If you change the engine's surface, verify it the way a consumer would rather
than from inside this repo, where every import resolves whether or not the
package says it should. Build `src/engine.ts` as its own entry, then drive it
from a page that supplies its own transport, its own `ignoreElements` predicate
and its own root: what that proves is that the engine works with none of this
script's UI on the page at all, which no test run through `main.ts` can show.

The packaging is its own question and has its own trap: shipping raw TypeScript
through the `exports` map works, but only a real consumer proves it. Copy the
repo's `src/` and `package.json` into a throwaway project's
`node_modules/lens-translate-userscript/`, which is what a git dependency
materialises, and run that project's own `tsc --noEmit` and `vite build`. The
bundle it produces should contain no `GM_`, no `unsafeWindow` and no
`lens-translate-root`; grep for them, because a passing build only proves the
imports resolved.
