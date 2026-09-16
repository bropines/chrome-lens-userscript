// ==UserScript==
// @name         Lens Translate
// @namespace    https://github.com/bropines/chrome-lens-userscript
// @version      2.0.0
// @author       bropines
// @description  Hover any image, click the button, and its text is translated in place - rendered the way Chromium's own Lens overlay does it.
// @license      MIT
// @icon         https://lens.google.com/favicon.ico
// @homepage     https://github.com/bropines/chrome-lens-userscript
// @homepageURL  https://github.com/bropines/chrome-lens-userscript
// @source       https://github.com/bropines/chrome-lens-userscript.git
// @supportURL   https://github.com/bropines/chrome-lens-userscript/issues
// @downloadURL  https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.user.js
// @updateURL    https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.user.js
// @match        *://*/*
// @connect      lensfrontend-pa.googleapis.com
// @connect      *
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var _GM_getValue = /* @__PURE__ */ (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
  var _GM_registerMenuCommand = /* @__PURE__ */ (() => typeof GM_registerMenuCommand != "undefined" ? GM_registerMenuCommand : void 0)();
  var _GM_setValue = /* @__PURE__ */ (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
  var _GM_xmlhttpRequest = /* @__PURE__ */ (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
  const F = {
    AppliedFilter: {
      filterType: 1,
      translate: 3
    },
    AppliedFilter_Translate: {
      targetLanguage: 1,
      sourceLanguage: 2
    },
    AppliedFilters: {
      filter: 1
    },
    CenterRotatedBox: {
      centerX: 1,
      centerY: 2,
      width: 3,
      height: 4,
      rotationZ: 5
    },
    DeepGleamData: {
      translation: 10
    },
    Geometry: {
      boundingBox: 1
    },
    ImageData: {
      payload: 1,
      imageMetadata: 3
    },
    ImageMetadata: {
      width: 1,
      height: 2
    },
    ImagePayload: {
      imageBytes: 1
    },
    LensOverlayClientContext: {
      platform: 1,
      surface: 2,
      localeContext: 4,
      clientFilters: 17,
      renderingContext: 20
    },
    LensOverlayObjectsRequest: {
      requestContext: 1,
      imageData: 3
    },
    LensOverlayObjectsResponse: {
      text: 3,
      deepGleams: 4
    },
    LensOverlayRequestContext: {
      requestId: 3,
      clientContext: 4
    },
    LensOverlayRequestId: {
      uuid: 1,
      sequenceId: 2,
      imageSequenceId: 3
    },
    LensOverlayServerError: {
      errorType: 1
    },
    LensOverlayServerRequest: {
      objectsRequest: 1
    },
    LensOverlayServerResponse: {
      error: 1,
      objectsResponse: 2
    },
    LocaleContext: {
      language: 1,
      region: 2,
      timeZone: 3
    },
    RenderingContext: {
      renderingEnvironment: 2
    },
    Text: {
      textLayout: 1,
      contentLanguage: 2
    },
    TextLayout: {
      paragraphs: 1
    },
    TextLayout_Line: {
      words: 1,
      geometry: 2
    },
    TextLayout_Paragraph: {
      lines: 2,
      geometry: 3,
      writingDirection: 4
    },
    TextLayout_Word: {
      plainText: 2,
      textSeparator: 3,
      geometry: 4,
      type: 5,
      formulaMetadata: 6
    },
    TextLayout_Word_FormulaMetadata: {
      latex: 1
    },
    TranslationData: {
      status: 1,
      targetLanguage: 2,
      sourceLanguage: 3,
      translation: 4,
      line: 5,
      writingDirection: 7,
      alignment: 8
    },
    TranslationData_BackgroundImageData: {
      backgroundImage: 1,
      verticalPadding: 4,
      horizontalPadding: 5
    },
    TranslationData_Line: {
      style: 3,
      word: 5,
      backgroundImageData: 9
    },
    TranslationData_Line_Word: {
      start: 1,
      end: 2
    },
    TranslationData_Status: {
      code: 1
    },
    TranslationData_TextStyle: {
      textColor: 1,
      backgroundPrimaryColor: 2
    }
  };
  const Wire = {
    Varint: 0,
    Fixed64: 1,
    Length: 2,
    Fixed32: 5
  };
  function encodeVarint(value) {
    let v = BigInt(value);
    const out = [];
    while (v > 127n) {
      out.push(Number(v & 127n) | 128);
      v >>= 7n;
    }
    out.push(Number(v));
    return out;
  }
  function writer() {
    const parts = [];
    const self = {
      raw(bytes2) {
        parts.push(bytes2);
        return self;
      },
      tag(field, wire) {
        return self.raw(encodeVarint(field * 8 + wire));
      },
      int(field, value) {
        if (!value) return self;
        return self.tag(field, Wire.Varint).raw(encodeVarint(value));
      },
      str(field, value) {
        if (!value) return self;
        const bytes2 = new TextEncoder().encode(value);
        return self.tag(field, Wire.Length).raw(encodeVarint(bytes2.length)).raw(bytes2);
      },
      bytes(field, value) {
        if (!value || !value.length) return self;
        return self.tag(field, Wire.Length).raw(encodeVarint(value.length)).raw(value);
      },
      sub(field, build) {
        const inner = writer();
        build(inner);
        const bytes2 = inner.finish();
        if (!bytes2.length) return self;
        return self.tag(field, Wire.Length).raw(encodeVarint(bytes2.length)).raw(bytes2);
      },
      finish() {
        let length = 0;
        for (const part of parts) length += part.length;
        const out = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          out.set(part, offset);
          offset += part.length;
        }
        return out;
      }
    };
    return self;
  }
  function decode(buf) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const out = {};
    let p = 0;
    const readVarint = () => {
      let shift = 0n;
      let result = 0n;
      for (; ; ) {
        const byte = buf[p++];
        if (byte === void 0) throw new Error("Truncated protobuf varint");
        result |= BigInt(byte & 127) << shift;
        if (!(byte & 128)) return result;
        shift += 7n;
      }
    };
    while (p < buf.length) {
      const key = Number(readVarint());
      const field = key >> 3;
      const wire = key & 7;
      let value;
      switch (wire) {
        case Wire.Varint:
          value = readVarint();
          break;
        case Wire.Fixed64:
          value = view.getFloat64(p, true);
          p += 8;
          break;
        case Wire.Length: {
          const length = Number(readVarint());
          value = buf.subarray(p, p + length);
          p += length;
          break;
        }
        case Wire.Fixed32:
          value = view.getFloat32(p, true);
          p += 4;
          break;
        default:
          throw new Error(`Unsupported protobuf wire type ${wire} at byte ${p}`);
      }
      (out[field] ??= []).push(value);
    }
    return out;
  }
  function one(msg, field) {
    return msg?.[field]?.[0];
  }
  function all(msg, field) {
    return msg?.[field] ?? [];
  }
  function bytes(msg, field) {
    const value = one(msg, field);
    return value instanceof Uint8Array ? value : null;
  }
  function sub(msg, field) {
    const value = bytes(msg, field);
    return value ? decode(value) : null;
  }
  function subs(msg, field) {
    return all(msg, field).filter((value) => value instanceof Uint8Array).map(decode);
  }
  function text(msg, field) {
    const value = bytes(msg, field);
    return value ? new TextDecoder().decode(value) : "";
  }
  function num(msg, field, fallback = 0) {
    const value = one(msg, field);
    if (value === void 0 || value instanceof Uint8Array) return fallback;
    return Number(value);
  }
  const PLATFORM_WEB = 3;
  const SURFACE_CHROMIUM = 4;
  const FILTER_TRANSLATE = 2;
  const FILTER_AUTO = 7;
  const RENDERING_ENV_LENS_OVERLAY = 14;
  function randomUuid() {
    const high = BigInt(Math.floor(Math.random() * 1073741824));
    const low = BigInt(Math.floor(Math.random() * 4294967296));
    return high << 32n | low;
  }
  function buildRequest(image, settings2) {
    const translating = Boolean(settings2.targetLang);
    return writer().sub(F.LensOverlayServerRequest.objectsRequest, (objects) => {
      objects.sub(F.LensOverlayObjectsRequest.requestContext, (ctx) => {
        ctx.sub(
          F.LensOverlayRequestContext.requestId,
          (id) => id.int(F.LensOverlayRequestId.uuid, randomUuid()).int(F.LensOverlayRequestId.sequenceId, 1).int(F.LensOverlayRequestId.imageSequenceId, 1)
        );
        ctx.sub(F.LensOverlayRequestContext.clientContext, (client) => {
          client.int(F.LensOverlayClientContext.platform, PLATFORM_WEB);
          client.int(F.LensOverlayClientContext.surface, SURFACE_CHROMIUM);
          client.sub(
            F.LensOverlayClientContext.localeContext,
            (locale) => locale.str(F.LocaleContext.language, settings2.ocrLang || settings2.targetLang).str(F.LocaleContext.region, settings2.region).str(F.LocaleContext.timeZone, settings2.timeZone)
          );
          client.sub(
            F.LensOverlayClientContext.clientFilters,
            (filters) => filters.sub(F.AppliedFilters.filter, (filter) => {
              if (!translating) {
                filter.int(F.AppliedFilter.filterType, FILTER_AUTO);
                return;
              }
              filter.int(F.AppliedFilter.filterType, FILTER_TRANSLATE);
              filter.sub(
                F.AppliedFilter.translate,
                (translate2) => translate2.str(F.AppliedFilter_Translate.targetLanguage, settings2.targetLang).str(F.AppliedFilter_Translate.sourceLanguage, settings2.sourceLang)
              );
            })
          );
          client.sub(
            F.LensOverlayClientContext.renderingContext,
            (rendering) => rendering.int(F.RenderingContext.renderingEnvironment, RENDERING_ENV_LENS_OVERLAY)
          );
        });
      });
      objects.sub(F.LensOverlayObjectsRequest.imageData, (data) => {
        data.sub(
          F.ImageData.payload,
          (payload) => payload.bytes(F.ImagePayload.imageBytes, image.imageBytes)
        );
        data.sub(
          F.ImageData.imageMetadata,
          (meta) => meta.int(F.ImageMetadata.width, image.width).int(F.ImageMetadata.height, image.height)
        );
      });
    }).finish();
  }
  const TRANSLATION_SUCCESS = 1;
  const WORD_TYPE_FORMULA = 1;
  function parseGeometry(geometry) {
    const box = sub(geometry, F.Geometry.boundingBox);
    if (!box) return null;
    return {
      cx: num(box, F.CenterRotatedBox.centerX),
      cy: num(box, F.CenterRotatedBox.centerY),
      w: num(box, F.CenterRotatedBox.width),
      h: num(box, F.CenterRotatedBox.height),
      // rotation_z is clockwise radians; CSS rotate() takes clockwise degrees.
      angle: num(box, F.CenterRotatedBox.rotationZ) * 180 / Math.PI
    };
  }
  function parseWord(word) {
    const parsed = {
      text: text(word, F.TextLayout_Word.plainText),
      separator: text(word, F.TextLayout_Word.textSeparator),
      geometry: parseGeometry(sub(word, F.TextLayout_Word.geometry))
    };
    if (num(word, F.TextLayout_Word.type) === WORD_TYPE_FORMULA) {
      parsed.type = "FORMULA";
      parsed.latex = text(sub(word, F.TextLayout_Word.formulaMetadata), F.TextLayout_Word_FormulaMetadata.latex);
    }
    return parsed;
  }
  function paragraphsOf(objects) {
    const layout = sub(sub(objects, F.LensOverlayObjectsResponse.text), F.Text.textLayout);
    return subs(layout, F.TextLayout.paragraphs);
  }
  function parseOcr(objects) {
    return paragraphsOf(objects).map((paragraph) => ({
      writingDirection: num(paragraph, F.TextLayout_Paragraph.writingDirection),
      geometry: parseGeometry(sub(paragraph, F.TextLayout_Paragraph.geometry)),
      lines: subs(paragraph, F.TextLayout_Paragraph.lines).map((line) => {
        const words = subs(line, F.TextLayout_Line.words).map(parseWord);
        return {
          text: words.map((w) => w.text + w.separator).join("").trim(),
          words,
          geometry: parseGeometry(sub(line, F.TextLayout_Line.geometry))
        };
      })
    }));
  }
  function parseBackground(line) {
    const data = sub(line, F.TranslationData_Line.backgroundImageData);
    if (!data) return null;
    const image = bytes(data, F.TranslationData_BackgroundImageData.backgroundImage);
    if (!image) return null;
    return {
      bytes: image,
      vPad: num(data, F.TranslationData_BackgroundImageData.verticalPadding),
      hPad: num(data, F.TranslationData_BackgroundImageData.horizontalPadding)
    };
  }
  function parseTranslation(objects) {
    const paragraphs = paragraphsOf(objects);
    const gleams = subs(objects, F.LensOverlayObjectsResponse.deepGleams);
    const blocks = [];
    paragraphs.forEach((paragraph, index) => {
      const gleam = gleams[index];
      const translation = gleam ? sub(gleam, F.DeepGleamData.translation) : null;
      if (!translation) return;
      if (num(sub(translation, F.TranslationData.status), F.TranslationData_Status.code) !== TRANSLATION_SUCCESS) return;
      const sourceLines = subs(paragraph, F.TextLayout_Paragraph.lines);
      const translatedLines = subs(translation, F.TranslationData.line);
      if (sourceLines.length !== translatedLines.length) return;
      const lines = translatedLines.map((line, i) => {
        const style = sub(line, F.TranslationData_Line.style);
        const source = sourceLines[i];
        return {
          words: subs(line, F.TranslationData_Line.word).map(
            (word) => [num(word, F.TranslationData_Line_Word.start), num(word, F.TranslationData_Line_Word.end)]
          ),
          textColor: num(style, F.TranslationData_TextStyle.textColor),
          bgColor: num(style, F.TranslationData_TextStyle.backgroundPrimaryColor),
          geometry: source ? parseGeometry(sub(source, F.TextLayout_Line.geometry)) : null,
          background: parseBackground(line)
        };
      });
      blocks.push({
        translation: text(translation, F.TranslationData.translation),
        geometry: parseGeometry(sub(paragraph, F.TextLayout_Paragraph.geometry)),
        sourceLang: text(translation, F.TranslationData.sourceLanguage),
        targetLang: text(translation, F.TranslationData.targetLanguage),
        writingDirection: num(translation, F.TranslationData.writingDirection),
        alignment: num(translation, F.TranslationData.alignment),
        lines
      });
    });
    return blocks;
  }
  function parseResponse(raw) {
    const response = decode(raw);
    const error = sub(response, F.LensOverlayServerResponse.error);
    const errorType = error ? num(error, F.LensOverlayServerError.errorType) : 0;
    if (errorType) throw new Error(`Lens returned server error type ${errorType}`);
    const objects = sub(response, F.LensOverlayServerResponse.objectsResponse);
    if (!objects) return { contentLanguage: "", ocr: [], blocks: [] };
    return {
      contentLanguage: text(sub(objects, F.LensOverlayObjectsResponse.text), F.Text.contentLanguage),
      ocr: parseOcr(objects),
      blocks: parseTranslation(objects)
    };
  }
  const LENS_ENDPOINT = "https://lensfrontend-pa.googleapis.com/v1/crupload";
  function callLens(image, settings2) {
    return new Promise((resolve, reject) => {
      _GM_xmlhttpRequest({
        method: "POST",
        url: LENS_ENDPOINT,
        headers: {
          "Content-Type": "application/x-protobuf",
          "X-Goog-Api-Key": settings2.apiKey
        },
        data: buildRequest(image, settings2),
        binary: true,
        responseType: "arraybuffer",
        timeout: settings2.timeoutMs,
        onload: (response) => {
          if (response.status !== 200) {
            reject(new Error(`Lens returned HTTP ${response.status}`));
            return;
          }
          try {
            resolve(parseResponse(new Uint8Array(response.response)));
          } catch (e) {
            reject(new Error(`Could not parse the Lens response: ${e.message}`));
          }
        },
        onerror: () => reject(new Error("Network error talking to Lens")),
        ontimeout: () => reject(new Error("Lens timed out"))
      });
    });
  }
  function fetchImageBlob(url) {
    return new Promise((resolve, reject) => {
      _GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "blob",
        onload: (response) => {
          if (response.status && response.status >= 400) {
            reject(new Error(`Image fetch returned HTTP ${response.status}`));
            return;
          }
          resolve(response.response);
        },
        onerror: () => reject(
          new Error(
            "Could not fetch the image. If Tampermonkey blocked this domain, clear it under Settings > Security > Blocked domains."
          )
        )
      });
    });
  }
  function targetSize(width, height, { maxArea, maxSide }) {
    if (width * height <= maxArea || width <= maxSide && height <= maxSide) {
      return { width, height };
    }
    const scale = Math.min(maxSide / width, maxSide / height);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }
  function sourceSize(source) {
    return source instanceof HTMLImageElement ? { width: source.naturalWidth, height: source.naturalHeight } : { width: source.width, height: source.height };
  }
  async function encodeForUpload(source, settings2, release = () => {
  }) {
    const natural = sourceSize(source);
    const { width, height } = targetSize(natural.width, natural.height, settings2);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2d canvas context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    const jpeg = await new Promise((resolve, reject) => {
      try {
        canvas.toBlob(resolve, "image/jpeg", settings2.jpegQuality);
      } catch (e) {
        reject(e);
      }
    });
    if (!jpeg) throw new Error("Canvas is tainted");
    return {
      imageBytes: new Uint8Array(await jpeg.arrayBuffer()),
      width,
      height,
      source,
      sourceWidth: natural.width,
      sourceHeight: natural.height,
      release
    };
  }
  function loadWithCors(url) {
    return new Promise((resolve, reject) => {
      const probe = new Image();
      probe.crossOrigin = "anonymous";
      probe.decoding = "sync";
      probe.onload = () => resolve(probe);
      probe.onerror = () => reject(new Error("CORS load failed"));
      probe.src = url;
    });
  }
  async function acquireSource(img) {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const readable = (candidate) => {
      try {
        const ctx = probe.getContext("2d");
        if (!ctx) return false;
        ctx.drawImage(candidate, 0, 0, 1, 1);
        ctx.getImageData(0, 0, 1, 1);
        return true;
      } catch {
        return false;
      }
    };
    if (img.naturalWidth && img.naturalHeight && readable(img)) {
      const size = sourceSize(img);
      return { source: img, ...size, release: () => {
      } };
    }
    const url = img.currentSrc || img.src;
    if (!url) throw new Error("This image has no source to read");
    try {
      const cors = await loadWithCors(url);
      if (readable(cors)) {
        const size = sourceSize(cors);
        return { source: cors, ...size, release: () => {
        } };
      }
    } catch {
    }
    const blob = await fetchImageBlob(url);
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close()
    };
  }
  const WritingDirection = {
    RightToLeft: 1,
    TopToBottom: 2
  };
  const Alignment = {
    Left: 0,
    Right: 1,
    Center: 2
  };
  const MIN_FONT_SIZE = 3;
  const MAX_FONT_SIZE = 150;
  const OUTLINE_RATIO = 0.02;
  const RTL_LANGS = /* @__PURE__ */ new Set([
    "ar",
    "bal",
    "ckb",
    "dv",
    "fa",
    "he",
    "iw",
    "ji",
    "ks",
    "ps",
    "sd",
    "ug",
    "ur",
    "yi"
  ]);
  const CJK_LANGS = /* @__PURE__ */ new Set(["ja", "zh", "ko", "yue"]);
  const measureCtx = document.createElement("canvas").getContext("2d");
  const baseLang = (tag) => tag.split("-")[0]?.toLowerCase() ?? "";
  function fitFontSize(str, boxWidth, boxHeight, fontFamily) {
    if (!measureCtx) return MIN_FONT_SIZE;
    let low = MIN_FONT_SIZE;
    let high = MAX_FONT_SIZE;
    while (low <= high) {
      const mid = low + high >> 1;
      measureCtx.font = `${mid}px ${fontFamily}`;
      const metrics = measureCtx.measureText(str);
      const height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
      if (metrics.width >= boxWidth || height >= boxHeight) high = mid - 1;
      else low = mid + 1;
    }
    return Math.max(MIN_FONT_SIZE, Math.min(low - 1, MAX_FONT_SIZE));
  }
  function buildLineText(translation, line, nextLine) {
    let out = "";
    line.words.forEach(([start, end], i) => {
      out += translation.slice(start, end);
      const next = line.words[i + 1];
      if (next) out += translation.slice(end, next[0]);
      else if (nextLine?.words[0]) out += translation.slice(end, nextLine.words[0][0]);
    });
    return out;
  }
  function wrapText(measure, text2, maxWidth, perCharacter = false) {
    const lines = [];
    for (const hardLine of text2.split("\n")) {
      if (!hardLine) {
        lines.push("");
        continue;
      }
      const tokens = perCharacter ? [...hardLine] : hardLine.split(/\s+/);
      const joiner = perCharacter ? "" : " ";
      let current = "";
      for (const token of tokens) {
        const candidate = current ? `${current}${joiner}${token}` : token;
        if (measure(candidate) <= maxWidth || !current) current = candidate;
        else {
          lines.push(current);
          current = token;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }
  function fitTextBlock(setFont, measure, lineHeight, text2, boxWidth, boxHeight, perCharacter = false) {
    let low = MIN_FONT_SIZE;
    let high = MAX_FONT_SIZE;
    let best = [];
    while (low <= high) {
      const mid = low + high >> 1;
      setFont(mid);
      const lines = wrapText(measure, text2, boxWidth, perCharacter);
      const widest = lines.reduce((max, line) => Math.max(max, measure(line)), 0);
      if (widest >= boxWidth || lines.length * lineHeight(mid) >= boxHeight) high = mid - 1;
      else {
        low = mid + 1;
        best = lines;
      }
    }
    const size = Math.max(MIN_FONT_SIZE, Math.min(low - 1, MAX_FONT_SIZE));
    if (!best.length) {
      setFont(size);
      best = wrapText(measure, text2, boxWidth, perCharacter);
    }
    return { size, lines: best };
  }
  function argbToCss(value) {
    const alpha = (value >>> 24 & 255) / 255;
    return `rgba(${value >> 16 & 255}, ${value >> 8 & 255}, ${value & 255}, ${alpha})`;
  }
  function shouldStayVertical(block, mode) {
    if (block.writingDirection !== WritingDirection.TopToBottom) return false;
    if (mode === "keep") return true;
    if (mode === "horizontal") return false;
    return CJK_LANGS.has(baseLang(block.targetLang));
  }
  function wrapsPerCharacter(block) {
    return CJK_LANGS.has(baseLang(block.targetLang));
  }
  function isRtl(block) {
    if (block.writingDirection === WritingDirection.RightToLeft) return true;
    return RTL_LANGS.has(baseLang(block.targetLang));
  }
  function justification(alignment, rtl) {
    const map = {
      [Alignment.Left]: "flex-start",
      [Alignment.Right]: "flex-end",
      [Alignment.Center]: "center"
    };
    const value = map[alignment] ?? "center";
    return rtl && value === "flex-start" ? "flex-end" : value;
  }
  const styles = "/* Lives inside a shadow root, so these selectors compete with nothing. The\r\n   :host is a fixed, click-through, full-viewport layer; everything here is\r\n   positioned in viewport coordinates. */\r\n\r\n:host {\r\n  font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;\r\n  color: #1a1a1a;\r\n}\r\n\r\n#lt-button,\r\n#lt-gear {\r\n  position: absolute;\r\n  width: 32px;\r\n  height: 32px;\r\n  background: rgba(0, 0, 0, 0.6);\r\n  border-radius: 50%;\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n  opacity: 0;\r\n  pointer-events: none;\r\n  cursor: pointer;\r\n  transition: opacity 0.2s ease-in-out, transform 0.15s ease-in-out, background 0.2s;\r\n  transform: scale(0.9);\r\n  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);\r\n  border: 1px solid rgba(255, 255, 255, 0.2);\r\n}\r\n#lt-button:hover,\r\n#lt-gear:hover {\r\n  background: rgba(0, 0, 0, 0.85);\r\n  transform: scale(1.05);\r\n}\r\n\r\n/* Appears a beat after the main button, so a passing cursor does not summon\r\n   two controls at once. */\r\n#lt-gear {\r\n  width: 26px;\r\n  height: 26px;\r\n}\r\n#lt-button.lt-busy svg {\r\n  animation: lt-spin 1s linear infinite;\r\n}\r\n#lt-button.lt-active {\r\n  background: rgba(20, 110, 60, 0.9);\r\n}\r\n#lt-button.lt-error {\r\n  background: rgba(170, 30, 30, 0.9);\r\n}\r\n@keyframes lt-spin {\r\n  to {\r\n    transform: rotate(360deg);\r\n  }\r\n}\r\n\r\n.lt-layer {\r\n  position: absolute;\r\n  overflow: hidden;\r\n  pointer-events: none;\r\n}\r\n.lt-bg {\r\n  position: absolute;\r\n  max-width: none;\r\n}\r\n.lt-line {\r\n  position: absolute;\r\n  display: flex;\r\n  align-items: center;\r\n  white-space: pre;\r\n  line-height: 1;\r\n  transform-origin: center center;\r\n  margin: 0;\r\n  padding: 0;\r\n}\r\n\r\n#lt-toast {\r\n  position: absolute;\r\n  bottom: 16px;\r\n  left: 50%;\r\n  transform: translateX(-50%);\r\n  background: rgba(0, 0, 0, 0.88);\r\n  color: #fff;\r\n  padding: 8px 16px;\r\n  border-radius: 8px;\r\n  font-size: 13px;\r\n  pointer-events: none;\r\n  opacity: 0;\r\n  transition: opacity 0.2s;\r\n  max-width: 70vw;\r\n}\r\n#lt-toast.lt-show {\r\n  opacity: 1;\r\n}\r\n\r\n/* ------------------------------------------------------------- settings */\r\n\r\n.lt-panel-backdrop {\r\n  position: absolute;\r\n  inset: 0;\r\n  background: rgba(0, 0, 0, 0.5);\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n  pointer-events: auto;\r\n}\r\n.lt-panel {\r\n  background: #fff;\r\n  width: min(560px, 92vw);\r\n  max-height: 86vh;\r\n  display: flex;\r\n  flex-direction: column;\r\n  border-radius: 12px;\r\n  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);\r\n  overflow: hidden;\r\n}\r\n.lt-panel-head,\r\n.lt-panel-foot {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 8px;\r\n  padding: 12px 18px;\r\n  flex: none;\r\n}\r\n.lt-panel-head {\r\n  border-bottom: 1px solid #e6e6e6;\r\n  justify-content: space-between;\r\n  font-size: 15px;\r\n  font-weight: 600;\r\n}\r\n.lt-panel-foot {\r\n  border-top: 1px solid #e6e6e6;\r\n}\r\n.lt-spacer {\r\n  flex: 1;\r\n}\r\n.lt-panel-body {\r\n  padding: 10px 18px 16px;\r\n  overflow-y: auto;\r\n}\r\n\r\n.lt-row {\r\n  display: grid;\r\n  grid-template-columns: 190px minmax(0, 1fr);\r\n  align-items: center;\r\n  gap: 2px 14px;\r\n  padding: 7px 0;\r\n}\r\n.lt-label {\r\n  color: #333;\r\n}\r\n.lt-hint {\r\n  grid-column: 2;\r\n  color: #808080;\r\n  font-size: 12px;\r\n}\r\n.lt-input {\r\n  font: inherit;\r\n  padding: 7px 9px;\r\n  border: 1px solid #ccc;\r\n  border-radius: 6px;\r\n  background: #fff;\r\n  color: #1a1a1a;\r\n  min-width: 0;\r\n  width: 100%;\r\n  box-sizing: border-box;\r\n}\r\n.lt-input[type='checkbox'] {\r\n  justify-self: start;\r\n  width: 17px;\r\n  height: 17px;\r\n  padding: 0;\r\n}\r\n.lt-x {\r\n  border: 0;\r\n  background: transparent;\r\n  font-size: 22px;\r\n  line-height: 1;\r\n  cursor: pointer;\r\n  color: #666;\r\n  padding: 0 4px;\r\n}\r\n.lt-btn {\r\n  font: inherit;\r\n  padding: 7px 15px;\r\n  border-radius: 7px;\r\n  cursor: pointer;\r\n  border: 1px solid #ccc;\r\n  background: #f5f5f5;\r\n  color: #1a1a1a;\r\n}\r\n.lt-btn.lt-primary {\r\n  background: #1a73e8;\r\n  border-color: #1a73e8;\r\n  color: #fff;\r\n}\r\n.lt-btn.lt-ghost:hover {\r\n  background: #eaeaea;\r\n}\r\n\r\n@media (prefers-color-scheme: dark) {\r\n  .lt-panel {\r\n    background: #1f1f22;\r\n    color: #ececec;\r\n  }\r\n  .lt-panel-head,\r\n  .lt-panel-foot {\r\n    border-color: #35353a;\r\n  }\r\n  .lt-label {\r\n    color: #d6d6d6;\r\n  }\r\n  .lt-hint {\r\n    color: #9a9a9a;\r\n  }\r\n  .lt-input {\r\n    background: #2a2a2e;\r\n    border-color: #45454c;\r\n    color: #ececec;\r\n  }\r\n  .lt-btn {\r\n    background: #2e2e33;\r\n    border-color: #45454c;\r\n    color: #ececec;\r\n  }\r\n  .lt-btn.lt-ghost:hover {\r\n    background: #3a3a40;\r\n  }\r\n  .lt-x {\r\n    color: #bbb;\r\n  }\r\n}\r\n\n/* Outline slider with its live sample. */\n.lt-slider {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-width: 0;\n}\n.lt-slider input[type='range'] {\n  flex: 1;\n  width: auto;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  accent-color: #1a73e8;\n}\n.lt-readout {\n  min-width: 42px;\n  text-align: right;\n  font-variant-numeric: tabular-nums;\n  color: #666;\n}\n.lt-preview {\n  grid-column: 2;\n  width: 100%;\n  height: auto;\n  border-radius: 6px;\n  border: 1px solid #ddd;\n  margin-top: 6px;\n}\n@media (prefers-color-scheme: dark) {\n  .lt-readout {\n    color: #aaa;\n  }\n  .lt-preview {\n    border-color: #45454c;\n  }\n}\n";
  const HOST_ID = "lens-translate-root";
  let shadow = null;
  function uiRoot() {
    if (shadow) return shadow;
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute(
      "style",
      [
        "all: initial",
        "font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, sans-serif",
        "color: #1a1a1a",
        "position: fixed",
        "top: 0",
        "left: 0",
        "width: 100%",
        "height: 100%",
        "z-index: 2147483647",
        "pointer-events: none"
      ].map((rule) => `${rule} !important`).join(";")
    );
    shadow = host.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = styles;
    shadow.appendChild(sheet);
    document.documentElement.appendChild(host);
    return shadow;
  }
  function isOurs(node) {
    const element = node;
    return Boolean(element?.closest?.(`#${HOST_ID}`)) || element?.getRootNode?.() === shadow;
  }
  const overlays = /* @__PURE__ */ new WeakMap();
  const pct = (value) => `${(value * 100).toFixed(4)}%`;
  const hasOverlay = (img) => overlays.has(img);
  function clearOverlay(img) {
    const entry = overlays.get(img);
    if (!entry) return false;
    for (const url of entry.objectUrls) URL.revokeObjectURL(url);
    entry.layer.remove();
    overlays.delete(img);
    return true;
  }
  function placeLayer(layer, img) {
    const rect = img.getBoundingClientRect();
    layer.style.top = `${rect.top}px`;
    layer.style.left = `${rect.left}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
  }
  function clearAllOverlays() {
    let count = 0;
    for (const img of Array.from(document.images)) {
      if (clearOverlay(img)) count += 1;
    }
    return count;
  }
  function repositionOverlays() {
    for (const img of Array.from(document.images)) {
      const entry = overlays.get(img);
      if (!entry) continue;
      if (!img.isConnected) {
        clearOverlay(img);
        continue;
      }
      placeLayer(entry.layer, img);
    }
  }
  function renderBackground(layer, line, geometry, aspect, objectUrls) {
    if (!line.background) return;
    const padW = line.background.hPad * geometry.h / aspect;
    const padH = line.background.vPad * geometry.h;
    const url = URL.createObjectURL(new Blob([line.background.bytes], { type: "image/webp" }));
    objectUrls.push(url);
    const patch = document.createElement("img");
    patch.className = "lt-bg";
    patch.src = url;
    patch.style.cssText = [
      `width:${pct(geometry.w + padW)}`,
      `height:${pct(geometry.h + padH)}`,
      `left:${pct(geometry.cx - geometry.w / 2 - padW / 2)}`,
      `top:${pct(geometry.cy - geometry.h / 2 - padH / 2)}`,
      `transform:rotate(${geometry.angle}deg)`
    ].join(";");
    layer.appendChild(patch);
  }
  function renderTranslation(img, blocks, settings2) {
    clearOverlay(img);
    const rect = img.getBoundingClientRect();
    const aspect = img.naturalWidth / img.naturalHeight;
    const fontFamily = settings2.fontFamily || getComputedStyle(img).fontFamily || "system-ui, sans-serif";
    const layer = document.createElement("div");
    layer.className = "lt-layer";
    placeLayer(layer, img);
    uiRoot().appendChild(layer);
    const objectUrls = [];
    overlays.set(img, { layer, objectUrls });
    let rendered = 0;
    for (const block of blocks) {
      const rtl = isRtl(block);
      const vertical = shouldStayVertical(block, settings2.verticalText);
      const justify = justification(block.alignment, rtl);
      block.lines.forEach((line, index) => {
        const geometry = line.geometry;
        if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;
        const patch = Boolean(settings2.drawBackground && line.background);
        if (patch) renderBackground(layer, line, geometry, aspect, objectUrls);
        const str = buildLineText(block.translation, line, block.lines[index + 1]);
        if (!str.trim()) return;
        const boxW = geometry.w * rect.width;
        const boxH = geometry.h * rect.height;
        const size = fitFontSize(str, vertical ? boxH : boxW, vertical ? boxW : boxH, fontFamily);
        const bgColor = argbToCss(line.bgColor);
        const outline = size * OUTLINE_RATIO * settings2.outlineScale;
        const padX = patch ? 0 : 2;
        const padY = patch ? 0 : 1;
        const element = document.createElement("div");
        element.className = "lt-line";
        element.textContent = str;
        element.style.cssText = [
          `width:calc(${pct(geometry.w)} + ${padX * 2}px)`,
          `height:calc(${pct(geometry.h)} + ${padY * 2}px)`,
          `left:calc(${pct(geometry.cx - geometry.w / 2)} - ${padX}px)`,
          `top:calc(${pct(geometry.cy - geometry.h / 2)} - ${padY}px)`,
          `color:${argbToCss(line.textColor)}`,
          `background-color:${patch ? "transparent" : bgColor}`,
          `font-size:${size}px`,
          `font-family:${fontFamily}`,
          `justify-content:${justify}`,
          `direction:${rtl ? "rtl" : "ltr"}`,
          `writing-mode:${vertical ? "vertical-rl" : "horizontal-tb"}`,
          `transform:rotate(${geometry.angle}deg)`,
          // The outline keeps the text legible over whatever residue the
          // inpainting left behind.
          patch ? `text-shadow:${-outline}px ${outline}px 0 ${bgColor},${outline}px ${outline}px 0 ${bgColor},${outline}px ${-outline}px 0 ${bgColor},${-outline}px ${-outline}px 0 ${bgColor}` : ""
        ].filter(Boolean).join(";");
        layer.appendChild(element);
        rendered += 1;
      });
    }
    return rendered;
  }
  const DEG = Math.PI / 180;
  const UPRIGHT_RANGES = [
    [4352, 4607],
    [11904, 12351],
    [12353, 13311],
    [13312, 19903],
    [19968, 40959],
    [44032, 55215],
    [63744, 64255],
    [65040, 65103],
    [65280, 65376],
    [65504, 65510]
  ];
  const isUpright = (char) => {
    const code = char.codePointAt(0) ?? 0;
    return UPRIGHT_RANGES.some(([low, high]) => code >= low && code <= high);
  };
  const CORNER_PUNCT = new Set("、。，．");
  function verticalRuns(text2) {
    const runs = [];
    for (const char of text2) {
      let upright = isUpright(char);
      const last = runs[runs.length - 1];
      if (/\s/.test(char) && last) upright = last[0];
      if (last && last[0] === upright) last[1] += char;
      else runs.push([upright, char]);
    }
    return runs;
  }
  function strokeThenFill(ctx, text2, x, y, outline, outlineColor) {
    if (outline && outlineColor) {
      ctx.fillStyle = outlineColor;
      for (const [dx, dy] of [
        [-outline, outline],
        [outline, outline],
        [outline, -outline],
        [-outline, -outline]
      ]) {
        ctx.fillText(text2, x + dx, y + dy);
      }
    }
  }
  function drawVertical({ ctx }, text2, boxW, boxH, size, fill, outline, outlineColor) {
    const em = size * 1.16;
    let total = 0;
    for (const [upright, run] of verticalRuns(text2)) {
      total += upright ? em * [...run].length : ctx.measureText(run).width;
    }
    let y = (boxH - total) / 2;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    for (const [upright, run] of verticalRuns(text2)) {
      if (upright) {
        for (const char of run) {
          const advance = ctx.measureText(char).width;
          const corner = CORNER_PUNCT.has(char);
          const x = (boxW - advance) / 2 + (corner ? advance * 0.45 : 0);
          const cy = y - (corner ? em * 0.4 : 0);
          strokeThenFill(ctx, char, x, cy, outline, outlineColor);
          ctx.fillStyle = fill;
          ctx.fillText(char, x, cy);
          y += em;
        }
      } else {
        const advance = ctx.measureText(run).width;
        ctx.save();
        ctx.translate(boxW / 2, y);
        ctx.rotate(90 * DEG);
        strokeThenFill(ctx, run, 0, -size / 2, outline, outlineColor);
        ctx.fillStyle = fill;
        ctx.fillText(run, 0, -size / 2);
        ctx.restore();
        y += advance;
      }
    }
  }
  function drawReflowedParagraph(draw, block, settings2) {
    const geometry = block.geometry;
    if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;
    const { ctx, width, height, fontFamily } = draw;
    const growth = settings2.mangaMode ? Math.max(1, settings2.mangaBoxGrowth) : 1;
    const boxW = geometry.w * width * growth;
    const boxH = geometry.h * height * Math.min(growth, 1.2);
    const style = block.lines[0];
    if (!style) return;
    const text2 = block.translation.trim();
    if (!text2) return;
    ctx.save();
    ctx.translate(geometry.cx * width, geometry.cy * height);
    ctx.rotate(geometry.angle * DEG);
    if (settings2.mangaMode && settings2.drawBackground) {
      const fillW = geometry.w * width * 1.16;
      const fillH = geometry.h * height * 1.16;
      ctx.fillStyle = argbToCss(style.bgColor);
      ctx.beginPath();
      ctx.ellipse(0, 0, fillW / 2, fillH / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const { size, lines } = fitTextBlock(
      (px) => {
        ctx.font = `${px}px ${fontFamily}`;
      },
      (candidate) => ctx.measureText(candidate).width,
      (px) => px * 1.25,
      text2,
      boxW,
      boxH,
      wrapsPerCharacter(block)
    );
    const fontSize = Math.max(size, draw.minFontPx);
    ctx.font = `${fontSize}px ${fontFamily}`;
    const lineHeight = fontSize * 1.25;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const fill = argbToCss(style.textColor);
    const outline = Math.max(
      0,
      Math.round(fontSize * OUTLINE_RATIO * 2 * settings2.outlineScale)
    );
    const outlineColor = argbToCss(style.bgColor);
    const justify = justification(block.alignment, isRtl(block));
    let y = -Math.min(boxH, lines.length * lineHeight) / 2;
    for (const line of lines) {
      const advance = ctx.measureText(line).width;
      const x = justify === "flex-start" ? -boxW / 2 : justify === "flex-end" ? boxW / 2 - advance : -advance / 2;
      strokeThenFill(ctx, line, x, y, outline, outlineColor);
      ctx.fillStyle = fill;
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
    ctx.restore();
  }
  async function drawLine(draw, block, line, nextLine, settings2, backgroundOnly = false) {
    const geometry = line.geometry;
    if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;
    const { ctx, width, height, fontFamily } = draw;
    const boxW = geometry.w * width;
    const boxH = geometry.h * height;
    const cx = geometry.cx * width;
    const cy = geometry.cy * height;
    const patch = settings2.drawBackground ? line.background : null;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(geometry.angle * DEG);
    if (patch) {
      const thickness = Math.min(boxW, boxH);
      const padW = patch.hPad * thickness;
      const padH = patch.vPad * thickness;
      try {
        const bitmap = await createImageBitmap(new Blob([patch.bytes], { type: "image/webp" }));
        ctx.drawImage(bitmap, -(boxW + padW) / 2, -(boxH + padH) / 2, boxW + padW, boxH + padH);
        bitmap.close();
      } catch {
        ctx.fillStyle = argbToCss(line.bgColor);
        ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
      }
    } else if (settings2.drawBackground) {
      ctx.fillStyle = argbToCss(line.bgColor);
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
    }
    const text2 = backgroundOnly ? "" : buildLineText(block.translation, line, nextLine);
    if (text2.trim()) {
      const vertical = shouldStayVertical(block, settings2.verticalText);
      const fitted = fitFontSize(text2, vertical ? boxH : boxW, vertical ? boxW : boxH, fontFamily);
      const size = Math.max(fitted, draw.minFontPx);
      ctx.font = `${size}px ${fontFamily}`;
      ctx.direction = isRtl(block) ? "rtl" : "ltr";
      const fill = argbToCss(line.textColor);
      const outline = patch ? Math.max(1, Math.round(size * OUTLINE_RATIO * settings2.outlineScale)) : 0;
      const outlineColor = patch ? argbToCss(line.bgColor) : null;
      const grow = size / Math.max(1, fitted);
      const drawW = grow > 1 ? boxW * grow : boxW;
      const drawH = grow > 1 ? boxH * grow : boxH;
      if (grow > 1 && settings2.drawBackground) {
        ctx.fillStyle = argbToCss(line.bgColor);
        ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
      }
      ctx.translate(-drawW / 2, -drawH / 2);
      if (vertical) {
        drawVertical(draw, text2, drawW, drawH, size, fill, outline, outlineColor);
      } else {
        const justify = justification(block.alignment, isRtl(block));
        const advance = ctx.measureText(text2).width;
        const x = justify === "flex-start" ? 0 : justify === "flex-end" ? drawW - advance : (drawW - advance) / 2;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        strokeThenFill(ctx, text2, x, drawH / 2, outline, outlineColor);
        ctx.fillStyle = fill;
        ctx.fillText(text2, x, drawH / 2);
      }
    }
    ctx.restore();
  }
  async function renderToBlob(source, naturalWidth, naturalHeight, blocks, settings2, displayedWidth = naturalWidth) {
    const scale = Math.min(
      Math.max(1, Math.round(settings2.supersample)),
      Math.max(1, Math.floor(8e3 / Math.max(naturalWidth, naturalHeight)))
    );
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2d canvas context");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    const fontFamily = settings2.fontFamily || "system-ui, -apple-system, sans-serif";
    const canvasPerCssPx = width / Math.max(1, displayedWidth);
    const floorCssPx = settings2.mangaMode ? Math.max(settings2.minReadablePx, 14) : settings2.minReadablePx;
    const draw = {
      ctx,
      width,
      height,
      fontFamily,
      minFontPx: floorCssPx > 0 ? floorCssPx * canvasPerCssPx : 0
    };
    for (const block of blocks) {
      const vertical = block.writingDirection === 2;
      const stayVertical = !settings2.mangaMode && shouldStayVertical(block, settings2.verticalText);
      const reflow = vertical && !stayVertical && Boolean(block.geometry);
      for (let i = 0; i < block.lines.length; i += 1) {
        const line = block.lines[i];
        if (!line) continue;
        if (reflow) await drawLine(draw, block, line, block.lines[i + 1], settings2, true);
        else await drawLine(draw, block, line, block.lines[i + 1], settings2);
      }
      if (reflow) drawReflowedParagraph(draw, block, settings2);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not encode the translated image");
    return blob;
  }
  const covers = /* @__PURE__ */ new WeakMap();
  const live = /* @__PURE__ */ new Set();
  const isCovered = (img) => covers.has(img);
  function place(cover, img) {
    cover.style.left = `${img.offsetLeft}px`;
    cover.style.top = `${img.offsetTop}px`;
    cover.style.width = `${img.offsetWidth}px`;
    cover.style.height = `${img.offsetHeight}px`;
  }
  function coverImage(img, blobUrl) {
    uncoverImage(img);
    const parent = img.parentElement;
    if (!parent) return false;
    const element = document.createElement("img");
    element.src = blobUrl;
    element.setAttribute("data-lens-translate", "");
    element.setAttribute(
      "style",
      [
        "position: absolute",
        "margin: 0",
        "padding: 0",
        "border: 0",
        "max-width: none",
        "max-height: none",
        "min-width: 0",
        "min-height: 0",
        "pointer-events: none",
        // Above the image, below anything the page floats on top of it.
        "z-index: 1",
        // Inherit the shape so rounded media does not get square corners.
        `border-radius: ${getComputedStyle(img).borderRadius}`,
        `object-fit: ${getComputedStyle(img).objectFit || "fill"}`
      ].map((rule) => `${rule} !important`).join(";")
    );
    if (getComputedStyle(parent).position === "static") {
      parent.style.setProperty("position", "relative", "important");
    }
    img.insertAdjacentElement("afterend", element);
    place(element, img);
    const resize = new ResizeObserver(() => place(element, img));
    resize.observe(img);
    covers.set(img, { element, blobUrl, resize });
    live.add(new WeakRef(img));
    return true;
  }
  function uncoverImage(img) {
    const cover = covers.get(img);
    if (!cover) return false;
    cover.resize.disconnect();
    cover.element.remove();
    URL.revokeObjectURL(cover.blobUrl);
    covers.delete(img);
    return true;
  }
  function uncoverAll() {
    let count = 0;
    for (const ref of live) {
      const img = ref.deref();
      if (!img) {
        live.delete(ref);
        continue;
      }
      if (uncoverImage(img)) count += 1;
    }
    for (const stray of Array.from(document.querySelectorAll("img[data-lens-translate]"))) {
      stray.remove();
      count += 1;
    }
    return count;
  }
  const LANGUAGES = [
    "af",
    "ar",
    "az",
    "be",
    "bg",
    "bn",
    "bs",
    "ca",
    "cs",
    "cy",
    "da",
    "de",
    "el",
    "en",
    "eo",
    "es",
    "et",
    "eu",
    "fa",
    "fi",
    "fil",
    "fr",
    "ga",
    "gl",
    "gu",
    "he",
    "hi",
    "hr",
    "hu",
    "hy",
    "id",
    "is",
    "it",
    "ja",
    "jv",
    "ka",
    "kk",
    "km",
    "kn",
    "ko",
    "ky",
    "lo",
    "lt",
    "lv",
    "mk",
    "ml",
    "mn",
    "mr",
    "ms",
    "my",
    "ne",
    "nl",
    "no",
    "pa",
    "pl",
    "ps",
    "pt",
    "ro",
    "ru",
    "si",
    "sk",
    "sl",
    "sq",
    "sr",
    "sv",
    "sw",
    "ta",
    "te",
    "th",
    "tr",
    "uk",
    "ur",
    "uz",
    "vi",
    "zh-CN",
    "zh-TW",
    "zu"
  ];
  let displayNames = null;
  function labeller() {
    if (displayNames) return displayNames;
    try {
      displayNames = new Intl.DisplayNames([navigator.language, "en"], { type: "language" });
    } catch {
      displayNames = null;
    }
    return displayNames;
  }
  function languageLabel(code) {
    const name = labeller()?.of(code);
    return name && name !== code ? `${name} (${code})` : code;
  }
  function languageOptions(blankLabel) {
    const options = LANGUAGES.map((code) => [code, languageLabel(code)]).sort(
      (a, b) => a[1].localeCompare(b[1])
    );
    return blankLabel ? [["", blankLabel], ...options] : [...options];
  }
  const STORAGE_KEY = "lens-translate:settings";
  const DEFAULTS = {
    targetLang: "ru",
    sourceLang: "",
    ocrLang: "",
    region: "US",
    timeZone: "America/New_York",
    // The key Chromium ships with; also used by owocr and chrome-lens-ocr.
    apiKey: "AIzaSyDr2UxVnv_U85AbhhY8XSHSIavUW0DC-sY",
    timeoutMs: 6e4,
    minImageSize: 50,
    // Chromium's image budget: components/lens/lens_features.cc
    maxArea: 15e5,
    maxSide: 1600,
    jpegQuality: 0.4,
    showButton: true,
    hotkey: "alt",
    fontFamily: "",
    drawBackground: true,
    verticalText: "auto",
    renderMode: "canvas",
    enabled: true,
    minReadablePx: 12,
    supersample: 2,
    cacheBytes: 32 * 1024 * 1024,
    mangaMode: false,
    mangaBoxGrowth: 1.45,
    outlineScale: 1
  };
  const FIELDS = [
    { key: "enabled", label: "Translation enabled", type: "checkbox" },
    {
      key: "renderMode",
      label: "Render as",
      type: "select",
      options: [
        ["canvas", "canvas - a picture laid over the image (default)"],
        ["overlay", "overlay - crisp text, can drift on dynamic pages"]
      ]
    },
    { key: "targetLang", label: "Translate to", type: "select", options: languageOptions() },
    {
      key: "sourceLang",
      label: "Translate from",
      type: "select",
      options: languageOptions("Detect automatically")
    },
    {
      key: "ocrLang",
      label: "OCR language hint",
      type: "select",
      options: languageOptions("Follow the target")
    },
    {
      key: "verticalText",
      label: "Vertical CJK text",
      type: "select",
      options: [
        ["auto", "auto - vertical only for CJK targets"],
        ["keep", "keep - always vertical, like Chromium"],
        ["horizontal", "horizontal - always reflow"]
      ]
    },
    {
      key: "mangaMode",
      label: "Manga mode",
      type: "checkbox",
      hint: "always reflow vertical text, widen the layout area, bigger minimum size"
    },
    {
      key: "mangaBoxGrowth",
      label: "Bubble fill (manga mode)",
      type: "number",
      step: "0.05",
      hint: "how far past the detected text box to lay out; 1 = exactly the box"
    },
    { key: "drawBackground", label: "Erase the original text", type: "checkbox" },
    {
      key: "outlineScale",
      label: "Text outline",
      type: "range",
      min: "0",
      max: "4",
      step: "0.1",
      hint: "thickens the outline behind translated text; 0 removes it"
    },
    { key: "fontFamily", label: "Font family", type: "text", hint: "blank = the page font" },
    { key: "showButton", label: "Show the hover button", type: "checkbox" },
    {
      key: "hotkey",
      label: "Modifier + click",
      type: "select",
      options: [
        ["alt", "Alt + click"],
        ["ctrl", "Ctrl + click"],
        ["shift", "Shift + click"],
        ["none", "off"]
      ]
    },
    {
      key: "minReadablePx",
      label: "Minimum text size (px)",
      type: "number",
      hint: "enlarges text that would render too small to read; 0 disables"
    },
    {
      key: "supersample",
      label: "Render sharpness",
      type: "select",
      options: [
        ["1", "1x - smallest images"],
        ["2", "2x - sharper when zoomed (default)"],
        ["3", "3x - sharpest, heaviest"]
      ]
    },
    {
      key: "cacheBytes",
      label: "Cache size (MB)",
      type: "number",
      step: "4",
      hint: "remembers what Lens said, so re-translating costs nothing; 0 disables"
    },
    { key: "minImageSize", label: "Ignore images under (px)", type: "number" },
    { key: "jpegQuality", label: "Upload quality (0..1)", type: "number", step: "0.05" },
    { key: "timeoutMs", label: "Request timeout (ms)", type: "number", step: "1000" },
    { key: "region", label: "Client region", type: "text" },
    { key: "timeZone", label: "Client time zone", type: "text" },
    { key: "apiKey", label: "API key", type: "text", hint: "only change if you have your own" }
  ];
  let cache = null;
  function getSettings() {
    if (!cache) {
      let stored = {};
      try {
        const raw = _GM_getValue(STORAGE_KEY, null);
        if (typeof raw === "string") stored = JSON.parse(raw);
        else if (raw && typeof raw === "object") stored = raw;
      } catch {
        stored = {};
      }
      cache = { ...DEFAULTS, ...stored };
    }
    return cache;
  }
  function saveSettings(patch) {
    cache = { ...getSettings(), ...patch };
    _GM_setValue(STORAGE_KEY, cache);
    return cache;
  }
  function resetSettings() {
    cache = { ...DEFAULTS };
    _GM_setValue(STORAGE_KEY, cache);
    return cache;
  }
  function coerce(field, raw) {
    if (field.key === "cacheBytes") {
      const megabytes = Number(raw);
      return Number.isFinite(megabytes) && megabytes >= 0 ? Math.round(megabytes * 1024 * 1024) : DEFAULTS.cacheBytes;
    }
    if (field.key === "supersample") {
      const value = Number(raw);
      return value >= 1 && value <= 3 ? value : DEFAULTS.supersample;
    }
    if (field.type === "checkbox") return Boolean(raw);
    if (field.type === "number" || field.type === "range") {
      const value = Number(raw);
      return Number.isFinite(value) ? value : DEFAULTS[field.key];
    }
    return String(raw).trim();
  }
  function weigh(blocks) {
    let bytes2 = 0;
    for (const block of blocks) {
      bytes2 += block.translation.length * 2;
      for (const line of block.lines) bytes2 += line.background?.bytes.byteLength ?? 0;
    }
    return bytes2;
  }
  const entries = /* @__PURE__ */ new Map();
  let totalBytes = 0;
  let clock = 0;
  const RENDITION_PARAMS = /* @__PURE__ */ new Set([
    "name",
    "format",
    "fm",
    "w",
    "width",
    "h",
    "height",
    "size",
    "s",
    "q",
    "quality",
    "dpr",
    "resize",
    "fit",
    "crop",
    "auto"
  ]);
  function normalizeUrl(raw) {
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
    try {
      const url = new URL(raw, document.baseURI);
      for (const name of [...url.searchParams.keys()]) {
        if (RENDITION_PARAMS.has(name.toLowerCase())) url.searchParams.delete(name);
      }
      url.hash = "";
      const query = url.searchParams.toString();
      return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
    } catch {
      return raw;
    }
  }
  function cacheKey(url, settings2) {
    return [normalizeUrl(url), settings2.targetLang, settings2.sourceLang, settings2.ocrLang].join("\0");
  }
  function getCached(key, settings2) {
    if (settings2.cacheBytes <= 0) return null;
    const entry = entries.get(key);
    if (!entry) return null;
    entry.used = ++clock;
    return entry.result;
  }
  function putCached(key, result, settings2) {
    const limit = settings2.cacheBytes;
    if (limit <= 0) return;
    const bytes2 = weigh(result.blocks);
    if (bytes2 > limit) return;
    const existing = entries.get(key);
    if (existing) totalBytes -= existing.bytes;
    entries.set(key, { result, bytes: bytes2, used: ++clock });
    totalBytes += bytes2;
    while (totalBytes > limit && entries.size > 1) {
      let oldestKey = null;
      let oldestUsed = Infinity;
      for (const [candidate, entry] of entries) {
        if (entry.used < oldestUsed) {
          oldestUsed = entry.used;
          oldestKey = candidate;
        }
      }
      if (oldestKey === null) break;
      totalBytes -= entries.get(oldestKey)?.bytes ?? 0;
      entries.delete(oldestKey);
    }
  }
  function renderKey(key, settings2, displayedWidth) {
    return [
      key,
      settings2.renderMode,
      settings2.verticalText,
      settings2.fontFamily,
      settings2.drawBackground ? 1 : 0,
      settings2.minReadablePx,
      settings2.supersample,
      settings2.mangaMode ? 1 : 0,
      settings2.mangaBoxGrowth,
      settings2.outlineScale,
      Math.round(displayedWidth / 50)
    ].join("");
  }
  const renders = /* @__PURE__ */ new Map();
  let renderBytes = 0;
  function getRender(key, settings2) {
    if (settings2.cacheBytes <= 0) return null;
    const entry = renders.get(key);
    if (!entry) return null;
    entry.used = ++clock;
    return entry.blob;
  }
  function putRender(key, blob, settings2) {
    const limit = settings2.cacheBytes;
    if (limit <= 0 || blob.size > limit) return;
    const existing = renders.get(key);
    if (existing) renderBytes -= existing.blob.size;
    renders.set(key, { blob, used: ++clock });
    renderBytes += blob.size;
    while (renderBytes > limit && renders.size > 1) {
      let oldestKey = null;
      let oldestUsed = Infinity;
      for (const [candidate, entry] of renders) {
        if (entry.used < oldestUsed) {
          oldestUsed = entry.used;
          oldestKey = candidate;
        }
      }
      if (oldestKey === null) break;
      renderBytes -= renders.get(oldestKey)?.blob.size ?? 0;
      renders.delete(oldestKey);
    }
  }
  function clearCache() {
    const stats = { entries: entries.size + renders.size, bytes: totalBytes + renderBytes };
    entries.clear();
    renders.clear();
    totalBytes = 0;
    renderBytes = 0;
    return stats;
  }
  const cacheStats = () => ({
    entries: entries.size + renders.size,
    bytes: totalBytes + renderBytes
  });
  let panel = null;
  function drawOutlinePreview(canvas, scale) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    const size = 22;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f2f0ea";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(40, 40, 40, 0.38)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i += 1) {
      const x2 = 8 + i * 37 % (width - 16);
      const y2 = 10 + i * 23 % (height - 20);
      ctx.strokeRect(x2, y2, 9, 13);
      ctx.beginPath();
      ctx.moveTo(x2 + 2, y2 + 4);
      ctx.lineTo(x2 + 7, y2 + 10);
      ctx.stroke();
    }
    ctx.font = `${size}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = "middle";
    const sample = "Пример текста / sample";
    const x = (width - ctx.measureText(sample).width) / 2;
    const y = height / 2;
    const outline = Math.round(size * OUTLINE_RATIO * 2 * scale);
    if (outline > 0) {
      ctx.fillStyle = "#f2f0ea";
      for (const [dx, dy] of [
        [-outline, outline],
        [outline, outline],
        [outline, -outline],
        [-outline, -outline]
      ]) {
        ctx.fillText(sample, x + dx, y + dy);
      }
    }
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText(sample, x, y);
  }
  function buildField(field, settings2) {
    const row = document.createElement("label");
    row.className = "lt-row";
    const label = document.createElement("span");
    label.className = "lt-label";
    label.textContent = field.label;
    row.appendChild(label);
    let input;
    if (field.type === "range") {
      const slider = document.createElement("input");
      slider.type = "range";
      if (field.min) slider.min = field.min;
      if (field.max) slider.max = field.max;
      if (field.step) slider.step = field.step;
      slider.value = String(settings2[field.key]);
      const readout = document.createElement("span");
      readout.className = "lt-readout";
      const preview = document.createElement("canvas");
      preview.className = "lt-preview";
      preview.width = 460;
      preview.height = 64;
      const refresh = () => {
        readout.textContent = `${Number(slider.value).toFixed(1)}x`;
        drawOutlinePreview(preview, Number(slider.value));
      };
      slider.addEventListener("input", refresh);
      refresh();
      const holder = document.createElement("span");
      holder.className = "lt-slider";
      holder.append(slider, readout);
      slider.className = "lt-input";
      slider.dataset["key"] = field.key;
      row.appendChild(holder);
      row.appendChild(preview);
      if (field.hint) {
        const hint = document.createElement("span");
        hint.className = "lt-hint";
        hint.textContent = field.hint;
        row.appendChild(hint);
      }
      return row;
    }
    if (field.type === "select") {
      const select = document.createElement("select");
      for (const [value, text2] of field.options ?? []) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text2;
        select.appendChild(option);
      }
      select.value = String(settings2[field.key]);
      input = select;
    } else {
      const control = document.createElement("input");
      control.type = field.type;
      if (field.step) control.step = field.step;
      if (field.type === "checkbox") {
        control.checked = Boolean(settings2[field.key]);
        row.classList.add("lt-row-check");
      } else {
        control.value = field.key === "cacheBytes" ? String(Math.round(settings2.cacheBytes / (1024 * 1024) * 10) / 10) : String(settings2[field.key]);
      }
      input = control;
    }
    input.className = "lt-input";
    input.dataset["key"] = field.key;
    row.appendChild(input);
    if (field.hint) {
      const hint = document.createElement("span");
      hint.className = "lt-hint";
      hint.textContent = field.hint;
      row.appendChild(hint);
    }
    return row;
  }
  function collect(root2) {
    const patch = {};
    for (const field of FIELDS) {
      const input = root2.querySelector(
        `[data-key="${field.key}"]`
      );
      if (!input) continue;
      const raw = field.type === "checkbox" ? input.checked : input.value;
      patch[field.key] = coerce(field, raw);
    }
    return patch;
  }
  function closeSettings() {
    panel?.remove();
    panel = null;
  }
  function openSettings(onSaved) {
    if (panel) {
      closeSettings();
      return;
    }
    const settings2 = getSettings();
    const backdrop = document.createElement("div");
    backdrop.className = "lt-panel-backdrop";
    backdrop.innerHTML = `
    <div class="lt-panel" role="dialog" aria-label="Lens Translate settings">
      <header class="lt-panel-head">
        <strong>Lens Translate</strong>
        <button class="lt-x" type="button" aria-label="Close">&times;</button>
      </header>
      <div class="lt-panel-body"></div>
      <footer class="lt-panel-foot">
        <button class="lt-btn lt-ghost" type="button" data-act="reset">Reset</button>
        <span class="lt-spacer"></span>
        <button class="lt-btn lt-ghost" type="button" data-act="cancel">Cancel</button>
        <button class="lt-btn lt-primary" type="button" data-act="save">Save</button>
      </footer>
    </div>`;
    panel = backdrop;
    const body = backdrop.querySelector(".lt-panel-body");
    if (body) for (const field of FIELDS) body.appendChild(buildField(field, settings2));
    backdrop.addEventListener("click", (event) => {
      const target = event.target;
      if (target === backdrop) return closeSettings();
      if (target.classList.contains("lt-x")) return closeSettings();
      const action = target.dataset["act"];
      if (action === "cancel") return closeSettings();
      if (action === "save") {
        const saved = saveSettings(collect(backdrop));
        closeSettings();
        onSaved?.(saved);
      } else if (action === "reset") {
        const fresh = resetSettings();
        closeSettings();
        onSaved?.(fresh);
        openSettings(onSaved);
      }
      return void 0;
    });
    const onKey = (event) => {
      if (!panel) {
        document.removeEventListener("keydown", onKey, true);
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        closeSettings();
        document.removeEventListener("keydown", onKey, true);
      }
    };
    document.addEventListener("keydown", onKey, true);
    uiRoot().appendChild(backdrop);
    backdrop.querySelector(".lt-input")?.focus();
  }
  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12H18A6,6 0 0,0 12,6V4M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/></svg>`;
  const GEAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="15" height="15"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>`;
  let settings = getSettings();
  const root = uiRoot();
  const button = document.createElement("div");
  button.id = "lt-button";
  button.innerHTML = ICON;
  button.title = "Translate the text in this image (click again to undo)";
  root.appendChild(button);
  const gear = document.createElement("div");
  gear.id = "lt-gear";
  gear.innerHTML = GEAR;
  gear.title = "Lens Translate settings";
  root.appendChild(gear);
  const toastEl = document.createElement("div");
  toastEl.id = "lt-toast";
  root.appendChild(toastEl);
  let toastTimer;
  function toast(message, ms = 3200) {
    toastEl.textContent = message;
    toastEl.classList.add("lt-show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("lt-show"), ms);
  }
  const busy = /* @__PURE__ */ new WeakSet();
  const isTranslated = (img) => isCovered(img) || hasOverlay(img);
  function undo(img) {
    const restored = uncoverImage(img) || clearOverlay(img);
    if (restored) button.classList.remove("lt-active");
    return restored;
  }
  async function translate(img) {
    if (busy.has(img)) return;
    if (!settings.enabled) {
      toast("Translation is switched off in settings");
      return;
    }
    if (undo(img)) return;
    busy.add(img);
    button.classList.add("lt-busy");
    button.classList.remove("lt-error");
    try {
      const key = cacheKey(img.currentSrc || img.src, settings);
      const displayedWidth = img.getBoundingClientRect().width || img.naturalWidth;
      if (settings.renderMode === "canvas") {
        const done = getRender(renderKey(key, settings, displayedWidth), settings);
        if (done && coverImage(img, URL.createObjectURL(done))) {
          if (currentImage === img) button.classList.add("lt-active");
          return;
        }
      }
      const prepared = await acquireSource(img);
      try {
        let result = getCached(key, settings);
        if (!result) {
          const upload = await encodeForUpload(prepared.source, settings);
          result = await callLens(upload, settings);
          putCached(key, result, settings);
        }
        if (!result.blocks.length) {
          const detected = result.ocr.some((p) => p.lines.length > 0);
          toast(
            detected ? "Lens read the text but returned no translation (same language?)" : "Lens found no text in this image"
          );
          return;
        }
        if (settings.renderMode === "canvas") {
          const blob = await renderToBlob(
            prepared.source,
            prepared.width,
            prepared.height,
            result.blocks,
            settings,
            // The displayed width is what decides whether text will be legible.
            displayedWidth
          );
          putRender(renderKey(key, settings, displayedWidth), blob, settings);
          const url = URL.createObjectURL(blob);
          if (!coverImage(img, url)) {
            URL.revokeObjectURL(url);
            toast("This image cannot be covered here");
            return;
          }
        } else if (!renderTranslation(img, result.blocks, settings)) {
          toast("Nothing could be placed on this image");
          return;
        }
        if (currentImage === img) button.classList.add("lt-active");
      } finally {
        prepared.release();
      }
    } catch (error) {
      button.classList.add("lt-error");
      toast(`Lens: ${error.message}`, 5e3);
      window.setTimeout(() => button.classList.remove("lt-error"), 3e3);
    } finally {
      busy.delete(img);
      button.classList.remove("lt-busy");
    }
  }
  let currentImage = null;
  let hideTimer;
  let gearTimer;
  const GEAR_DELAY_MS = 550;
  function showGear(img) {
    const rect = img.getBoundingClientRect();
    gear.style.top = `${rect.top + 8}px`;
    gear.style.left = `${rect.left + rect.width - 69}px`;
    gear.style.opacity = "1";
    gear.style.transform = "scale(1)";
    gear.style.pointerEvents = "auto";
  }
  function hideGear() {
    window.clearTimeout(gearTimer);
    gear.style.opacity = "0";
    gear.style.transform = "scale(0.9)";
    gear.style.pointerEvents = "none";
  }
  function isCandidate(node) {
    const img = node;
    if (!img || img.tagName !== "IMG") return false;
    const rect = img.getBoundingClientRect();
    return rect.width >= settings.minImageSize && rect.height >= settings.minImageSize;
  }
  function imageFromEvent(event) {
    for (const node of event.composedPath()) {
      if (isOurs(node)) return null;
      if (isCandidate(node)) return node;
    }
    return null;
  }
  function showButton(img) {
    if (!settings.showButton) return;
    currentImage = img;
    const rect = img.getBoundingClientRect();
    button.style.top = `${rect.top + 5}px`;
    button.style.left = `${rect.left + rect.width - 37}px`;
    button.style.opacity = "1";
    button.style.transform = "scale(1)";
    button.style.pointerEvents = "auto";
    button.classList.toggle("lt-active", isTranslated(img));
    window.clearTimeout(gearTimer);
    if (gear.style.opacity === "1") showGear(img);
    else gearTimer = window.setTimeout(() => showGear(img), GEAR_DELAY_MS);
  }
  function hideButton() {
    button.style.opacity = "0";
    button.style.transform = "scale(0.9)";
    button.style.pointerEvents = "none";
    hideGear();
    currentImage = null;
  }
  document.addEventListener(
    "mouseover",
    (event) => {
      const img = imageFromEvent(event);
      if (!img) return;
      window.clearTimeout(hideTimer);
      showButton(img);
    },
    true
  );
  document.addEventListener(
    "mouseout",
    (event) => {
      if (imageFromEvent(event)) hideTimer = window.setTimeout(hideButton, 300);
    },
    true
  );
  for (const control of [button, gear]) {
    control.addEventListener("mouseover", () => window.clearTimeout(hideTimer));
    control.addEventListener("mouseout", () => {
      hideTimer = window.setTimeout(hideButton, 300);
    });
  }
  gear.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSettings((saved) => {
        settings = saved;
        toast("Settings saved");
      });
    },
    true
  );
  button.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (currentImage) void translate(currentImage);
    },
    true
  );
  document.addEventListener(
    "click",
    (event) => {
      const modifier = settings.hotkey;
      if (modifier === "none") return;
      const pressed = modifier === "alt" && event.altKey || modifier === "ctrl" && event.ctrlKey || modifier === "shift" && event.shiftKey;
      if (!pressed) return;
      const img = imageFromEvent(event);
      if (!img) return;
      event.preventDefault();
      event.stopPropagation();
      void translate(img);
    },
    true
  );
  function reposition() {
    repositionOverlays();
    if (currentImage?.isConnected) {
      showButton(currentImage);
      if (gear.style.opacity === "1") showGear(currentImage);
    } else if (currentImage) hideButton();
  }
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
  _GM_registerMenuCommand(
    "Lens Translate: settings",
    () => openSettings((saved) => {
      settings = saved;
      toast("Settings saved");
    })
  );
  _GM_registerMenuCommand("Lens Translate: clear cache", () => {
    const { entries: entries2, bytes: bytes2 } = cacheStats();
    clearCache();
    toast(
      entries2 ? `Cleared ${entries2} cached result${entries2 === 1 ? "" : "s"} (${(bytes2 / 1048576).toFixed(1)} MB)` : "The cache was already empty"
    );
  });
  _GM_registerMenuCommand("Lens Translate: undo all on this page", () => {
    const restored = uncoverAll() + clearAllOverlays();
    toast(restored ? `Restored ${restored} image${restored === 1 ? "" : "s"}` : "Nothing to restore");
  });
  _GM_registerMenuCommand("Lens Translate: toggle on/off", () => {
    settings = saveSettings({ enabled: !settings.enabled });
    if (!settings.enabled) {
      uncoverAll();
      clearAllOverlays();
      hideButton();
    }
    toast(settings.enabled ? "Translation enabled" : "Translation disabled");
  });

})();