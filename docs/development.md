# Development

Building, the source layout, and using the engine from another script.

## Build

```bash
bun install
bun run build
```

## Layout

```
proto/               Chromium's Lens .proto files
scripts/gen-fields.ts   descriptors -> typed field-number table
scripts/check-layers.ts the engine may not import the application
scripts/locales-check.ts every locales/*.json against the English keys
locales/             the interface in other languages; fetched at run time, not bundled
src/
  engine.ts          the engine's public entry; see below
  boot.ts            the userscript's entry: start now, or sleep in a frame
  main.ts            the front end, started once per document that wants it
  frame.ts           when a frame is worth waking
  protobuf.ts        minimal wire codec
  types.ts           shared domain types
  transport.ts       the privileged request the engine cannot make itself
  settings.ts        GM-backed settings store, the field schema, export and import
  state.ts           what was last done: the last action, the last question
  i18n/              English strings by key, and loading the other languages
  sites.ts           what each hostname is told: default, off, auto-translate
  gm.ts              every difference between userscript hosts
  image.ts           fetch, downscale, JPEG encode
  detect.ts          what counts as a picture, and where they are
  gen/fields.ts      generated; do not edit
  lens/              request builder, response parser, client, plain-text extraction
  render/            layout maths, canvas painter, DOM overlay, image swap,
                     background geometry, watching a picture for change
  ui/                settings window, menu, the button list and key chords, styles
test/                bun test: the codec, the cache, the layout maths, gm.ts
                     against fake hosts, the per-site rules, the settings
                     schema and import, the locales
```

```bash
bun run dev        # live-reload userscript for development
bun run typecheck  # tsc --noEmit, strict
bun run check      # layering: the engine stays clean, the host stays in gm.ts
bun test           # unit tests; no browser needed
bun run locales:check  # every locale has exactly the English keys and placeholders
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
