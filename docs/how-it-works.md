# How it works

How the script talks to Lens, draws the answer and keeps it. For the constraints behind each choice, see [AGENTS.md](../AGENTS.md).

## How it talks to Lens

Directly. `GM_xmlhttpRequest` runs in the extension's context and is not subject to CORS, so the script posts protobuf straight to `lensfrontend-pa.googleapis.com/v1/crupload` — the same endpoint Chrome's Lens overlay uses.

The only awkward part is protobuf, and that is handled by about 130 lines in [`src/protobuf.ts`](../src/protobuf.ts). A real protobuf runtime was measured against it:

| | raw | gzip |
|---|---|---|
| `@bufbuild/protobuf` + generated code, protobuf layer alone | 160.6 kB | 33.8 kB |
| hand-rolled codec, **entire script** | 40.3 kB | 11.4 kB |

The descriptors a generated runtime needs cannot be tree-shaken, and this script parses on every page load, so the hand-rolled codec wins clearly here.

What it does *not* do is hard-code field numbers. Chromium's `.proto` files live in [`proto/`](../proto/), and `bun run gen` compiles them and distils them into a typed table of field numbers at [`src/gen/fields.ts`](../src/gen/fields.ts). The bundle gets the numbers without the runtime, and re-syncing after Chromium changes its protos is one command.

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
its own lines, and makes **Line spacing** mean something. It has three values.
`auto`, the default, re-wraps only a paragraph that looks like a bubble - three
or more short lines, stacked and centred - and only when its translation cannot
be set line by line at a readable size; screenshots, signs and single lines are
left as Chromium has them. `on` re-wraps everything, `off` nothing.

Vertical CJK gets a fifth rule of its own: setting a Russian translation vertically is faithful to the source and miserable to read, so the `verticalText` setting defaults to `auto` and keeps the column only when the target language is itself CJK. Where a column is kept, dashes and brackets (the long-vowel mark, parentheses, corner brackets) turn a quarter turn, as vertical typesetting has them, and kuten/touten hang in the upper right of their cell. Right-to-left targets are set right-to-left whether or not the paragraph was re-wrapped.

## Which images, and how they are read

Detection finds `<img>`, `<canvas>` and `<video>` elements and CSS `background-image`s (see above for which of those count), by walking `event.composedPath()` so pictures inside a site's own shadow DOM are caught too, and anything a page inserts long after it has finished loading - which on a lot of sites is every picture on it. A picture qualifies when its **rendered** size — not its natural size — is at least `minImageSize` on both axes, so a 4000px asset scaled down to a 20px icon is correctly ignored. A canvas and a video are the one limited case: they have no address, so they are never cached, and if the page drew them from another origin they cannot be read at all. Not covered: `<svg>` drawn as markup rather than an image.

**Inside iframes the script sleeps until there is a picture.** It used to skip frames altogether (`@noframes`), because running in every frame meant running inside every advertisement and embed on the page - a copy of the bundle, an observer and a shadow root each, and a translate button over an advert - and that left a reader or gallery that shows its pages in an iframe with no button at all. Now a frame starts dormant: no UI, no observer, no timers, no hotkeys, just three listeners that each look at one element. It wakes only when the frame itself is at least 400x300 CSS px *and* holds a picture that passes the usual size test, or the pointer goes over one in a frame that size. Every standard ad slot (300x250, 728x90, 970x250, 300x600 and the rest) is narrower or shorter than that, so ads never wake. **Work inside frames** in settings turns it off; a site switched off applies to frames by the frame's own hostname, and to frames on a switched-off page where the browser lets a frame know which page it is on (Chromium and Safari do; Firefox often does not). A woken frame keeps out of the userscript menu and does not answer `#lens-debug` - those belong to the tab. A frame sandboxed without popups cannot open a results tab at all, so there the address is shown with a **Copy** button.

A translation goes when its picture does. A virtualised feed reuses an `<img>` for the next post by assigning a new `src`, and a translation left behind would sit on top of a different photograph; so the covered element is watched, and a changed address (not a different *rendition* of the same one, which Twitter does as the layout moves) takes the translation down, as does the element leaving the page. The memory a long scroll would otherwise accumulate - the element, the bitmap, its object URL - is released the same way, with a periodic sweep as the backstop.

