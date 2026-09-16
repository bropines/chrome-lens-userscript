# Lens Translate — userscript

Alt+click any image on any page to translate the text inside it **in place**, rendered the way Chromium's own Google Lens overlay does it: the original text is erased with the server's inpainted background patch, and the translation is drawn over it in the original colours, at the original angle, sized to fit the original line.

## Requirements

This is a thin client. The protocol work is done by the daemon from
[chrome-lens-py](https://github.com/bropines/chrome-lens-py):

```bash
pip install chrome-lens-py
lens_scan --serve
```

That listens on `http://127.0.0.1:8765` and exposes `POST /v1/ocr`,
`POST /v1/region` and `GET /health`.

Then install `src/lens-translate.user.js` in Tampermonkey.

## Why a daemon instead of calling Google directly

`GM_xmlhttpRequest` is not subject to CORS, so a direct call to
`lensfrontend-pa.googleapis.com` would work. It is deliberately not done that way:

- it would mean a second protobuf implementation, in JavaScript, to keep in sync;
- the API key would be baked into every copy of the script and shared by every
  user of it, which is a good way to get it rate-limited;
- proxy settings, language defaults and font configuration already live in the
  daemon.

Rendering is the opposite case — it genuinely belongs in the browser. Chromium's
reference implementation *is* CSS (`text-shadow`, `writing-mode`,
`transform: rotate`, `measureText`), so this script is a port of it rather than a
reimplementation, and the browser handles bidi, shaping and font fallback for
free. The Python renderer in chrome-lens-py has to do all three by hand.

## Configuration

Edit the constants at the top of the script:

| constant | meaning |
|---|---|
| `DAEMON` | daemon base URL (default `http://127.0.0.1:8765`) |
| `TOKEN` | set if you started the daemon with `--token` |
| `TARGET_LANG` | translation target, e.g. `ru`, `en` |
| `MIN_SIZE` | ignore images smaller than this, to skip icons and spacers |

## How the rendering works

The daemon returns `translation_render_data`: per paragraph, the full translated
string plus, per line, the character ranges of each word, the foreground and
background colours as aRGB, the geometry borrowed from the *detected* line, and
the inpainted background patch as base64 WebP.

Four details are easy to get wrong and are the reason this matches Chromium:

1. **No word wrap.** One translated line is one rendered line, scaled down by
   font size until it fits. Wrapping never matches.
2. **The box comes from the original detected line.** The server sends no
   geometry for translated text at all.
3. **Font size is a binary search over 3..150px**, testing
   `measureText().width` against the box width and
   `fontBoundingBoxAscent + fontBoundingBoxDescent` against the box height — the
   font's bounding box, not the ink extents of these particular glyphs.
4. **The background patch is larger than the line box.** Its paddings are
   fractions of the line *height*; the horizontal one is divided by the image
   aspect ratio to turn it into a fraction of width.

Word offsets index the translation by **UTF-16 code unit**, which is what
`icu::UnicodeString` uses on the server — and, conveniently, exactly how
JavaScript strings are indexed, so `String.prototype.slice` is already correct
here. (The Python port has to encode to UTF-16 explicitly.)

## Cross-origin images

Image bytes are fetched with `GM_xmlhttpRequest` rather than read off the `<img>`
element. A cross-origin image without CORS headers taints the canvas, and
`toDataURL` then throws `SecurityError`. Fetching the bytes ourselves sidesteps
it entirely.

Some sites with a strict Content-Security-Policy may still block `data:` URLs in
`background-image`. There is no workaround from inside a userscript.

## Demo / render check

`demo/build_render_check.py` asks a running daemon to process an image, then
generates a standalone HTML page that runs the userscript's real rendering code
against the real response. Useful for verifying a rendering change without
installing anything:

```bash
python demo/build_render_check.py            # writes userscript_check.html
python -m http.server 8080                   # then open the page
```

It must be served over HTTP, not opened as a `file://` URL.

## License

MIT
