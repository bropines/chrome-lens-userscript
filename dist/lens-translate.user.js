// ==UserScript==
// @name         Lens Translate
// @namespace    https://github.com/bropines/chrome-lens-userscript
// @version      2.11.0
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
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var _GM = /* @__PURE__ */ (() => typeof GM != "undefined" ? GM : void 0)();
  var _GM_getValue = /* @__PURE__ */ (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
  var _GM_info = /* @__PURE__ */ (() => typeof GM_info != "undefined" ? GM_info : void 0)();
  var _GM_registerMenuCommand = /* @__PURE__ */ (() => typeof GM_registerMenuCommand != "undefined" ? GM_registerMenuCommand : void 0)();
  var _GM_setValue = /* @__PURE__ */ (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
  var _GM_xmlhttpRequest = /* @__PURE__ */ (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
  var _unsafeWindow = /* @__PURE__ */ (() => typeof unsafeWindow != "undefined" ? unsafeWindow : void 0)();
  const scriptVersion = () => _GM_info?.script?.version ?? "unknown";
  function hostName() {
    return _GM_info?.scriptHandler ?? "The userscript host";
  }
  const LOCAL_PREFIX = "lens-translate:";
  function readStored(key) {
    if (typeof _GM_getValue === "function") return _GM_getValue(key, null);
    try {
      return window.localStorage.getItem(LOCAL_PREFIX + key);
    } catch {
      return null;
    }
  }
  function writeStored(key, value) {
    const encoded = JSON.stringify(value);
    if (typeof _GM_setValue === "function") {
      _GM_setValue(key, encoded);
      return;
    }
    try {
      window.localStorage.setItem(LOCAL_PREFIX + key, encoded);
    } catch {
    }
  }
  const commands = [];
  function registerCommand(command) {
    commands.push(command);
    if (typeof _GM_registerMenuCommand === "function") {
      _GM_registerMenuCommand(command.menuLabel, command.run);
    }
  }
  function panelCommands() {
    const out = [];
    for (const command of commands) {
      if (command.label !== null) out.push({ label: command.label, run: command.run });
    }
    return out;
  }
  const request = typeof _GM_xmlhttpRequest === "function" ? _GM_xmlhttpRequest : _GM?.xmlHttpRequest;
  const BINARY_MIME = "text/plain; charset=x-user-defined";
  function fromLatin1(text2) {
    const bytes2 = new Uint8Array(text2.length);
    for (let i = 0; i < text2.length; i += 1) bytes2[i] = text2.charCodeAt(i) & 255;
    return bytes2;
  }
  function toLatin1(bytes2) {
    const CHUNK = 32768;
    let text2 = "";
    for (let i = 0; i < bytes2.length; i += CHUNK) {
      text2 += String.fromCharCode(...bytes2.subarray(i, i + CHUNK));
    }
    return text2;
  }
  async function toBytes(response, responseText) {
    if (response instanceof ArrayBuffer) return new Uint8Array(response);
    if (response instanceof Blob) return new Uint8Array(await response.arrayBuffer());
    if (ArrayBuffer.isView(response)) {
      const { buffer, byteOffset, byteLength } = response;
      return new Uint8Array(buffer.slice(byteOffset, byteOffset + byteLength));
    }
    if (typeof response === "string") return fromLatin1(response);
    if (typeof responseText === "string") return fromLatin1(responseText);
    return null;
  }
  function contentTypeOf(headers) {
    const match = /^content-type:\s*(.+)$/im.exec(headers ?? "");
    return match?.[1]?.trim() ?? "";
  }
  function timedOut() {
    const error = new Error("Timed out");
    error.name = "TimeoutError";
    return error;
  }
  function sendViaGm(attempt) {
    return new Promise((resolve, reject) => {
      if (!request) {
        reject(new Error(`${hostName()} has no GM_xmlhttpRequest`));
        return;
      }
      const deliver = (response) => {
        void (async () => {
          const bytes2 = await toBytes(response.response, response.responseText);
          if (!bytes2) {
            reject(new Error(`${hostName()} returned a response this script cannot read`));
            return;
          }
          resolve({
            status: response.status,
            bytes: bytes2,
            contentType: contentTypeOf(response.responseHeaders)
          });
        })();
      };
      const data = attempt.body === null ? void 0 : attempt.encoding === "typed" ? attempt.body : toLatin1(attempt.body);
      request({
        method: attempt.method,
        url: attempt.url,
        headers: attempt.headers,
        ...data === void 0 ? {} : { data, binary: true },
        responseType: "arraybuffer",
        overrideMimeType: BINARY_MIME,
        timeout: attempt.timeoutMs,
        onload: deliver,
        onerror: (response) => {
          if (response.status > 0) {
            deliver(response);
            return;
          }
          const detail = response.error || response.statusText || "network error";
          reject(new Error(`via ${hostName()}: ${detail}`));
        },
        ontimeout: () => reject(timedOut())
      });
    });
  }
  async function sendViaFetch(attempt) {
    let response;
    try {
      response = await fetch(attempt.url, {
        method: attempt.method,
        headers: attempt.headers,
        ...attempt.body === null ? {} : { body: attempt.body },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(attempt.timeoutMs)
      });
    } catch (error) {
      if (error.name === "TimeoutError") throw timedOut();
      throw new Error(`via fetch: ${error.message}`);
    }
    return {
      status: response.status,
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? ""
    };
  }
  let workingTransport = null;
  let workingEncoding = null;
  function ladder(hasBody, remember) {
    const latchedEncoding = remember ? workingEncoding : null;
    const encodings = !hasBody ? ["typed"] : latchedEncoding ? [latchedEncoding] : ["typed", "binary-string"];
    const rungs = encodings.map((encoding) => ({ transport: "gm", encoding }));
    rungs.push({ transport: "fetch", encoding: "typed" });
    const latchedTransport = remember ? workingTransport : null;
    return latchedTransport ? rungs.filter((rung) => rung.transport === latchedTransport) : rungs;
  }
  const BAD_REQUEST = 400;
  async function climb(attempt, remember) {
    const failures = [];
    for (const rung of ladder(attempt.body !== null, remember)) {
      const next = { ...attempt, encoding: rung.encoding };
      let response;
      try {
        response = rung.transport === "fetch" ? await sendViaFetch(next) : await sendViaGm(next);
      } catch (error) {
        failures.push(error.message);
        if (error.name === "TimeoutError") break;
        continue;
      }
      if (response.status < 400) {
        if (remember) {
          workingTransport = rung.transport;
          if (rung.transport === "gm") workingEncoding = rung.encoding;
        }
        return response;
      }
      failures.push(`HTTP ${response.status}`);
      if (response.status !== BAD_REQUEST) break;
    }
    throw new Error(failures.join("; ") || "the request was never sent");
  }
  function postBinary(options) {
    return climb({ ...options, method: "POST", encoding: "typed" }, true);
  }
  function getBinary(url, timeoutMs) {
    return climb(
      { method: "GET", url, headers: {}, body: null, encoding: "typed", timeoutMs },
      false
    );
  }
  const gmTransport = {
    post: postBinary,
    get: getBinary,
    hint: () => hostName() === "Tampermonkey" ? " If Tampermonkey blocked this domain, clear it under Settings > Security > Blocked domains." : ""
  };
  function hostFacts() {
    const has = (name, value) => `${name}: ${typeof value === "function" ? "yes" : "NO"}`;
    return [
      `host: ${_GM_info?.scriptHandler ?? "unknown"} ${_GM_info?.version ?? ""}`.trim(),
      `script: ${_GM_info?.script?.version ?? "unknown"}`,
      // A host that grants no unsafeWindow says nothing either way, which is not
      // the same as saying the script is sandboxed.
      `context: ${_unsafeWindow === void 0 ? "unknown" : _unsafeWindow === window ? "page (AdGuard-style)" : "sandbox"}`,
      [
        has("xmlhttpRequest", request),
        has("getValue", _GM_getValue),
        has("setValue", _GM_setValue),
        has("registerMenuCommand", _GM_registerMenuCommand)
      ].join(", ")
    ];
  }
  async function probe(transport, target, timeoutMs) {
    const started = Date.now();
    const attempt = {
      method: target.method,
      url: target.url,
      headers: target.headers,
      body: target.method === "POST" ? new Uint8Array(0) : null,
      encoding: "typed",
      timeoutMs
    };
    try {
      const response = transport === "fetch" ? await sendViaFetch(attempt) : await sendViaGm(attempt);
      return `HTTP ${response.status}, ${Date.now() - started} ms`;
    } catch (error) {
      return `${error.message}, ${Date.now() - started} ms`;
    }
  }
  let installed = null;
  function setTransport(transport) {
    installed = transport;
  }
  function getTransport() {
    if (!installed) {
      throw new Error("No transport is installed: call setTransport() before translating");
    }
    return installed;
  }
  let ignored = () => false;
  function ignoreElements(predicate) {
    ignored = predicate;
  }
  function backgroundUrl(element) {
    const value = window.getComputedStyle(element).backgroundImage;
    if (!value || value === "none") return "";
    const match = /url\((['"]?)(.*?)\1\)/.exec(value);
    const url = match?.[2] ?? "";
    return url && !url.startsWith("#") ? url : "";
  }
  function classify(node) {
    if (!node || typeof node !== "object") return null;
    const element = node;
    if (element.nodeType !== 1 || typeof element.tagName !== "string") return null;
    if (ignored(element)) return null;
    const pointable = window.getComputedStyle(element).pointerEvents !== "none";
    switch (element.tagName) {
      case "IMG": {
        const img = element;
        return { element, kind: "img", url: img.currentSrc || img.src || "", pointable };
      }
      case "CANVAS":
        return { element, kind: "canvas", url: "", pointable };
      case "VIDEO":
        return { element, kind: "video", url: "", pointable };
      default: {
        const url = backgroundUrl(element);
        return url ? { element, kind: "background", url, pointable } : null;
      }
    }
  }
  function isBigEnough(target, minSize) {
    const rect = target.element.getBoundingClientRect();
    return rect.width >= minSize && rect.height >= minSize;
  }
  function* walk(root2) {
    for (const element of root2.querySelectorAll("*")) {
      if (ignored(element)) continue;
      yield element;
      const shadow2 = element.shadowRoot;
      if (shadow2) yield* walk(shadow2);
    }
  }
  const BACKGROUND_SWEEP_LIMIT = 4e3;
  function collect$1(minSize) {
    const found = [];
    let seen = 0;
    for (const element of walk(document)) {
      seen += 1;
      const tag = element.tagName;
      const tagged = tag === "IMG" || tag === "CANVAS" || tag === "VIDEO";
      if (!tagged && seen > BACKGROUND_SWEEP_LIMIT) continue;
      const target = classify(element);
      if (target && isBigEnough(target, minSize)) found.push(target);
    }
    return found;
  }
  function targetFromEvent(event, minSize, ours) {
    for (const node of event.composedPath()) {
      if (ours(node)) return null;
      const target = classify(node);
      if (target && isBigEnough(target, minSize)) return target;
    }
    return null;
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
    buttonMode: "auto",
    hotkey: "alt",
    fontFamily: "",
    drawBackground: true,
    verticalText: "auto",
    renderMode: "canvas",
    enabled: true,
    minReadablePx: 12,
    supersample: 2,
    cacheBytes: 32 * 1024 * 1024,
    persistCache: true,
    mangaMode: false,
    mangaBoxGrowth: 1.45,
    outlineScale: 1,
    eraseMode: "patch",
    hullPadding: 0.45,
    reflowHorizontal: false,
    fitToBox: true,
    lineSpacing: 1.25,
    textAlign: "auto"
  };
  const GROUPS = [
    "Languages",
    "Layout",
    "Erasing the original",
    "Legibility",
    "Behaviour",
    "Advanced"
  ];
  const FIELDS = [
    { key: "enabled", group: "Behaviour", label: "Translation enabled", type: "checkbox" },
    {
      key: "renderMode",
      group: "Behaviour",
      label: "Render as",
      type: "select",
      options: [
        ["canvas", "canvas - a picture laid over the image (default)"],
        ["overlay", "overlay - crisp text, can drift on dynamic pages"]
      ]
    },
    { key: "targetLang", group: "Languages", label: "Translate to", type: "select", options: languageOptions() },
    {
      key: "sourceLang",
      group: "Languages",
      label: "Translate from",
      type: "select",
      options: languageOptions("Detect automatically")
    },
    {
      key: "ocrLang",
      group: "Languages",
      label: "OCR language hint",
      type: "select",
      options: languageOptions("Follow the target")
    },
    {
      key: "verticalText",
      group: "Layout",
      label: "Vertical CJK text",
      type: "select",
      options: [
        ["auto", "auto - vertical only for CJK targets"],
        ["keep", "keep - always vertical, like Chromium"],
        ["horizontal", "horizontal - always reflow"]
      ]
    },
    {
      key: "textAlign",
      group: "Layout",
      label: "Text alignment",
      type: "select",
      options: [
        ["auto", "auto - follow the source, like Chromium"],
        ["left", "left"],
        ["center", "center"],
        ["right", "right"]
      ]
    },
    {
      key: "mangaMode",
      group: "Layout",
      label: "Manga mode",
      type: "checkbox",
      hint: "always reflow vertical text, widen the layout area, bigger minimum size"
    },
    {
      key: "mangaBoxGrowth",
      group: "Layout",
      label: "Bubble fill (manga mode)",
      type: "number",
      step: "0.05",
      hint: "how far past the detected box to lay out; safe to raise while the setting below is on"
    },
    { key: "drawBackground", group: "Erasing the original", label: "Erase the original text", type: "checkbox" },
    {
      key: "eraseMode",
      group: "Erasing the original",
      label: "How to erase",
      type: "select",
      options: [
        ["patch", "patch - the server's inpainting, like Chromium"],
        ["hull", "hull - cover the whole text area with its background colour"]
      ]
    },
    {
      key: "hullPadding",
      group: "Erasing the original",
      label: "Cover margin",
      type: "range",
      min: "0",
      max: "2",
      step: "0.05",
      unit: "%",
      hint: "how far past the text the cover extends, relative to line height"
    },
    {
      key: "outlineScale",
      group: "Legibility",
      label: "Text outline",
      type: "range",
      min: "0",
      max: "8",
      step: "0.1",
      unit: "x",
      hint: "thickens the outline behind translated text; 0 removes it"
    },
    { key: "fontFamily", group: "Layout", label: "Font family", type: "text", hint: "blank = the page font" },
    { key: "showButton", group: "Behaviour", label: "Show the hover button", type: "checkbox" },
    {
      key: "hotkey",
      group: "Behaviour",
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
      key: "reflowHorizontal",
      group: "Layout",
      label: "Re-wrap horizontal text",
      type: "checkbox",
      hint: "treat a paragraph as one text area, not a repeat of the server lines"
    },
    {
      key: "fitToBox",
      group: "Layout",
      label: "Keep text out of the next bubble",
      type: "checkbox",
      hint: "shrink a paragraph that outgrows the room between its neighbours"
    },
    {
      key: "lineSpacing",
      group: "Layout",
      label: "Line spacing",
      type: "range",
      min: "0.8",
      max: "2",
      step: "0.05",
      unit: "x",
      hint: "needs re-wrapped text: the switch above, or a vertical source"
    },
    {
      key: "minReadablePx",
      group: "Legibility",
      label: "Minimum text size (px)",
      type: "number",
      hint: "enlarges text that would render too small to read; 0 disables"
    },
    {
      key: "supersample",
      group: "Legibility",
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
      group: "Behaviour",
      label: "Cache size (MB)",
      type: "number",
      step: "4",
      hint: "remembers what Lens said, so re-translating costs nothing; 0 disables"
    },
    {
      key: "buttonMode",
      group: "Behaviour",
      label: "When to show it",
      type: "select",
      options: [
        ["auto", "auto - pinned on a touch screen, on hover otherwise"],
        ["hover", "on hover only"],
        ["pinned", "always, over the image in view"]
      ],
      hint: "a touch screen has no hover, and tapping the image is how you turn the page"
    },
    {
      key: "persistCache",
      group: "Behaviour",
      label: "Remember across reloads",
      type: "checkbox",
      hint: "recognise a picture by its pixels, so reopening a page asks Lens nothing"
    },
    { key: "minImageSize", group: "Behaviour", label: "Ignore images under (px)", type: "number" },
    { key: "jpegQuality", group: "Advanced", label: "Upload quality (0..1)", type: "number", step: "0.05" },
    { key: "timeoutMs", group: "Advanced", label: "Request timeout (ms)", type: "number", step: "1000" },
    { key: "region", group: "Advanced", label: "Client region", type: "text" },
    { key: "timeZone", group: "Advanced", label: "Client time zone", type: "text" },
    { key: "apiKey", group: "Advanced", label: "API key", type: "text", hint: "only change if you have your own" }
  ];
  let cache = null;
  function getSettings() {
    if (!cache) {
      let stored = {};
      try {
        const raw = readStored(STORAGE_KEY);
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
    writeStored(STORAGE_KEY, cache);
    return cache;
  }
  function resetSettings() {
    cache = { ...DEFAULTS };
    writeStored(STORAGE_KEY, cache);
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
  const IMAGE_TIMEOUT_MS = 3e4;
  async function callLens(image, settings2) {
    const response = await getTransport().post({
      url: LENS_ENDPOINT,
      headers: {
        "Content-Type": "application/x-protobuf",
        "X-Goog-Api-Key": settings2.apiKey
      },
      body: buildRequest(image, settings2),
      timeoutMs: settings2.timeoutMs
    });
    try {
      return parseResponse(response.bytes);
    } catch (e) {
      throw new Error(`Could not parse the Lens response: ${e.message}`);
    }
  }
  async function fetchImageBlob(url) {
    const transport = getTransport();
    let response;
    try {
      response = await transport.get(url, IMAGE_TIMEOUT_MS);
    } catch (error) {
      const hint = transport.hint?.() ?? "";
      throw new Error(`Could not fetch the image (${error.message}).${hint}`);
    }
    return new Blob([response.bytes], { type: response.contentType });
  }
  const CONTROL_URL = "https://fonts.googleapis.com/css?family=Roboto";
  const PROBE_TIMEOUT_MS = 12e3;
  const TRANSPORTS = ["gm", "fetch"];
  function targets() {
    const settings2 = getSettings();
    return [
      [
        "lens",
        {
          url: LENS_ENDPOINT,
          method: "POST",
          headers: {
            "Content-Type": "application/x-protobuf",
            "X-Goog-Api-Key": settings2.apiKey
          }
        }
      ],
      ["control", { url: CONTROL_URL, method: "GET", headers: {} }]
    ];
  }
  const answered = (result) => result.startsWith("HTTP");
  function verdict(results) {
    const gmLens = answered(results.get("gm -> lens") ?? "");
    const fetchLens = answered(results.get("fetch -> lens") ?? "");
    const anyControl = answered(results.get("gm -> control") ?? "") || answered(results.get("fetch -> control") ?? "");
    if (gmLens && fetchLens) {
      return "Lens is reachable both ways. If translating still fails, the problem is past the transport - send this report with the exact error the toast shows.";
    }
    if (fetchLens) {
      return "Lens is reachable, but this host's own transport is not. That is handled: the script falls back to fetch, which costs one failed attempt per page and sends an Origin header GM_xmlhttpRequest would not.";
    }
    if (gmLens) {
      return "Lens is reachable through the host's transport, which is the path the script prefers anyway.";
    }
    if (anyControl) {
      return 'Nothing reaches Lens, but the control host answers. Something on this device is blocking lensfrontend-pa.googleapis.com specifically - check the DNS filtering and the HTTPS filtering exclusions, and search the activity log for "googleapis".';
    }
    return "Nothing reaches anything, the control host included. The device has no working connection from this page.";
  }
  function pageFacts(context) {
    const minSize = getSettings().minImageSize;
    const found = collect$1(minSize);
    const counts = /* @__PURE__ */ new Map();
    let biggest = "";
    let biggestArea = 0;
    for (const target of found) {
      counts.set(target.kind, (counts.get(target.kind) ?? 0) + 1);
      const rect = target.element.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > biggestArea) {
        biggestArea = area;
        biggest = `${target.kind} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      }
    }
    const tally = [...counts].map(([kind, n]) => `${n} ${kind}`).join(", ") || "nothing";
    return [
      `page: ${window.location.href.slice(0, 80)}`,
      `button: ${context.pinned ? "pinned" : "on hover"}, minimum size ${minSize}px`,
      `found: ${tally}`,
      `biggest: ${biggest || "-"}`,
      `images in document: ${document.images.length}`
    ];
  }
  async function diagnose(context) {
    const lines = [...hostFacts(), ...pageFacts(context), ""];
    const results = /* @__PURE__ */ new Map();
    for (const [label, target] of targets()) {
      for (const transport of TRANSPORTS) {
        const key = `${transport} -> ${label}`;
        const result = await probe(transport, target, PROBE_TIMEOUT_MS);
        results.set(key, result);
        lines.push(`${key.padEnd(16)} ${result}`);
      }
    }
    lines.push("", verdict(results));
    return lines.join("\n");
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
    if (source instanceof HTMLImageElement) {
      return { width: source.naturalWidth, height: source.naturalHeight };
    }
    if (source instanceof HTMLVideoElement) {
      return { width: source.videoWidth, height: source.videoHeight };
    }
    return { width: source.width, height: source.height };
  }
  function ownPixels(target) {
    if (target.kind === "canvas") return target.element;
    if (target.kind === "video") {
      const video = target.element;
      return video.videoWidth && video.videoHeight ? video : null;
    }
    if (target.kind === "img") {
      const img = target.element;
      return img.naturalWidth && img.naturalHeight ? img : null;
    }
    return null;
  }
  const FINGERPRINT_SIZE = 128;
  function fingerprint(source, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = FINGERPRINT_SIZE;
    canvas.height = FINGERPRINT_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";
    try {
      ctx.drawImage(source, 0, 0, FINGERPRINT_SIZE, FINGERPRINT_SIZE);
      const { data } = ctx.getImageData(0, 0, FINGERPRINT_SIZE, FINGERPRINT_SIZE);
      let a = 2166136261;
      let b = 16777619;
      for (let i = 0; i < data.length; i += 1) {
        a = Math.imul(a ^ data[i], 16777619);
        b = Math.imul(b + data[i] + i, 2246822507);
      }
      const lane = (n) => (n >>> 0).toString(36);
      return `${lane(a)}.${lane(b)}.${width}x${height}`;
    } catch {
      return "";
    }
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
      const probe2 = new Image();
      probe2.crossOrigin = "anonymous";
      probe2.decoding = "sync";
      probe2.onload = () => resolve(probe2);
      probe2.onerror = () => reject(new Error("CORS load failed"));
      probe2.src = url;
    });
  }
  async function acquireSource(target) {
    const probe2 = document.createElement("canvas");
    probe2.width = 1;
    probe2.height = 1;
    const readable = (candidate) => {
      try {
        const ctx = probe2.getContext("2d");
        if (!ctx) return false;
        ctx.drawImage(candidate, 0, 0, 1, 1);
        ctx.getImageData(0, 0, 1, 1);
        return true;
      } catch {
        return false;
      }
    };
    const own = ownPixels(target);
    if (own && readable(own)) {
      const size = sourceSize(own);
      return { source: own, ...size, release: () => {
      } };
    }
    const url = target.url;
    if (!url) {
      throw new Error(
        own ? "This element is drawn from another origin and cannot be read" : "There is nothing to read from this element"
      );
    }
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
  const DB_NAME = "lens-translate";
  const DB_VERSION = 1;
  const STORE = "responses";
  let open = null;
  function database() {
    if (open) return open;
    open = new Promise((resolve) => {
      let request2;
      try {
        request2 = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      request2.onupgradeneeded = () => {
        const db = request2.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "hash" }).createIndex("used", "used");
        }
      };
      request2.onsuccess = () => resolve(request2.result);
      request2.onerror = () => resolve(null);
      request2.onblocked = () => resolve(null);
    });
    return open;
  }
  function run(mode, body2) {
    return database().then(
      (db) => new Promise((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(STORE, mode);
          const request2 = body2(transaction.objectStore(STORE));
          request2.onsuccess = () => resolve(request2.result);
          request2.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
    );
  }
  const languagesOf = (settings2) => [settings2.targetLang, settings2.sourceLang, settings2.ocrLang].join("|");
  function weigh$1(result) {
    let bytes2 = 0;
    for (const block of result.blocks) {
      bytes2 += block.translation.length * 2;
      for (const line of block.lines) bytes2 += line.background?.bytes.byteLength ?? 0;
    }
    return bytes2;
  }
  async function getStored(hash, settings2) {
    if (!hash || !settings2.persistCache) return null;
    const entry = await run("readonly", (store) => store.get(hash)) ?? null;
    if (!entry || entry.languages !== languagesOf(settings2)) return null;
    void run("readwrite", (store) => store.put({ ...entry, used: Date.now() }));
    return entry.result;
  }
  async function putStored(hash, result, settings2) {
    if (!hash || !settings2.persistCache || settings2.cacheBytes <= 0) return;
    const entry = {
      hash,
      languages: languagesOf(settings2),
      result,
      bytes: weigh$1(result),
      used: Date.now()
    };
    await run("readwrite", (store) => store.put(entry));
    await evict(settings2.cacheBytes);
  }
  async function evict(budget) {
    const all2 = await run("readonly", (store) => store.getAll()) ?? [];
    let total = all2.reduce((sum, entry) => sum + entry.bytes, 0);
    if (total <= budget) return;
    for (const entry of [...all2].sort((a, b) => a.used - b.used)) {
      if (total <= budget) break;
      total -= entry.bytes;
      await run("readwrite", (store) => store.delete(entry.hash));
    }
  }
  async function clearStored() {
    await run("readwrite", (store) => store.clear());
  }
  async function storedStats() {
    const all2 = await run("readonly", (store) => store.getAll()) ?? [];
    return { entries: all2.length, bytes: all2.reduce((sum, entry) => sum + entry.bytes, 0) };
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
  function justification(alignment, rtl, override = "auto") {
    if (override !== "auto") {
      return { left: "flex-start", center: "center", right: "flex-end" }[override];
    }
    const map = {
      [Alignment.Left]: "flex-start",
      [Alignment.Right]: "flex-end",
      [Alignment.Center]: "center"
    };
    const value = map[alignment] ?? "center";
    return rtl && value === "flex-start" ? "flex-end" : value;
  }
  const OVERLAY_CSS = `
.lt-layer {
  position: absolute;
  overflow: hidden;
  pointer-events: none;
}
.lt-bg {
  position: absolute;
  max-width: none;
}
.lt-line {
  position: absolute;
  display: flex;
  align-items: center;
  white-space: pre;
  line-height: 1;
  transform-origin: center center;
  margin: 0;
  padding: 0;
}
`;
  const overlays = /* @__PURE__ */ new WeakMap();
  const live$1 = /* @__PURE__ */ new Set();
  const pct = (value) => `${(value * 100).toFixed(4)}%`;
  function textShadow(radius, colour) {
    const r = radius.toFixed(2);
    const d = (radius * 0.71).toFixed(2);
    return [
      [`-${r}px`, "0"],
      [`${r}px`, "0"],
      ["0", `-${r}px`],
      ["0", `${r}px`],
      [`-${d}px`, `-${d}px`],
      [`${d}px`, `-${d}px`],
      [`-${d}px`, `${d}px`],
      [`${d}px`, `${d}px`]
    ].map(([x, y]) => `${x} ${y} 0 ${colour}`).join(",");
  }
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
  function overlaid() {
    const out = [];
    for (const ref of live$1) {
      const element = ref.deref();
      if (!element || !overlays.has(element)) live$1.delete(ref);
      else out.push(element);
    }
    return out;
  }
  function clearAllOverlays() {
    let count = 0;
    for (const img of overlaid()) {
      if (clearOverlay(img)) count += 1;
    }
    return count;
  }
  function repositionOverlays() {
    for (const img of overlaid()) {
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
  function renderTranslation(img, blocks, settings2, natural, root2) {
    clearOverlay(img);
    const rect = img.getBoundingClientRect();
    const aspect = natural.width / natural.height;
    const fontFamily = settings2.fontFamily || getComputedStyle(img).fontFamily || "system-ui, sans-serif";
    const layer = document.createElement("div");
    layer.className = "lt-layer";
    placeLayer(layer, img);
    root2.append(layer);
    const objectUrls = [];
    overlays.set(img, { layer, objectUrls });
    live$1.add(new WeakRef(img));
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
          // Eight directions rather than Chromium's four: the diagonals alone
          // separate into distinct copies once the offset grows past a pixel or
          // two, and this renderer has no stroke to fall back on.
          patch ? `text-shadow:${textShadow(outline, bgColor)}` : ""
        ].filter(Boolean).join(";");
        layer.appendChild(element);
        rendered += 1;
      });
    }
    return rendered;
  }
  function boxCorners(geometry, width, height) {
    const cx = geometry.cx * width;
    const cy = geometry.cy * height;
    const halfW = geometry.w * width / 2;
    const halfH = geometry.h * height / 2;
    const radians = geometry.angle * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH]
    ].map(([dx, dy]) => ({
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos
    }));
  }
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  function convexHull(points) {
    if (points.length < 3) return [...points];
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const build = (input) => {
      const chain = [];
      for (const point of input) {
        while (chain.length >= 2) {
          const last = chain[chain.length - 1];
          const prev = chain[chain.length - 2];
          if (cross(prev, last, point) > 0) break;
          chain.pop();
        }
        chain.push(point);
      }
      chain.pop();
      return chain;
    };
    return [...build(sorted), ...build([...sorted].reverse())];
  }
  function fillHull(ctx, hull, colour, pad) {
    if (hull.length < 3) return;
    ctx.save();
    ctx.beginPath();
    const [first, ...rest] = hull;
    ctx.moveTo(first.x, first.y);
    for (const point of rest) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fillStyle = colour;
    if (pad > 0) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = pad * 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.fill();
    ctx.restore();
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
    if (outline <= 0 || !outlineColor) return;
    ctx.save();
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outline * 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.miterLimit = 2;
    ctx.strokeText(text2, x, y);
    ctx.restore();
  }
  function drawVertical({ ctx }, text2, boxW, boxH, size, fill, outline, outlineColor) {
    const em = size * 1.16;
    let total = 0;
    for (const [upright, run2] of verticalRuns(text2)) {
      total += upright ? em * [...run2].length : ctx.measureText(run2).width;
    }
    let y = (boxH - total) / 2;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    for (const [upright, run2] of verticalRuns(text2)) {
      if (upright) {
        for (const char of run2) {
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
        const advance = ctx.measureText(run2).width;
        ctx.save();
        ctx.translate(boxW / 2, y);
        ctx.rotate(90 * DEG);
        strokeThenFill(ctx, run2, 0, -size / 2, outline, outlineColor);
        ctx.fillStyle = fill;
        ctx.fillText(run2, 0, -size / 2);
        ctx.restore();
        y += advance;
      }
    }
  }
  function fitInside(box, width, height) {
    const radians = box.angle * DEG;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const spanX = box.w * cos + box.h * sin;
    const spanY = box.w * sin + box.h * cos;
    const scale = Math.min(1, width / spanX, height / spanY);
    const w = box.w * scale;
    const h = box.h * scale;
    const halfX = (w * cos + h * sin) / 2;
    const halfY = (w * sin + h * cos) / 2;
    const place2 = (centre, half, limit) => half * 2 >= limit ? limit / 2 : Math.min(Math.max(centre, half), limit - half);
    return { cx: place2(box.cx, halfX, width), cy: place2(box.cy, halfY, height), w, h };
  }
  const rectOf = (geometry, width, height) => ({
    left: (geometry.cx - geometry.w / 2) * width,
    right: (geometry.cx + geometry.w / 2) * width,
    top: (geometry.cy - geometry.h / 2) * height,
    bottom: (geometry.cy + geometry.h / 2) * height
  });
  const GAP = 2;
  function roomFor(own, others, growth, width, height) {
    const growX = (own.right - own.left) * (growth - 1) / 2;
    const growY = (own.bottom - own.top) * (growth - 1) / 2;
    let left = Math.max(0, own.left - growX);
    let right = Math.min(width, own.right + growX);
    let top = Math.max(0, own.top - growY);
    let bottom = Math.min(height, own.bottom + growY);
    for (const other of others) {
      if (other.bottom > own.top && other.top < own.bottom) {
        if (other.right <= own.left) left = Math.max(left, other.right + GAP);
        if (other.left >= own.right) right = Math.min(right, other.left - GAP);
      }
      if (other.right > own.left && other.left < own.right) {
        if (other.bottom <= own.top) top = Math.max(top, other.bottom + GAP);
        if (other.top >= own.bottom) bottom = Math.min(bottom, other.top - GAP);
      }
    }
    return {
      left: Math.min(left, own.left),
      right: Math.max(right, own.right),
      top: Math.min(top, own.top),
      bottom: Math.max(bottom, own.bottom)
    };
  }
  function drawReflowedParagraph(draw, block, settings2, room) {
    const geometry = block.geometry;
    if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;
    const { ctx, width, height, fontFamily } = draw;
    const box = fitInside(
      {
        cx: (room.left + room.right) / 2,
        cy: (room.top + room.bottom) / 2,
        w: room.right - room.left,
        h: room.bottom - room.top,
        angle: geometry.angle
      },
      width,
      height
    );
    const boxW = box.w;
    const boxH = box.h;
    const style = block.lines[0];
    if (!style) return;
    const text2 = block.translation.trim();
    if (!text2) return;
    ctx.save();
    ctx.translate(box.cx, box.cy);
    ctx.rotate(geometry.angle * DEG);
    const spacing = settings2.lineSpacing > 0 ? settings2.lineSpacing : 1.25;
    const perCharacter = wrapsPerCharacter(block);
    const measure = (candidate) => ctx.measureText(candidate).width;
    const setFont = (px) => {
      ctx.font = `${px}px ${fontFamily}`;
    };
    const { size } = fitTextBlock(setFont, measure, (px) => px * spacing, text2, boxW, boxH, perCharacter);
    let fontSize = Math.max(size, draw.minFontPx);
    setFont(fontSize);
    let lines = wrapText(measure, text2, boxW, perCharacter);
    const widest = lines.reduce((max, line) => Math.max(max, measure(line)), 0);
    if (widest > boxW && widest > 0) {
      fontSize = Math.max(MIN_FONT_SIZE, fontSize * boxW / widest);
      setFont(fontSize);
      lines = wrapText(measure, text2, boxW, perCharacter);
    }
    if (settings2.fitToBox) {
      for (let pass = 0; pass < 3; pass += 1) {
        const needed = lines.length * fontSize * spacing;
        if (needed <= boxH || fontSize <= MIN_FONT_SIZE) break;
        fontSize = Math.max(MIN_FONT_SIZE, fontSize * boxH / needed);
        setFont(fontSize);
        lines = wrapText(measure, text2, boxW, perCharacter);
      }
    }
    const lineHeight = fontSize * spacing;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const fill = argbToCss(style.textColor);
    const outline = Math.max(
      0,
      Math.round(fontSize * OUTLINE_RATIO * 2 * settings2.outlineScale)
    );
    const outlineColor = argbToCss(style.bgColor);
    const justify = justification(block.alignment, isRtl(block), settings2.textAlign);
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
  function eraseTextArea(draw, block, settings2) {
    const { ctx, width, height } = draw;
    const points = [];
    let thinnest = Infinity;
    for (const line of block.lines) {
      if (!line.geometry) continue;
      points.push(...boxCorners(line.geometry, width, height));
      thinnest = Math.min(thinnest, line.geometry.w * width, line.geometry.h * height);
    }
    if (points.length < 3) return;
    const style = block.lines.find((line) => line.geometry) ?? block.lines[0];
    if (!style) return;
    const pad = Number.isFinite(thinnest) ? thinnest * settings2.hullPadding : 0;
    fillHull(ctx, convexHull(points), argbToCss(style.bgColor), pad);
  }
  function nudgeInside(draw, box, line) {
    const radians = line.angle * DEG;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const halfW = (box.w * cos + box.h * sin) / 2;
    const halfH = (box.w * sin + box.h * cos) / 2;
    const shift = (centre, half, limit, fromEnd) => {
      if (half * 2 >= limit) return fromEnd ? limit - half - centre : half - centre;
      if (centre - half < 0) return half - centre;
      if (centre + half > limit) return limit - half - centre;
      return 0;
    };
    const dx = shift(line.cx, halfW, draw.width, line.rtl);
    const dy = shift(line.cy, halfH, draw.height, false);
    if (dx === 0 && dy === 0) return;
    const c = Math.cos(radians);
    const sn = Math.sin(radians);
    draw.ctx.translate(dx * c + dy * sn, dy * c - dx * sn);
  }
  async function drawLine(draw, block, line, nextLine, settings2, backgroundOnly = false, skipBackground = false) {
    const geometry = line.geometry;
    if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;
    const { ctx, width, height, fontFamily } = draw;
    const boxW = geometry.w * width;
    const boxH = geometry.h * height;
    const cx = geometry.cx * width;
    const cy = geometry.cy * height;
    const patch = settings2.drawBackground && !skipBackground ? line.background : null;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(geometry.angle * DEG);
    if (patch) {
      const padW = patch.hPad * boxH;
      const padH = patch.vPad * boxH;
      try {
        const bitmap = await createImageBitmap(new Blob([patch.bytes], { type: "image/webp" }));
        ctx.drawImage(bitmap, -(boxW + padW) / 2, -(boxH + padH) / 2, boxW + padW, boxH + padH);
        bitmap.close();
      } catch {
        ctx.fillStyle = argbToCss(line.bgColor);
        ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
      }
    } else if (settings2.drawBackground && !skipBackground) {
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
      const enlarged = size > fitted;
      const advance = ctx.measureText(text2).width;
      const drawW = enlarged ? Math.min(Math.max(boxW, advance + size * 0.4), width) : boxW;
      const drawH = enlarged ? Math.min(Math.max(boxH, size * 1.35), height) : boxH;
      nudgeInside(draw, { w: drawW, h: drawH }, { cx, cy, angle: geometry.angle, rtl: isRtl(block) });
      if (enlarged && settings2.drawBackground && !skipBackground) {
        ctx.fillStyle = argbToCss(line.bgColor);
        ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
      }
      ctx.translate(-drawW / 2, -drawH / 2);
      if (vertical) {
        drawVertical(draw, text2, drawW, drawH, size, fill, outline, outlineColor);
      } else {
        const justify = justification(block.alignment, isRtl(block), settings2.textAlign);
        const advance2 = ctx.measureText(text2).width;
        const x = justify === "flex-start" ? 0 : justify === "flex-end" ? drawW - advance2 : (drawW - advance2) / 2;
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
    const boxes = blocks.map(
      (block) => block.geometry ? rectOf(block.geometry, width, height) : null
    );
    const growth = settings2.mangaMode ? Math.max(1, settings2.mangaBoxGrowth) : 1;
    for (const [index, block] of blocks.entries()) {
      const vertical = block.writingDirection === 2;
      const stayVertical = !settings2.mangaMode && shouldStayVertical(block, settings2.verticalText);
      const hull = settings2.drawBackground && (settings2.eraseMode === "hull" || settings2.mangaMode);
      if (hull) eraseTextArea(draw, block, settings2);
      const reflow = Boolean(block.geometry) && !stayVertical && (vertical || settings2.reflowHorizontal);
      for (let i = 0; i < block.lines.length; i += 1) {
        const line = block.lines[i];
        if (!line) continue;
        if (reflow) {
          if (!hull) await drawLine(draw, block, line, block.lines[i + 1], settings2, true);
        } else await drawLine(draw, block, line, block.lines[i + 1], settings2, false, hull);
      }
      if (reflow) {
        const own = boxes[index];
        if (own) {
          const others = boxes.filter((rect, at) => rect !== null && at !== index);
          drawReflowedParagraph(draw, block, settings2, roomFor(own, others, growth, width, height));
        }
      }
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not encode the translated image");
    return blob;
  }
  const covers = /* @__PURE__ */ new WeakMap();
  const live = /* @__PURE__ */ new Set();
  const isCovered = (img) => covers.has(img);
  const COVER_MARK = "data-lens-translate";
  const isCover = (node) => node.hasAttribute(COVER_MARK);
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
    element.setAttribute(COVER_MARK, "");
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
  const SEPARATOR = String.fromCharCode(0);
  const DRAWN = Object.keys({
    fontFamily: 0,
    drawBackground: 0,
    verticalText: 0,
    minReadablePx: 0,
    supersample: 0,
    mangaMode: 0,
    mangaBoxGrowth: 0,
    outlineScale: 0,
    eraseMode: 0,
    hullPadding: 0,
    reflowHorizontal: 0,
    fitToBox: 0,
    lineSpacing: 0,
    textAlign: 0
  }).sort();
  function renderKey(key, settings2, displayedWidth) {
    const parts = [key];
    for (const name of DRAWN) parts.push(`${name}=${String(settings2[name])}`);
    parts.push(`w=${Math.round(displayedWidth / 50)}`);
    return parts.join(SEPARATOR);
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
  const styles = "/* Lives inside a shadow root, so these selectors compete with nothing. The\n   :host is a fixed, click-through, full-viewport layer; everything here is\n   positioned in viewport coordinates. */\n\n:host {\n  font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;\n  color: #1a1a1a;\n}\n\n#lt-button,\n#lt-gear {\n  position: absolute;\n  width: 32px;\n  height: 32px;\n  background: rgba(0, 0, 0, 0.6);\n  border-radius: 50%;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  opacity: 0;\n  pointer-events: none;\n  cursor: pointer;\n  transition: opacity 0.2s ease-in-out, transform 0.15s ease-in-out, background 0.2s;\n  transform: scale(0.9);\n  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);\n  border: 1px solid rgba(255, 255, 255, 0.2);\n}\n#lt-button:hover,\n#lt-gear:hover {\n  background: rgba(0, 0, 0, 0.85);\n  transform: scale(1.05);\n}\n\n/* Appears a beat after the main button, so a passing cursor does not summon\n   two controls at once. */\n#lt-gear {\n  width: 26px;\n  height: 26px;\n}\n#lt-button.lt-busy svg {\n  animation: lt-spin 1s linear infinite;\n}\n#lt-button.lt-active {\n  background: rgba(20, 110, 60, 0.9);\n}\n#lt-button.lt-error {\n  background: rgba(170, 30, 30, 0.9);\n}\n@keyframes lt-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n#lt-toast {\n  position: absolute;\n  bottom: 16px;\n  left: 50%;\n  transform: translateX(-50%);\n  background: rgba(0, 0, 0, 0.88);\n  color: #fff;\n  padding: 8px 16px;\n  border-radius: 8px;\n  font-size: 13px;\n  pointer-events: none;\n  opacity: 0;\n  transition: opacity 0.2s;\n  max-width: 70vw;\n}\n#lt-toast.lt-show {\n  opacity: 1;\n}\n\n/* ------------------------------------------------------------- settings */\n\n.lt-panel-backdrop {\n  position: absolute;\n  inset: 0;\n  background: rgba(0, 0, 0, 0.5);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  pointer-events: auto;\n}\n.lt-panel {\n  background: #fff;\n  width: min(560px, 92vw);\n  max-height: 86vh;\n  display: flex;\n  flex-direction: column;\n  border-radius: 12px;\n  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);\n  overflow: hidden;\n}\n.lt-panel-head,\n.lt-panel-foot {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 12px 18px;\n  flex: none;\n}\n.lt-panel-head {\n  border-bottom: 1px solid #e6e6e6;\n  justify-content: space-between;\n  font-size: 15px;\n  font-weight: 600;\n}\n.lt-panel-foot {\n  border-top: 1px solid #e6e6e6;\n}\n.lt-spacer {\n  flex: 1;\n}\n.lt-panel-body {\n  padding: 10px 18px 16px;\n  overflow-y: auto;\n}\n\n.lt-row {\n  display: grid;\n  grid-template-columns: 190px minmax(0, 1fr);\n  align-items: center;\n  gap: 2px 14px;\n  padding: 7px 0;\n}\n.lt-label {\n  color: #333;\n}\n.lt-hint {\n  grid-column: 2;\n  color: #808080;\n  font-size: 12px;\n}\n.lt-input {\n  font: inherit;\n  padding: 7px 9px;\n  border: 1px solid #ccc;\n  border-radius: 6px;\n  background: #fff;\n  color: #1a1a1a;\n  min-width: 0;\n  width: 100%;\n  box-sizing: border-box;\n}\n.lt-input[type='checkbox'] {\n  justify-self: start;\n  width: 17px;\n  height: 17px;\n  padding: 0;\n}\n.lt-x {\n  border: 0;\n  background: transparent;\n  font-size: 22px;\n  line-height: 1;\n  cursor: pointer;\n  color: #666;\n  padding: 0 4px;\n}\n.lt-btn {\n  font: inherit;\n  padding: 7px 15px;\n  border-radius: 7px;\n  cursor: pointer;\n  border: 1px solid #ccc;\n  background: #f5f5f5;\n  color: #1a1a1a;\n}\n.lt-btn.lt-primary {\n  background: #1a73e8;\n  border-color: #1a73e8;\n  color: #fff;\n}\n.lt-btn.lt-ghost:hover {\n  background: #eaeaea;\n}\n\n@media (prefers-color-scheme: dark) {\n  .lt-panel {\n    background: #1f1f22;\n    color: #ececec;\n  }\n  .lt-panel-head,\n  .lt-panel-foot {\n    border-color: #35353a;\n  }\n  .lt-label {\n    color: #d6d6d6;\n  }\n  .lt-hint {\n    color: #9a9a9a;\n  }\n  .lt-input {\n    background: #2a2a2e;\n    border-color: #45454c;\n    color: #ececec;\n  }\n  .lt-btn {\n    background: #2e2e33;\n    border-color: #45454c;\n    color: #ececec;\n  }\n  .lt-btn.lt-ghost:hover {\n    background: #3a3a40;\n  }\n  .lt-x {\n    color: #bbb;\n  }\n}\n\n/* Outline slider with its live sample. */\n.lt-slider {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-width: 0;\n}\n.lt-slider input[type='range'] {\n  flex: 1;\n  width: auto;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  accent-color: #1a73e8;\n}\n.lt-readout {\n  min-width: 42px;\n  text-align: right;\n  font-variant-numeric: tabular-nums;\n  color: #666;\n}\n.lt-preview {\n  grid-column: 2;\n  width: 100%;\n  height: auto;\n  border-radius: 6px;\n  border: 1px solid #ddd;\n  margin-top: 6px;\n}\n@media (prefers-color-scheme: dark) {\n  .lt-readout {\n    color: #aaa;\n  }\n  .lt-preview {\n    border-color: #45454c;\n  }\n}\n\n/* Section headings. */\n.lt-group {\n  grid-column: 1 / -1;\n  margin: 16px 0 4px;\n  padding-bottom: 5px;\n  border-bottom: 1px solid #e6e6e6;\n  font-size: 11px;\n  font-weight: 600;\n  letter-spacing: 0.07em;\n  text-transform: uppercase;\n  color: #888;\n}\n.lt-group:first-child {\n  margin-top: 4px;\n}\n@media (prefers-color-scheme: dark) {\n  .lt-group {\n    border-color: #35353a;\n    color: #8c8c96;\n  }\n}\n\n/* Menu commands, for a host that has no menu of its own. */\n.lt-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  padding: 4px 0 0;\n}\n.lt-note {\n  color: #808080;\n  font-size: 12px;\n  padding-top: 8px;\n}\n@media (prefers-color-scheme: dark) {\n  .lt-note {\n    color: #9a9a9a;\n  }\n}\n\n/* The diagnostics report: fixed width, so columns line up as written. */\n.lt-panel-report {\n  max-width: 560px;\n}\n.lt-report {\n  margin: 0;\n  padding: 14px 18px;\n  overflow: auto;\n  white-space: pre-wrap;\n  word-break: break-word;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 12px;\n  line-height: 1.5;\n  user-select: text;\n  -webkit-user-select: text;\n}\n";
  const HOST_ID = "lens-translate-root";
  let shadow = null;
  function uiRoot() {
    if (shadow) return shadow;
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.dataset["version"] = scriptVersion();
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
    sheet.textContent = `${styles}
${OVERLAY_CSS}`;
    shadow.appendChild(sheet);
    document.documentElement.appendChild(host);
    return shadow;
  }
  function isOurs(node) {
    const element = node;
    return Boolean(element?.closest?.(`#${HOST_ID}`)) || element?.getRootNode?.() === shadow;
  }
  let panel$1 = null;
  function drawOutlinePreview(canvas, scale) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    const size = 22;
    ctx.clearRect(0, 0, width, height);
    const halves = [
      { x: 0, bg: "#f2f0ea", fg: "#141414", label: "light" },
      { x: width / 2, bg: "#141414", fg: "#f4f4f4", label: "dark" }
    ];
    for (const half of halves) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(half.x, 0, width / 2, height);
      ctx.clip();
      ctx.fillStyle = half.bg;
      ctx.fillRect(half.x, 0, width / 2, height);
      ctx.strokeStyle = half.fg;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      for (let i = 0; i < 16; i += 1) {
        const x2 = half.x + 6 + i * 41 % (width / 2 - 14);
        const y2 = 8 + i * 29 % (height - 18);
        ctx.strokeRect(x2, y2, 9, 13);
        ctx.beginPath();
        ctx.moveTo(x2 + 2, y2 + 4);
        ctx.lineTo(x2 + 7, y2 + 10);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.font = `${size}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = "middle";
      const sample = half.label === "light" ? "Пример текста" : "sample text";
      const x = half.x + (width / 2 - ctx.measureText(sample).width) / 2;
      const y = height / 2;
      const outline = size * 0.02 * 2 * scale;
      if (outline > 0) {
        ctx.strokeStyle = half.bg;
        ctx.lineWidth = outline * 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.miterLimit = 2;
        ctx.strokeText(sample, x, y);
      }
      ctx.fillStyle = half.fg;
      ctx.fillText(sample, x, y);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(128,128,128,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
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
      const wantsPreview = field.key === "outlineScale";
      const preview = document.createElement("canvas");
      preview.className = "lt-preview";
      preview.width = 460;
      preview.height = 64;
      const refresh2 = () => {
        const value = Number(slider.value);
        readout.textContent = field.unit === "%" ? `${Math.round(value * 100)}%` : `${value.toFixed(1)}x`;
        if (wantsPreview) drawOutlinePreview(preview, value);
      };
      slider.addEventListener("input", refresh2);
      refresh2();
      const holder = document.createElement("span");
      holder.className = "lt-slider";
      holder.append(slider, readout);
      slider.className = "lt-input";
      slider.dataset["key"] = field.key;
      row.appendChild(holder);
      if (wantsPreview) row.appendChild(preview);
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
  function buildActions() {
    const commands2 = panelCommands();
    if (!commands2.length) return null;
    const fragment = document.createDocumentFragment();
    const heading = document.createElement("div");
    heading.className = "lt-group";
    heading.textContent = "Actions";
    fragment.appendChild(heading);
    const row = document.createElement("div");
    row.className = "lt-actions";
    for (const command of commands2) {
      const button2 = document.createElement("button");
      button2.type = "button";
      button2.className = "lt-btn lt-ghost";
      button2.textContent = command.label;
      button2.addEventListener("click", () => {
        closeSettings();
        command.run();
      });
      row.appendChild(button2);
    }
    fragment.appendChild(row);
    const note = document.createElement("div");
    note.className = "lt-note";
    note.textContent = "These run at once, and discard anything unsaved above.";
    fragment.appendChild(note);
    return fragment;
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
    panel$1?.remove();
    panel$1 = null;
  }
  function openSettings(onSaved2) {
    if (panel$1) {
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
    panel$1 = backdrop;
    const body2 = backdrop.querySelector(".lt-panel-body");
    if (body2) {
      for (const group of GROUPS) {
        const fields = FIELDS.filter((field) => field.group === group);
        if (!fields.length) continue;
        const heading = document.createElement("div");
        heading.className = "lt-group";
        heading.textContent = group;
        body2.appendChild(heading);
        for (const field of fields) body2.appendChild(buildField(field, settings2));
      }
      const actions = buildActions();
      if (actions) body2.appendChild(actions);
    }
    backdrop.addEventListener("click", (event) => {
      const target = event.target;
      if (target === backdrop) return closeSettings();
      if (target.classList.contains("lt-x")) return closeSettings();
      const action = target.dataset["act"];
      if (action === "cancel") return closeSettings();
      if (action === "save") {
        const saved = saveSettings(collect(backdrop));
        closeSettings();
        onSaved2?.(saved);
      } else if (action === "reset") {
        const fresh = resetSettings();
        closeSettings();
        onSaved2?.(fresh);
        openSettings(onSaved2);
      }
      return void 0;
    });
    const onKey = (event) => {
      if (!panel$1) {
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
  let panel = null;
  let body = null;
  let onSettings = null;
  function onReportSettings(open2) {
    onSettings = open2;
  }
  function closeReport() {
    panel?.remove();
    panel = null;
    body = null;
  }
  function openReport(text2) {
    if (body) {
      body.textContent = text2;
      return;
    }
    const backdrop = document.createElement("div");
    backdrop.className = "lt-panel-backdrop";
    backdrop.innerHTML = `
    <div class="lt-panel lt-panel-report" role="dialog" aria-label="Lens Translate diagnostics">
      <header class="lt-panel-head">
        <strong>Diagnostics</strong>
        <button class="lt-x" type="button" aria-label="Close">&times;</button>
      </header>
      <pre class="lt-report"></pre>
      <footer class="lt-panel-foot">
        <button class="lt-btn lt-ghost" type="button" data-act="settings">Settings</button>
        <span class="lt-spacer"></span>
        <button class="lt-btn lt-ghost" type="button" data-act="copy">Copy</button>
        <button class="lt-btn lt-primary" type="button" data-act="close">Close</button>
      </footer>
    </div>`;
    panel = backdrop;
    body = backdrop.querySelector(".lt-report");
    if (body) body.textContent = text2;
    backdrop.addEventListener("click", (event) => {
      const target = event.target;
      if (target === backdrop || target.classList.contains("lt-x")) return closeReport();
      const action = target.dataset["act"];
      if (action === "close") return closeReport();
      if (action === "settings") {
        closeReport();
        onSettings?.();
        return void 0;
      }
      if (action === "copy" && body) {
        const report = body.textContent ?? "";
        void navigator.clipboard?.writeText(report).then(
          () => {
            target.textContent = "Copied";
            window.setTimeout(() => target.textContent = "Copy", 1500);
          },
          () => {
            const range = document.createRange();
            range.selectNodeContents(body);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            target.textContent = "Selected - copy it";
          }
        );
      }
      return void 0;
    });
    uiRoot().appendChild(backdrop);
  }
  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12H18A6,6 0 0,0 12,6V4M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/></svg>`;
  const GEAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="15" height="15"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>`;
  let settings = getSettings();
  setTransport(gmTransport);
  ignoreElements((element) => element.id === HOST_ID || isCover(element));
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
  const showing = /* @__PURE__ */ new Map();
  const isTranslated = (img) => isCovered(img) || hasOverlay(img);
  function undo(img) {
    showing.delete(img);
    const restored = uncoverImage(img) || clearOverlay(img);
    if (restored) button.classList.remove("lt-active");
    return restored;
  }
  async function translate(target) {
    const img = target.element;
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
      const key = cacheKey(target.url, settings);
      const displayedWidth = img.getBoundingClientRect().width;
      if (settings.renderMode === "canvas" && target.url) {
        const done = getRender(renderKey(key, settings, displayedWidth), settings);
        if (done && coverImage(img, URL.createObjectURL(done))) {
          showing.set(img, target);
          if (currentTarget?.element === img) button.classList.add("lt-active");
          return;
        }
      }
      const prepared = await acquireSource(target);
      try {
        let result = target.url ? getCached(key, settings) : void 0;
        const hash = result ? "" : fingerprint(prepared.source, prepared.width, prepared.height);
        if (!result && hash) {
          const remembered = await getStored(hash, settings);
          if (remembered) {
            result = remembered;
            if (target.url) putCached(key, result, settings);
          }
        }
        if (!result) {
          const upload = await encodeForUpload(prepared.source, settings);
          result = await callLens(upload, settings);
          if (target.url) putCached(key, result, settings);
          void putStored(hash, result, settings);
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
          if (target.url) putRender(renderKey(key, settings, displayedWidth), blob, settings);
          const url = URL.createObjectURL(blob);
          if (!coverImage(img, url)) {
            URL.revokeObjectURL(url);
            toast("This image cannot be covered here");
            return;
          }
        } else if (!renderTranslation(
          img,
          result.blocks,
          settings,
          { width: prepared.width, height: prepared.height },
          root
        )) {
          toast("Nothing could be placed on this image");
          return;
        }
        showing.set(img, target);
        if (currentTarget?.element === img) button.classList.add("lt-active");
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
  let currentTarget = null;
  let hideTimer;
  let gearTimer;
  const GEAR_DELAY_MS = 550;
  function showGear(target, anchor) {
    const rect = anchor ?? target.element.getBoundingClientRect();
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
  function showButton(target, anchor) {
    if (!settings.showButton) return;
    const img = target.element;
    currentTarget = target;
    const rect = anchor ?? img.getBoundingClientRect();
    button.style.top = `${rect.top + 5}px`;
    button.style.left = `${rect.left + rect.width - 37}px`;
    button.style.opacity = "1";
    button.style.transform = "scale(1)";
    button.style.pointerEvents = "auto";
    button.classList.toggle("lt-active", isTranslated(img));
    window.clearTimeout(gearTimer);
    if (gear.style.opacity === "1") showGear(target);
    else gearTimer = window.setTimeout(() => showGear(target), GEAR_DELAY_MS);
  }
  function hideButton() {
    button.style.opacity = "0";
    button.style.transform = "scale(0.9)";
    button.style.pointerEvents = "none";
    hideGear();
    currentTarget = null;
  }
  let pinned = false;
  let pinnedFrame = 0;
  let known = [];
  let refreshTimer = 0;
  let tree = null;
  const EMPTY_RETRIES = 8;
  let emptyRetries = 0;
  const REFRESH_DELAY_MS = 250;
  function refresh() {
    known = collect$1(settings.minImageSize);
    updatePinned();
  }
  function somethingChanged() {
    emptyRetries = 0;
    scheduleRefresh();
  }
  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      refresh();
    }, REFRESH_DELAY_MS);
  }
  function visiblePart(element) {
    const rect = element.getBoundingClientRect();
    const left = Math.max(rect.left, 0);
    const top = Math.max(rect.top, 0);
    const width = Math.min(rect.right, window.innerWidth) - left;
    const height = Math.min(rect.bottom, window.innerHeight) - top;
    return { top, left, width: Math.max(0, width), height: Math.max(0, height) };
  }
  function mostVisible() {
    let best = null;
    let bestArea = 0;
    let bestRank = -1;
    for (const target of known) {
      if (!target.element.isConnected) continue;
      if (!isBigEnough(target, settings.minImageSize)) continue;
      const part = visiblePart(target.element);
      const area = part.width * part.height;
      const rank = target.pointable ? 1 : 0;
      if (rank > bestRank || rank === bestRank && area > bestArea) {
        bestRank = rank;
        bestArea = area;
        best = { ...part, target };
      }
    }
    return best;
  }
  function updatePinned() {
    if (!pinned || pinnedFrame) return;
    pinnedFrame = window.requestAnimationFrame(() => {
      pinnedFrame = 0;
      if (!pinned) return;
      const found = settings.showButton ? mostVisible() : null;
      if (!found) {
        hideButton();
        if (emptyRetries < EMPTY_RETRIES) {
          emptyRetries += 1;
          scheduleRefresh();
        }
        return;
      }
      emptyRetries = 0;
      showButton(found.target, found);
      showGear(found.target, found);
    });
  }
  function onImageLoad(event) {
    if (event.target?.tagName === "IMG") somethingChanged();
  }
  const TOUCH_QUERY = "(hover: none), (pointer: coarse)";
  function applyButtonMode() {
    const wanted = settings.buttonMode === "pinned" || settings.buttonMode === "auto" && window.matchMedia(TOUCH_QUERY).matches;
    if (wanted === pinned) return;
    pinned = wanted;
    if (pinned) {
      document.addEventListener("load", onImageLoad, true);
      tree = new MutationObserver(somethingChanged);
      tree.observe(document.documentElement, {
        childList: true,
        subtree: true,
        // A lazily-loaded image is the same element with a new address, and a
        // background only exists in a style, so neither shows up as a new node.
        attributes: true,
        attributeFilter: ["src", "srcset", "style", "class"]
      });
      refresh();
    } else {
      document.removeEventListener("load", onImageLoad, true);
      tree?.disconnect();
      tree = null;
      hideButton();
    }
  }
  document.addEventListener(
    "mouseover",
    (event) => {
      const found = targetFromEvent(event, settings.minImageSize, isOurs);
      if (!found) return;
      window.clearTimeout(hideTimer);
      showButton(found);
    },
    true
  );
  document.addEventListener(
    "mouseout",
    (event) => {
      if (pinned) return;
      if (targetFromEvent(event, settings.minImageSize, isOurs)) {
        hideTimer = window.setTimeout(hideButton, 300);
      }
    },
    true
  );
  for (const control of [button, gear]) {
    control.addEventListener("mouseover", () => window.clearTimeout(hideTimer));
    control.addEventListener("mouseout", () => {
      if (pinned) return;
      hideTimer = window.setTimeout(hideButton, 300);
    });
  }
  async function redrawShowing() {
    const targets2 = [...showing.values()].filter((target) => target.element.isConnected);
    if (!targets2.length) return;
    for (const target of targets2) {
      undo(target.element);
      await translate(target);
    }
  }
  function onSaved(saved) {
    settings = saved;
    applyButtonMode();
    void redrawShowing();
    toast("Settings saved");
  }
  gear.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSettings(onSaved);
    },
    true
  );
  button.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (currentTarget) void translate(currentTarget);
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
      const found = targetFromEvent(event, settings.minImageSize, isOurs);
      if (!found) return;
      event.preventDefault();
      event.stopPropagation();
      void translate(found);
    },
    true
  );
  function reposition() {
    repositionOverlays();
    if (pinned) {
      emptyRetries = 0;
      updatePinned();
      return;
    }
    if (currentTarget?.element.isConnected) {
      showButton(currentTarget);
      if (gear.style.opacity === "1") showGear(currentTarget);
    } else if (currentTarget) hideButton();
  }
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
  registerCommand({
    menuLabel: "Lens Translate: settings",
    // The panel is where these are drawn, so it does not offer to open itself.
    label: null,
    run: () => openSettings(onSaved)
  });
  registerCommand({
    menuLabel: "Lens Translate: clear cache",
    label: "Clear cache",
    run: () => {
      const memory = cacheStats();
      clearCache();
      void storedStats().then(({ entries: entries2, bytes: bytes2 }) => {
        void clearStored();
        const total = memory.entries + entries2;
        toast(
          total ? `Cleared ${total} cached result${total === 1 ? "" : "s"} (${((memory.bytes + bytes2) / 1048576).toFixed(1)} MB)` : "The cache was already empty"
        );
      });
    }
  });
  registerCommand({
    menuLabel: "Lens Translate: undo all on this page",
    label: "Undo all on this page",
    run: () => {
      showing.clear();
      const restored = uncoverAll() + clearAllOverlays();
      toast(restored ? `Restored ${restored} image${restored === 1 ? "" : "s"}` : "Nothing to restore");
    }
  });
  registerCommand({
    menuLabel: "Lens Translate: diagnostics",
    label: "Run diagnostics",
    run: openDiagnostics
  });
  registerCommand({
    menuLabel: "Lens Translate: toggle on/off",
    label: "Toggle on/off",
    run: () => {
      settings = saveSettings({ enabled: !settings.enabled });
      if (!settings.enabled) {
        showing.clear();
        uncoverAll();
        clearAllOverlays();
        hideButton();
      }
      toast(settings.enabled ? "Translation enabled" : "Translation disabled");
    }
  });
  const DEBUG_HASH = "#lens-debug";
  function openDiagnostics() {
    openReport("Probing...");
    void diagnose({ pinned }).then(
      openReport,
      (error) => openReport(`Diagnostics failed: ${error.message}`)
    );
  }
  function checkDebugHash() {
    if (window.location.hash === DEBUG_HASH) openDiagnostics();
  }
  onReportSettings(() => openSettings(onSaved));
  window.addEventListener("hashchange", checkDebugHash);
  applyButtonMode();
  checkDebugHash();
  window.matchMedia(TOUCH_QUERY).addEventListener("change", applyButtonMode);

})();