Reading the pixels has three ways in, cheapest first:

1. **The element as it stands.** The browser has already downloaded and decoded it, so this costs no network request at all. Works for same-origin images.
2. **The same URL re-requested with `crossOrigin`.** A plain `<img>` is not *requested* with CORS, so drawing it taints the canvas even when the host would have allowed it — and most image hosts, `pbs.twimg.com` included, send `Access-Control-Allow-Origin: *`. Asking again with CORS usually comes straight out of the HTTP cache.
3. **`GM_xmlhttpRequest`.** Only for hosts that send no CORS headers at all. This is the one that needs `@connect *`, and it is rarely reached. It goes out as the browser's own request for the image would have: with the page as `Referer` and with cookies, because hotlink-protected hosts (pixiv's image host, most manga CDNs) answer `403` to anything else. That is the one request in this script that tells a third party which page you are on - and it is the same thing the `<img>` already told them.

If step 3 does get reached and fails, the message names the host: Tampermonkey blocks a domain permanently once refused, and it is cleared under Tampermonkey → Settings → Security → Blocked domains.

Uploads use Chromium's own budget: JPEG quality 40, and a resize only when the image is both over 1.5 MP and over 1600px on a side. A picture far longer than it is wide - a webtoon strip, a panorama - would be unreadable at that size, so it is sent in up to twelve overlapping parts and the answers are joined; one translation is then several requests. *Long pictures* in the Advanced settings turns that off.

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

Speech bubbles are handled without it, too. Lens reports a bubble as a column
of two-word lines, and a longer translation set line by line either shrinks to
nothing or, once the size floor raises it, is drawn through its own neighbours.
Such a paragraph is re-wrapped as one text area, and the area is the bubble
itself: its outline is read from the picture, by filling outwards from the text
over the bubble's own colour until the line that encloses it, and each line of
the translation is made as wide as the bubble is at that height. Where no
outline can be found - text over artwork, an open bubble - an ellipse stands in.
**Fit text to the bubble's shape** turns the reading off and leaves a rectangle.
Vertical text that is re-set horizontally gets the same shape, and manga mode
extends the treatment to two-line bubbles.

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

It also knows a picture at another size. A thumbnail answered yesterday and the
original opened today share no address, no size and no byte; the store compares
a small grey copy of each and then every line of text the answer read, cut from
both pictures where it was found. Only when the text agrees is the answer drawn
again, and an answer made from a much smaller picture is not used for a much
larger one. What it cannot see is text added that the first answer never read,
if that text is under about 1% of the picture.

**Privacy.** That store is IndexedDB, which is per-origin: what you translated on
a site is kept in that site's origin, where the site's own scripts could read it
(each entry is the recognised text, its translation and the erasing patches -
not the picture). Turn **Remember across reloads** off to keep nothing, or use
*Clear cache*, which empties both levels. Nothing is stored outside the browser.

Eviction is by total bytes rather than entry count, because the weight is
almost entirely the inpainted WebP patches and the rendered PNGs, and those vary
hugely between a two-word sign and a page of manga.

## Surviving other people's CSS

All UI — button, toast, settings panel and the translation overlay itself — lives in a **shadow root**, not in the page. Injecting with `GM_addStyle` loses on sites that ship rules like `div { display: inline !important }`: page CSS wins on equal specificity when it comes later, and `!important` beats an injected sheet outright. A shadow root is not a specificity contest; page rules cannot reach inside it.

The shadow host is a fixed, full-viewport, click-through layer, which also means everything inside is positioned in viewport coordinates and follows scrolling by re-reading `getBoundingClientRect`, with no page-offset arithmetic.

One subtlety: a shadow root blocks *selectors*, not *inheritance*. Font, colour, direction and line-height still reach in through the host, so the host carries `all: initial !important` — and then has to restate the font, because `initial` for `font-family` is the browser's serif default and an inline `!important` declaration outranks any `:host` rule.

Sites with a strict Content-Security-Policy may still block `blob:` URLs in `background-image`. There is no workaround from inside a userscript.
