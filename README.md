# Lens Translate

Hover any image, click the button, and the text inside it is translated **in place** — rendered the way Chromium's own Google Lens overlay does it: the original text is erased with the server's inpainted background patch, and the translation is drawn over it in the original colours, at the original angle, sized to fit the original line.

No server, no extension, no account. TypeScript, built with Vite.

## Install

[**Install the userscript**](https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.user.js) — Tampermonkey and Violentmonkey pick it up straight from the repo.

**AdGuard** (Windows, Mac, Android) runs userscripts too: **Settings → Extensions → Add extension**, then paste that same raw URL. Nothing else differs, with one exception noted below.

Every version is also tagged, so `raw/v2.5.0/dist/lens-translate.user.js` is a
working script forever where `main` is only ever the latest one - worth knowing
if an update ever goes wrong on you. Update checks read
[`dist/lens-translate.meta.js`](https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.meta.js),
the same header with no code in it, so a manager polling for a new version does
not download the whole script to find out there is not one.

Or build it yourself:

```bash
bun install
bun run build
```

Alt+click an image, or use the button that appears when you hover one. Click again to undo. **On a touch screen there is no hover**, and the tap that would summon the button is the same tap a reader uses to turn the page - so there the button is pinned instead, sitting over whichever image fills most of the viewport and following the scroll. **When to show it** in settings forces either behaviour. Settings live in the userscript manager's menu under **Lens Translate: settings** — or, since AdGuard has no such menu, behind the gear that appears next to the hover button. Every command below is in that panel under **Actions** as well as in the menu, so every host can reach all of them.

## What you can do

| | how |
|---|---|
| Translate one image | Alt+click it (the modifier is a setting), or the button on hover; tap the pinned button on a touch screen |
| Undo it | the button again |
| **See the original** while looking | **hold the button** for a third of a second - the translation steps aside and comes back when you let go. On a touch screen a long press does the same |
| See every original at once | hold a key: backtick, Shift or Ctrl, chosen under **Hold to see the original** (off by default) |
| **Translate everything in view** | **Alt+Shift+T**, or *Translate all in view* in the menu and the panel. Two at a time, one summary at the end. Ignored while you are typing in a field; the chord is a setting |
| **Copy the translation** or **the original text** | the small `...` button next to the gear (it appears with it), or right-click the main button. The original is whatever Lens could read, including text it could not translate |
| Switch it off on one site | *Toggle for this site* - the button disappears, Alt+click is the page's again and any translations come down |
| **Translate as you read** on one site | *Toggle auto-translate here* - every picture that scrolls into view is translated by itself, once: one that had no text is not asked about again, and one you undid stays undone |
| Clear the cache, undo a whole page, switch everything off, run diagnostics | the menu, or **Actions** in the panel |

The per-site choice is per hostname (`www.` is the same site as the bare name) and is kept in the userscript manager's own storage, not the site's.

Backgrounds work too, with a catch: a CSS `background-image` is only offered when it is painted once. A texture tiled behind the page, a sprite, an icon on a button are all `background-image` and none has text to translate, so a repeating background counts only when its size always fills the box (`cover`, or an explicit size at least as big), and one smaller than **Ignore images under** is ignored. The translation is laid where the browser painted the picture - honouring `background-size`, `-position`, `-origin` and `-clip` - and a layout it cannot follow (tiled, fixed to the viewport, clipped to text) is refused rather than guessed at. The `overlay` renderer cannot follow a background and says so.

### What differs between hosts

Four things, and all of them are handled by the script rather than by the reader:

