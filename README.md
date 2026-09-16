# Lens Translate

Hover any image, click the button, and the text inside it is translated **in place** — rendered the way Chromium's own Google Lens overlay does it: the original text is erased with the server's inpainted background patch, and the translation is drawn over it in the original colours, at the original angle, sized to fit the original line.

No server, no extension, no account. TypeScript, built with Vite.

## Install

Grab `dist/lens-translate.user.js` and drop it into Tampermonkey, or build it yourself:

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

## Cross-origin images

Image bytes are fetched with `GM_xmlhttpRequest` rather than read off the `<img>` element. A cross-origin image without CORS headers taints the canvas and `toBlob` then throws `SecurityError`; fetching the bytes ourselves sidesteps it. Uploads are downscaled and JPEG-encoded with Chromium's own budget — quality 40, and a resize only when the image is both over 1.5 MP and over 1600px on a side.

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
  render/            layout maths, DOM overlay
  ui/                settings panel, styles
```

```bash
bun run dev        # live-reload userscript for development
bun run typecheck  # tsc --noEmit, strict
bun run build      # typecheck, then dist/lens-translate.user.js
```

## Related

[chrome-lens-py](https://github.com/bropines/chrome-lens-py) is the Python implementation of the same protocol, with the same renderer, a CLI, region queries and a local daemon.

## License

MIT
