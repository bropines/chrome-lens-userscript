// ==UserScript==
// @name         Lens Translate (chrome-lens-py)
// @namespace    https://github.com/bropines/chrome-lens-py
// @version      1.0.0
// @description  Alt+click any image to translate its text in place, rendered the way Chromium's Lens overlay does.
// @author       bropines
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

/*
 * Talks to the local daemon:  lens_scan --serve
 *
 * Why a daemon rather than calling Google directly: GM_xmlhttpRequest is not
 * subject to CORS, so a direct call would work, but it would mean a second
 * protobuf implementation in JavaScript plus a shared API key baked into every
 * copy of the script. The daemon already owns the protocol, the proxy config
 * and the key.
 *
 * Rendering, though, is genuinely better here than in Pillow: the reference
 * implementation is CSS, so this is a port rather than a reimplementation, and
 * the browser handles bidi, shaping and font fallback for free.
 */

(function () {
  'use strict';

  const DAEMON = 'http://127.0.0.1:8765';
  const TOKEN = '';                 // set if the daemon runs with --token
  const TARGET_LANG = 'ru';
  const MIN_SIZE = 80;              // ignore icons and spacers

  // Chromium's own bounds, from text_layer.ts.
  const MIN_FONT_SIZE = 3;
  const MAX_FONT_SIZE = 150;
  const OUTLINE_RATIO = 0.02;

  GM_addStyle(`
    .clp-wrap { position: relative !important; display: inline-block; }
    .clp-layer { position: absolute; inset: 0; pointer-events: none; z-index: 2147483000; overflow: hidden; }
    .clp-bg { position: absolute; }
    .clp-line {
      position: absolute; display: flex; align-items: center;
      white-space: pre; line-height: 1; transform-origin: center center;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .clp-badge {
      position: absolute; top: 4px; left: 4px; z-index: 2147483001;
      background: rgba(0,0,0,.75); color: #fff; font: 12px/1.4 system-ui, sans-serif;
      padding: 2px 8px; border-radius: 10px; pointer-events: none;
    }
  `);

  const request = (path, body) =>
    new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: DAEMON + path,
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}
        ),
        data: JSON.stringify(body),
        timeout: 90000,
        onload: (r) => {
          try {
            const parsed = JSON.parse(r.responseText);
            r.status === 200 ? resolve(parsed) : reject(new Error(parsed.error || r.status));
          } catch (e) {
            reject(new Error('Bad response from daemon: ' + r.responseText.slice(0, 120)));
          }
        },
        onerror: () => reject(new Error('Daemon unreachable. Run: lens_scan --serve')),
        ontimeout: () => reject(new Error('Daemon timed out')),
      });
    });

  // Fetch the bytes through GM_xmlhttpRequest rather than letting the canvas
  // read the <img> directly: a cross-origin image taints the canvas and
  // toDataURL then throws SecurityError.
  const fetchImageBytes = (url) =>
    new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        onload: (r) => {
          const bytes = new Uint8Array(r.response);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          }
          resolve(btoa(binary));
        },
        onerror: () => reject(new Error('Could not fetch image bytes')),
      });
    });

  const argb = (v) => {
    const a = ((v >>> 24) & 0xff) / 255;
    return `rgba(${(v >> 16) & 0xff}, ${(v >> 8) & 0xff}, ${v & 0xff}, ${a})`;
  };

  // calculateFontSizePixels(), using the same canvas measureText the browser
  // implementation uses.
  const measureCtx = document.createElement('canvas').getContext('2d');
  function fitFontSize(text, boxW, boxH, fontFamily) {
    let low = MIN_FONT_SIZE;
    let high = MAX_FONT_SIZE;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      measureCtx.font = `${mid}px ${fontFamily}`;
      const m = measureCtx.measureText(text);
      const h = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
      if (m.width >= boxW || h >= boxH) high = mid - 1;
      else low = mid + 1;
    }
    return Math.max(MIN_FONT_SIZE, Math.min(low - 1, MAX_FONT_SIZE));
  }

  function u16Slice(text, start, end) {
    return start >= end ? '' : text.slice(start, end); // JS strings are UTF-16
  }

  function buildLineText(translation, line, nextLine) {
    const words = line.words || [];
    let out = '';
    words.forEach(([s, e], i) => {
      out += u16Slice(translation, s, e);
      if (i < words.length - 1) out += u16Slice(translation, e, words[i + 1][0]);
      else if (nextLine && nextLine.words && nextLine.words.length)
        out += u16Slice(translation, e, nextLine.words[0][0]);
    });
    return out;
  }

  function renderBlocks(img, blocks) {
    const pct = (v) => (v * 100).toFixed(4) + '%';
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    const aspect = img.naturalWidth / img.naturalHeight;

    const wrap = document.createElement('span');
    wrap.className = 'clp-wrap';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);

    const layer = document.createElement('div');
    layer.className = 'clp-layer';
    wrap.appendChild(layer);

    for (const block of blocks) {
      const rtl = block.writing_direction === 'WRITING_DIRECTION_RIGHT_TO_LEFT';
      const vertical = block.writing_direction === 'WRITING_DIRECTION_TOP_TO_BOTTOM';
      const justify =
        { DEFAULT_LEFT_ALIGNED: 'flex-start', RIGHT_ALIGNED: 'flex-end', CENTER_ALIGNED: 'center' }[
          block.alignment
        ] || 'center';

      block.lines.forEach((line, i) => {
        const g = line.geometry;
        if (!g) return;
        const bg = line.background_image;

        if (bg) {
          // Paddings are fractions of the LINE HEIGHT; the horizontal one is
          // divided by the image aspect ratio to become a fraction of width.
          const padW = (bg.horizontal_padding * g.height) / aspect;
          const padH = bg.vertical_padding * g.height;
          const el = document.createElement('img');
          el.className = 'clp-bg';
          el.src = 'data:image/webp;base64,' + bg.bytes;
          el.style.cssText =
            `width:${pct(g.width + padW)};height:${pct(g.height + padH)};` +
            `left:${pct(g.center_x - g.width / 2 - padW / 2)};` +
            `top:${pct(g.center_y - g.height / 2 - padH / 2)};` +
            `transform:rotate(${g.angle_deg}deg)`;
          layer.appendChild(el);
        }

        const text = buildLineText(block.translation, line, block.lines[i + 1]);
        if (!text.trim()) return;

        const boxW = g.width * img.clientWidth;
        const boxH = g.height * img.clientHeight;
        const size = fitFontSize(text, vertical ? boxH : boxW, vertical ? boxW : boxH, family);
        const outline = size * OUTLINE_RATIO;
        const oc = argb(line.background_color_argb);

        const el = document.createElement('div');
        el.className = 'clp-line';
        el.textContent = text;
        el.style.cssText =
          `width:calc(${pct(g.width)} + ${bg ? 0 : 4}px);` +
          `height:calc(${pct(g.height)} + ${bg ? 0 : 2}px);` +
          `left:calc(${pct(g.center_x - g.width / 2)} - ${bg ? 0 : 2}px);` +
          `top:calc(${pct(g.center_y - g.height / 2)} - ${bg ? 0 : 1}px);` +
          `color:${argb(line.text_color_argb)};` +
          `background-color:${bg ? 'transparent' : oc};` +
          `font-size:${size}px;justify-content:${justify};` +
          `direction:${rtl ? 'rtl' : 'ltr'};` +
          `writing-mode:${vertical ? 'vertical-lr' : 'horizontal-tb'};` +
          `transform:rotate(${g.angle_deg}deg);` +
          (bg
            ? `text-shadow:${-outline}px ${outline}px 0 ${oc},${outline}px ${outline}px 0 ${oc},` +
              `${outline}px ${-outline}px 0 ${oc},${-outline}px ${-outline}px 0 ${oc}`
            : '');
        layer.appendChild(el);
      });
    }
    return layer;
  }

  function badge(target, text) {
    const el = document.createElement('div');
    el.className = 'clp-badge';
    el.textContent = text;
    (target.parentNode || document.body).appendChild(el);
    return el;
  }

  async function translateImage(img) {
    if (img.dataset.clpBusy) return;
    img.dataset.clpBusy = '1';
    const note = badge(img, 'Lens: reading…');
    try {
      const b64 = await fetchImageBytes(img.currentSrc || img.src);
      const result = await request('/v1/ocr', {
        image_b64: b64,
        translate_to: TARGET_LANG,
      });
      const blocks = result.translation_render_data || [];
      if (!blocks.length) {
        note.textContent = 'Lens: nothing to translate';
        setTimeout(() => note.remove(), 2500);
        return;
      }
      renderBlocks(img, blocks);
      note.remove();
    } catch (e) {
      note.textContent = 'Lens: ' + e.message;
      note.style.background = 'rgba(160,20,20,.85)';
      setTimeout(() => note.remove(), 6000);
    } finally {
      delete img.dataset.clpBusy;
    }
  }

  document.addEventListener(
    'click',
    (event) => {
      if (!event.altKey) return;
      const img = event.target.closest && event.target.closest('img');
      if (!img || img.naturalWidth < MIN_SIZE || img.naturalHeight < MIN_SIZE) return;
      event.preventDefault();
      event.stopPropagation();
      translateImage(img);
    },
    true
  );
})();