- **The userscript menu may not exist.** `GM_registerMenuCommand` is absent from [AdGuard's documented API](https://adguard.com/kb/general/userscripts/) and missing from some builds, though 1.2.7 does have it. Nothing here name-checks a version: the commands are registered with the host when it takes them and drawn in the settings panel regardless.
- **Binary bodies are not portable.** Every host implements `GM_xmlhttpRequest`, but none documents which shapes of request body it marshals, and AdGuard has [been loose about `responseType`](https://github.com/AdguardTeam/CoreLibs/issues/1983). The request is sent as a typed array first; a `400`, which is exactly what a mangled protobuf produces, buys one retry as a binary string, and whichever shape returns `200` is used from then on. Responses are read as an ArrayBuffer, a Blob, or `charset=x-user-defined` text, whichever the host produced.
- **A host's transport can fail outright.** On AdGuard for Android it did: `GM_xmlhttpRequest` reported a network error without the request ever leaving the device. So under the two rungs above there is a third — a plain `fetch`. The Lens endpoint answers a CORS preflight (`POST`, `content-type`, `x-goog-api-key`, any origin), so a page-context request reaches it. It is last rather than first because it is the leakier path: the browser attaches an `Origin` header that cannot be removed, telling Google which site the image came from, where `GM_xmlhttpRequest` sends none. Whichever rung answers is remembered, so the dead ones are tried once per page and not again.

An image host is different: there `fetch` is blocked by the very CORS that `GM_xmlhttpRequest` exists to dodge, so that path never remembers a transport and always tries the host's own first.

- **Storage may only be asynchronous.** Tampermonkey, Violentmonkey and AdGuard have `GM_getValue`/`GM_setValue`. Greasemonkey 4 and Safari's Userscripts publish only `GM.getValue`/`GM.setValue`, which return promises, so there is no reading a setting synchronously. Those values are loaded once at startup and the script reapplies them when they arrive (for a few milliseconds it runs on the defaults); writes go to the host straight away. Only a host with neither falls back to `localStorage`, which on AdGuard is the *page's* — so settings would then be per-site — and that is now the last resort rather than what Safari quietly got.

## When it does not work

A userscript on a phone fails quietly. There is no console to open, the host
reports one word for every kind of network failure, and "network error" covers a
transport that never sent the request, a domain the device is blocking, and a
phone that is simply offline. Four things, cheapest first.

### 1. Run the diagnostics

**Put `#lens-debug` on the end of the URL** and the report opens. It needs no
button and no menu, which is the point: the hover button is exactly what is
missing when something is wrong, and `GM_registerMenuCommand` has nowhere to
appear on a phone at all - no mobile browser has a userscript menu, whatever
the host reports. The report carries a **Settings** button too, so the panel is
reachable when the gear is not.

It is also in **Settings → Actions → Run diagnostics**, and in the userscript
menu on a host that has one. It reports what host is running the script and what it grants, then probes
the Lens endpoint and a control host through both transports:

```
host: AdGuard 4.9.16
script: 2.2.0
context: page (AdGuard-style)
xmlhttpRequest: yes, getValue: yes, setValue: yes, registerMenuCommand: NO
page: https://example.com

gm -> lens       via AdGuard: network error, 12 ms
fetch -> lens    HTTP 404, 210 ms
gm -> control    HTTP 204, 180 ms
fetch -> control HTTP 204, 160 ms
```

A `HTTP` of any kind means the request left the device and came back. That is
exactly what "network error" cannot tell you, and two things had to be right
before it could be trusted:

- **The probe sends the real request**, not a convenient `GET`. A `GET` to the
  Lens endpoint is answered `404` with no CORS headers at all, so a page `fetch`
  cannot read it and reports the same `Failed to fetch` a blocked domain would.
  The real `POST` comes back with `Access-Control-Allow-Origin` set.
- **A status is an answer wherever it arrives.** AdGuard routes every non-2xx
  through `onerror` rather than `onload`, so a plain `404` looks like a network
  failure unless the status is read off it.

The last line reads the four results:

- **Lens answers one way but not the other** — that host's transport is broken,
  and the script is already working around it.
- **Lens answers neither way, the control does** — this device is blocking
  `lensfrontend-pa.googleapis.com`. Search the AdGuard activity log for
  `googleapis`, and check DNS filtering and the HTTPS filtering exclusions.
- **Nothing answers** — no working connection from this page.

**Copy** puts the whole report on the clipboard, which is the useful thing to
attach to a bug report.

### 2. Real DevTools, over USB

Anything past the transport needs the browser's own console, and on Android it
is one cable away:

1. On the phone: **Settings → About phone**, tap **Build number** seven times,
   then **Developer options → USB debugging**.
2. Plug it into a computer and accept the prompt.
3. In desktop Chrome open `chrome://inspect/#devices`, find the tab, press
   **inspect**. That is a full DevTools — Console, Network, the lot — attached
   to the page on the phone.

Which context the errors land in depends on the host, and the diagnostics report
says which: `context: page` means the ordinary console has them, `sandbox` means
the console's context dropdown does. AdGuard has shipped both.

The Network tab settles the question the diagnostics can only infer: whether the
`POST` to `crupload` left at all, and what it came back with.

### 3. A console on the page itself

No cable, when a report is not enough. AdGuard documents no debugging of its
own - `GM_log` and nothing else - so what people do on Android is install a
second userscript that loads [eruda](https://github.com/liriliri/eruda) and
gives the page a real console, network log and DOM inspector as a floating
button. There is [a gist written for exactly this](https://gist.github.com/jasonsyoung/2661ab375efda4301fc6c1016abfdaaa),
and [Andure](https://github.com/leohku/andure) does the same through AdGuard's
HTTPS filtering, opening on a shake of the phone. Any host that runs this
script runs those.

### 4. What the host thinks it did

AdGuard's **Recent activity** is a DNS log, so a domain missing from it means no
lookup happened, which means nothing was sent — that is how the AdGuard
transport failure here was found. It is not an HTTP log, so a domain *present*
in it does not prove the request succeeded.

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
3. **Font size is a binary search over 3..150px** (of the picture's own pixels - the cap scales with **Render sharpness**, so a 2x canvas allows 300), testing `measureText().width` against the box width and `fontBoundingBoxAscent + fontBoundingBoxDescent` against the box height — the font's bounding box, not the ink extents of these particular glyphs.
4. **The background patch is larger than the line box.** Its paddings are fractions of the line *height*; the horizontal one is divided by the image aspect ratio to become a fraction of width.

Word offsets index the translation by **UTF-16 code unit**, which is what `icu::UnicodeString` uses on the server — and conveniently exactly how JavaScript indexes strings, so `String.prototype.slice` is already correct here.

**Re-wrap horizontal text** lifts rule 1 on purpose. Chromium repeats the
detected layout line for line, which is faithful and leaves the spacing between
them out of your hands - a speech bubble is really one text area, so the setting
lays the paragraph out again inside it, mends any word the server split across
its own lines, and makes **Line spacing** mean something.

Vertical CJK gets a fifth rule of its own: setting a Russian translation vertically is faithful to the source and miserable to read, so the `verticalText` setting defaults to `auto` and keeps the column only when the target language is itself CJK. Where a column is kept, dashes and brackets (the long-vowel mark, parentheses, corner brackets) turn a quarter turn, as vertical typesetting has them, and kuten/touten hang in the upper right of their cell. Right-to-left targets are set right-to-left whether or not the paragraph was re-wrapped.

## Which images, and how they are read

Detection finds `<img>`, `<canvas>` and `<video>` elements and CSS `background-image`s (see above for which of those count), by walking `event.composedPath()` so pictures inside a site's own shadow DOM are caught too, and anything a page inserts long after it has finished loading - which on a lot of sites is every picture on it. A picture qualifies when its **rendered** size — not its natural size — is at least `minImageSize` on both axes, so a 4000px asset scaled down to a 20px icon is correctly ignored. A canvas and a video are the one limited case: they have no address, so they are never cached, and if the page drew them from another origin they cannot be read at all. Not covered: `<svg>` drawn as markup rather than an image.

**The script does not run inside iframes** (`@noframes`). Left to run in every frame it ran inside every advertisement and embed on the page too - a copy of the bundle, an observer and a shadow root each, and a translate button over an advert. The price is a reader that lives in an iframe of its own: open the frame's address directly, or use a manager that lets you opt a script in per site.

A translation goes when its picture does. A virtualised feed reuses an `<img>` for the next post by assigning a new `src`, and a translation left behind would sit on top of a different photograph; so the covered element is watched, and a changed address (not a different *rendition* of the same one, which Twitter does as the layout moves) takes the translation down, as does the element leaving the page. The memory a long scroll would otherwise accumulate - the element, the bitmap, its object URL - is released the same way, with a periodic sweep as the backstop.

Reading the pixels has three ways in, cheapest first:

1. **The element as it stands.** The browser has already downloaded and decoded it, so this costs no network request at all. Works for same-origin images.
2. **The same URL re-requested with `crossOrigin`.** A plain `<img>` is not *requested* with CORS, so drawing it taints the canvas even when the host would have allowed it — and most image hosts, `pbs.twimg.com` included, send `Access-Control-Allow-Origin: *`. Asking again with CORS usually comes straight out of the HTTP cache.
3. **`GM_xmlhttpRequest`.** Only for hosts that send no CORS headers at all. This is the one that needs `@connect *`, and it is rarely reached. It goes out as the browser's own request for the image would have: with the page as `Referer` and with cookies, because hotlink-protected hosts (pixiv's image host, most manga CDNs) answer `403` to anything else. That is the one request in this script that tells a third party which page you are on - and it is the same thing the `<img>` already told them.

If step 3 does get reached and fails, the message names the host: Tampermonkey blocks a domain permanently once refused, and it is cleared under Tampermonkey → Settings → Security → Blocked domains.

Uploads use Chromium's own budget: JPEG quality 40, and a resize only when the image is both over 1.5 MP and over 1600px on a side.

## Erasing the original

Two ways, chosen in settings:

- **`patch`** — the server's inpainted patches, what Chromium does. Faithful,
  but it erases glyphs while keeping their anti-aliased edges, and on a page of
  vertical text that residue reads as streaks the full height of a bubble.
- **`hull`** — cover the convex hull of every line box with the line's
  background colour. The paragraph's bounding box is the wrong shape for this:
  for columns at an angle, or ragged lines, a rectangle takes in far more than
  the text and an ellipse inscribed in it takes in too little at the corners.
  The hull of the line-box corners is exactly the text's extent, whatever
  arrangement the lines are in.

`hull` only makes sense where the background is flat, which inside a speech
bubble it is. **Cover margin** controls how far past the text it extends,
relative to line height; the shape is grown and its corners rounded in one step
by stroking the hull with a round-joined line before filling it.

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

The outline itself has its own slider, up to 8x, with a live sample drawn over
simulated residue — the number alone tells you nothing, since the whole point of
the outline is legibility over what the inpainting leaves behind. The sample
shows both polarities side by side, because the answer differs: a dark bubble
means light text outlined in dark, and a setting tuned on a white page can
swallow the text whole on a black one. 0 removes it.

## Text that would be too small to read

Lens sizes translated text to fit the *original* line box. On a 2400px page shown 600px wide, fine print measured here fitted at 9–13px, which is 2–3px on screen — no more readable than the original was, and that is the complaint.

Two settings address it. **Minimum text size** (default 12 CSS px as displayed) raises anything below the floor, growing its background to match; lines in a dense paragraph would then overlap, so **Keep text out of the next bubble** decides who yields — and it is the size, because text that shrinks is readable while text written across its neighbour is not. The room a paragraph may use is measured against the surrounding paragraphs rather than guessed at, which is what makes **Bubble fill** safe to raise. 0 turns the floor off entirely. **Render sharpness** draws the canvas at 1x/2x/3x the image's natural size, so zooming in or opening the image full size keeps the text crisp rather than smearing.

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

Two levels in memory, sharing one byte budget (32 MB by default, adjustable, 0
disables, clearable from the menu) - one clock too, so whichever entry was used
longest ago goes first, from either:

- **Lens responses**, keyed by the image plus the three language settings. Only
  the response — re-rendering from it is local, so changing a render setting
  takes effect without invalidating anything.
- **Finished renderings**, keyed additionally by everything that changes how it
  looks. A repeat toggle hits this one and costs *nothing*: no pixels fetched,
  no canvas painted, no round trip.

Two details that took measuring to get right:

- The key normalizes the URL. Twitter serves one photo as `?name=small` /
  `medium` / `large` / `orig` and React rewrites `src` between them, so keying
  on the raw URL made every layout change a miss. Only parameters that change
  how many pixels the *same frame* has are dropped (`name`, `format`, `q`,
  `dpr`...), and only when the value looks like that kind of value. `w`, `h`,
  `crop` and `fit` pick which part of the picture, so two crops of one path are
  two pictures; as a second line of defence an entry remembers the proportions
  of the pixels it was made from, and a hit with a different aspect ratio is a
  miss.
- The cache check sits *ahead* of the JPEG encode. Encoding an upload that is
  never sent was the expensive half of a cache hit.

Both die with the page, so a third sits under them: **Remember across reloads**
keeps Lens's answers in IndexedDB, keyed by a fingerprint of the pixels rather
than the URL. Reopening a chapter then costs no uploads and no requests at all,
and the same photo is recognised under a different address - a CDN rendition, a
freshly minted `blob:`. Only the answer is kept; the picture is drawn again
locally, which is milliseconds and no bytes. It is a separate allowance of the
same size - RAM that dies with the page against disk that does not - and an
answer is stored under the picture *and* the languages asked for, so translating
a page into a second language does not forget the first.

**Privacy.** That store is IndexedDB, which is per-origin: what you translated on
a site is kept in that site's origin, where the site's own scripts could read it
(each entry is the recognised text, its translation and the erasing patches -
not the picture). Turn **Remember across reloads** off to keep nothing, or use
*Clear cache*, which empties both levels. Nothing is stored outside the browser.

Eviction is by total bytes rather than entry count, because the weight is
almost entirely the inpainted WebP patches and the rendered PNGs, and those vary
hugely between a two-word sign and a page of manga.

## Turning it off

The commands are **settings**, **clear cache**, **undo all on this page**, **toggle on/off**, **translate all visible images**, **toggle on/off for this site**, **toggle auto-translate for this site**, **diagnostics**, and **copy translation** / **copy original text** (those two act on the picture you last used and are only in the host's menu; the panel's copy buttons are in the `...` menu beside the picture). They sit in the host's userscript menu where there is one, and in the settings panel under **Actions** either way — which is how they are reached on AdGuard, which has no menu. There is also an `enabled` checkbox in settings; with it off, the hover button does nothing and says so.

Hovering an image shows the translate button, and holding the cursor there for another half second brings up the settings and menu buttons next to it.

## Surviving other people's CSS

All UI — button, toast, settings panel and the translation overlay itself — lives in a **shadow root**, not in the page. Injecting with `GM_addStyle` loses on sites that ship rules like `div { display: inline !important }`: page CSS wins on equal specificity when it comes later, and `!important` beats an injected sheet outright. A shadow root is not a specificity contest; page rules cannot reach inside it.

The shadow host is a fixed, full-viewport, click-through layer, which also means everything inside is positioned in viewport coordinates and follows scrolling by re-reading `getBoundingClientRect`, with no page-offset arithmetic.

One subtlety: a shadow root blocks *selectors*, not *inheritance*. Font, colour, direction and line-height still reach in through the host, so the host carries `all: initial !important` — and then has to restate the font, because `initial` for `font-family` is the browser's serif default and an inline `!important` declaration outranks any `:host` rule.

Sites with a strict Content-Security-Policy may still block `blob:` URLs in `background-image`. There is no workaround from inside a userscript.

## Layout

```
proto/               Chromium's Lens .proto files
scripts/gen-fields.ts   descriptors -> typed field-number table
scripts/check-layers.ts the engine may not import the application
src/
  engine.ts          the engine's public entry; see below
  protobuf.ts        minimal wire codec
  types.ts           shared domain types
  transport.ts       the privileged request the engine cannot make itself
  settings.ts        GM-backed settings store
  sites.ts           what each hostname is told: default, off, auto-translate
  gm.ts              every difference between userscript hosts
  image.ts           fetch, downscale, JPEG encode
  detect.ts          what counts as a picture, and where they are
  gen/fields.ts      generated; do not edit
  lens/              request builder, response parser, client, plain-text extraction
  render/            layout maths, canvas painter, DOM overlay, image swap,
                     background geometry, watching a picture for change
  ui/                settings panel, menu, styles
test/                bun test: the codec, the cache, the layout maths, gm.ts
                     against fake hosts, the per-site rules
```

```bash
bun run dev        # live-reload userscript for development
bun run typecheck  # tsc --noEmit, strict
bun run check      # layering: the engine stays clean, the host stays in gm.ts
bun test           # unit tests; no browser needed
bun run build      # typecheck, check, then dist/lens-translate.user.js
```

The tests cover what can be checked without a page: the protobuf codec (round
trips, negative varints, truncated input), URL normalisation and the cache's
budget, the layout maths (ported in part from the Python project's suite), the
background geometry, the IndexedDB store against `fake-indexeddb`, and `gm.ts`
against hosts with synchronous storage, promise-only storage, and neither.
Rendering and the cover are still checked in a real browser; `AGENTS.md` says how.

## Using the engine from another script

Everything under `src/engine.ts` asks Lens and draws the answer, and none of it
knows what a userscript is - no `GM_*`, no settings store, no shadow root, no
button. A second script can install this repo and keep its own front end:

```json
"dependencies": {
  "lens-translate-userscript": "github:bropines/chrome-lens-userscript#v2.12.0"
}
```

It is raw TypeScript, built by whoever imports it, with no runtime dependencies
and no build step of its own. Pin the tag; the engine's surface is not stable
across versions yet.

```ts
import {
  callLens, ignoreElements, prepareImage, renderToBlob, setTransport,
} from 'lens-translate-userscript/engine';
import type {
  LensOptions, RenderOptions, Target, Transport,
} from 'lens-translate-userscript/engine';

// 1. The one thing the engine cannot do for itself: a cross-origin POST to an
//    endpoint that sets no CORS headers for it. In a userscript this wraps
//    GM_xmlhttpRequest - `src/gm.ts` is that implementation, and it is worth
//    reading before writing another, because the encoding retry, the response
//    normalisation and the fallback to a plain fetch are all answers to hosts
//    that behave differently. The Lens endpoint does answer a preflight, so a
//    plain fetch works too wherever an Origin header is acceptable.
const transport: Transport = {
  async post({ url, headers, body, timeoutMs }) {
    const response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
    const bytes = new Uint8Array(await response.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    return { status: response.status, bytes, contentType: 'application/x-protobuf' };
  },
  async get(url, timeoutMs) {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const bytes = new Uint8Array(await response.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    return { status: response.status, bytes, contentType: response.headers.get('content-type') ?? '' };
  },
};
setTransport(transport);

// 2. If the front end draws anything over a picture, say so, or the detector
//    will find it and offer to translate a translation.
ignoreElements((element) => element.hasAttribute('data-my-overlay'));

// 3. Options are split so a caller that wants to draw a picture does not have
//    to invent a value for `hotkey`: LensOptions for what is asked,
//    RenderOptions for how it is drawn, CacheOptions for what is kept.
const lens: LensOptions = { targetLang: 'ru', /* ...and the rest */ };
const draw: RenderOptions = { minReadablePx: 12, /* ...and the rest */ };

async function translate(target: Target): Promise<Blob> {
  const prepared = await prepareImage(target, lens);
  try {
    const result = await callLens(prepared, lens);
    return await renderToBlob(
      prepared.source, prepared.sourceWidth, prepared.sourceHeight, result.blocks, draw
    );
  } finally {
    // The decoded pixels may be an ImageBitmap, which is not garbage collected
    // on its own.
    prepared.release();
  }
}
```

`collect(minSize)` finds the pictures on the page and `targetFromEvent` finds
the one under a pointer; both cross open shadow roots, which `document.images`
does not. `cacheKey` / `getCached` and `getStored` / `putStored` are there if
the front end wants the same two-level cache this one uses, and can be ignored
entirely if it does not.

## For agents

`AGENTS.md` records the architecture and, more usefully, the constraints that
were discovered the hard way — why the renderer is a sibling element, why the
protobuf codec is hand-rolled while the field numbers are not, and which test
setups produce false passes.

## Related

[chrome-lens-py](https://github.com/bropines/chrome-lens-py) is the Python implementation of the same protocol, with the same renderer, a CLI, region queries and a local daemon.

## License

MIT
