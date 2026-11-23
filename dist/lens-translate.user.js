// ==UserScript==
// @name         Lens Translate
// @namespace    https://github.com/bropines/chrome-lens-userscript
// @version      2.13.0-beta.2
// @author       bropines
// @description  Hover any image, click the button, and its text is translated in place - rendered the way Chromium's own Lens overlay does it.
// @license      MIT
// @icon         https://lens.google.com/favicon.ico
// @homepage     https://github.com/bropines/chrome-lens-userscript
// @homepageURL  https://github.com/bropines/chrome-lens-userscript
// @source       https://github.com/bropines/chrome-lens-userscript.git
// @supportURL   https://github.com/bropines/chrome-lens-userscript/issues
// @downloadURL  https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.user.js
// @updateURL    https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.meta.js
// @match        *://*/*
// @connect      lensfrontend-pa.googleapis.com
// @connect      *
// @grant        GM.getValue
// @grant        GM.openInTab
// @grant        GM.setClipboard
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
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
  var _GM_openInTab = /* @__PURE__ */ (() => typeof GM_openInTab != "undefined" ? GM_openInTab : void 0)();
  var _GM_registerMenuCommand = /* @__PURE__ */ (() => typeof GM_registerMenuCommand != "undefined" ? GM_registerMenuCommand : void 0)();
  var _GM_setClipboard = /* @__PURE__ */ (() => typeof GM_setClipboard != "undefined" ? GM_setClipboard : void 0)();
  var _GM_setValue = /* @__PURE__ */ (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
  var _GM_xmlhttpRequest = /* @__PURE__ */ (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
  var _unsafeWindow = /* @__PURE__ */ (() => typeof unsafeWindow != "undefined" ? unsafeWindow : void 0)();
  const scriptVersion = () => _GM_info?.script?.version ?? "unknown";
  function hostName() {
    return _GM_info?.scriptHandler ?? "The userscript host";
  }
  const LOCAL_PREFIX = "lens-translate:";
  const hasAsyncStorage = () => typeof _GM_getValue !== "function" && typeof _GM?.getValue === "function";
  const loaded = /* @__PURE__ */ new Map();
  async function preloadStored(keys) {
    if (!hasAsyncStorage()) return false;
    await Promise.all(
      keys.map(async (key) => {
        try {
          loaded.set(key, await _GM.getValue(key, null));
        } catch {
        }
      })
    );
    return true;
  }
  function readStored(key) {
    if (typeof _GM_getValue === "function") return _GM_getValue(key, null);
    if (hasAsyncStorage()) return loaded.get(key) ?? null;
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
    if (typeof _GM?.setValue === "function") {
      loaded.set(key, encoded);
      void Promise.resolve(_GM.setValue(key, encoded)).catch(() => {
      });
      return;
    }
    try {
      window.localStorage.setItem(LOCAL_PREFIX + key, encoded);
    } catch {
    }
  }
  async function copyText(text2) {
    try {
      if (typeof _GM_setClipboard === "function") {
        _GM_setClipboard(text2, "text");
        return true;
      }
      if (typeof _GM?.setClipboard === "function") {
        await _GM.setClipboard(text2, "text");
        return true;
      }
    } catch {
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text2);
        return true;
      }
    } catch {
    }
    try {
      const area = document.createElement("textarea");
      area.value = text2;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }
  function hostOpener() {
    if (typeof _GM_openInTab === "function") return (url) => _GM_openInTab(url, false);
    if (typeof _GM?.openInTab === "function") return (url) => _GM.openInTab(url, false);
    return null;
  }
  function openWindow(url) {
    try {
      const tab = window.open(url, "_blank");
      if (tab) {
        try {
          tab.opener = null;
        } catch {
        }
      }
      return tab ?? null;
    } catch {
      return null;
    }
  }
  function navigate(tab, url) {
    try {
      const link = tab.document.createElement("a");
      link.href = url;
      link.rel = "noreferrer";
      tab.document.body.appendChild(link);
      link.click();
    } catch {
      tab.location.replace(url);
    }
  }
  function prepareTab(preopen) {
    const viaHost = hostOpener();
    if (viaHost) {
      return {
        go(url) {
          try {
            const tab2 = viaHost(url);
            return tab2 !== null && tab2 !== false && tab2?.closed !== true;
          } catch {
            return false;
          }
        },
        cancel() {
        }
      };
    }
    const tab = preopen ? openWindow("about:blank") : null;
    if (tab) {
      try {
        tab.document.title = "Lens";
        tab.document.body.textContent = "Searching with Lens...";
      } catch {
      }
    }
    return {
      go(url) {
        if (!tab || tab.closed) return false;
        try {
          navigate(tab, url);
          return true;
        } catch {
          return false;
        }
      },
      cancel() {
        try {
          tab?.close();
        } catch {
        }
      }
    };
  }
  const commands = [];
  function registerCommand(command, toMenu = true) {
    commands.push(command);
    if (toMenu && typeof _GM_registerMenuCommand === "function") {
      _GM_registerMenuCommand(command.menuLabel, command.run);
    }
  }
  function panelCommands() {
    const out = [];
    for (const command of commands) {
      if (command.label !== null) {
        out.push({ label: command.label, essential: command.essential === true, run: command.run });
      }
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
  function locationOf(headers) {
    const match = /^location:\s*(.+)$/im.exec(headers ?? "");
    return match?.[1]?.trim() ?? "";
  }
  function timedOut() {
    const error = new Error("Timed out");
    error.name = "TimeoutError";
    return error;
  }
  function sendViaGm(attempt) {
    return new Promise((resolve2, reject) => {
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
          const location2 = locationOf(response.responseHeaders);
          resolve2({
            status: response.status,
            bytes: bytes2,
            contentType: contentTypeOf(response.responseHeaders),
            ...location2 ? { location: location2 } : {}
          });
        })();
      };
      const data = attempt.body === null ? void 0 : attempt.encoding === "typed" ? attempt.body : toLatin1(attempt.body);
      request({
        method: attempt.method,
        url: attempt.url,
        headers: attempt.headers,
        ...attempt.withCookies === void 0 ? {} : { anonymous: !attempt.withCookies },
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
    return climb({ ...options, method: "POST", encoding: "typed", withCookies: false }, true);
  }
  const MAX_REDIRECTS = 5;
  function isWebPage(response) {
    if (/^image\//i.test(response.contentType)) return false;
    if (/text\/html/i.test(response.contentType)) return true;
    for (const byte of response.bytes) {
      if (byte === 32 || byte === 9 || byte === 10 || byte === 13) continue;
      return byte === 60;
    }
    return false;
  }
  async function getBinary(url, timeoutMs, options = {}) {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await getOnce(current, timeoutMs, options);
      const redirected = response.status >= 300 && response.status < 400;
      if ((redirected || isWebPage(response)) && response.location) {
        current = new URL(response.location, current).href;
        continue;
      }
      if (redirected || isWebPage(response)) {
        try {
          const page = await sendViaFetch({
            method: "GET",
            url: current,
            headers: {},
            body: null,
            encoding: "typed",
            timeoutMs
          });
          if (page.status < 400 && !isWebPage(page)) return page;
        } catch {
        }
        throw new Error(`the image host answered with a web page, not a picture (HTTP ${response.status})`);
      }
      const { location: _location, ...plain } = response;
      return plain;
    }
    throw new Error(`the image host redirected more than ${MAX_REDIRECTS} times`);
  }
  function getOnce(url, timeoutMs, options) {
    return climb(
      {
        method: "GET",
        url,
        // `Referer` is a forbidden header for a page fetch and a perfectly good
        // one for a privileged request, which is the whole reason to be here.
        headers: options.referer ? { Referer: options.referer } : {},
        body: null,
        encoding: "typed",
        timeoutMs,
        // The same request the <img> would have made, cookies included.
        withCookies: true
      },
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
        has("getValue", _GM_getValue ?? _GM?.getValue),
        has("setValue", _GM_setValue ?? _GM?.setValue),
        has("registerMenuCommand", _GM_registerMenuCommand),
        has("openInTab", _GM_openInTab ?? _GM?.openInTab)
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
  function splitList(value) {
    const parts = [];
    let depth = 0;
    let quote = "";
    let start2 = 0;
    for (let at = 0; at < value.length; at += 1) {
      const char = value.charAt(at);
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 0) {
        parts.push(value.slice(start2, at).trim());
        start2 = at + 1;
      }
    }
    parts.push(value.slice(start2).trim());
    return parts;
  }
  function urlOf(layer) {
    const match = /^url\((['"]?)(.*?)\1\)$/.exec(layer.trim());
    return match?.[2] ?? "";
  }
  const NUMBER = "(-?\\d*\\.?\\d+)";
  const PLAIN = new RegExp(`^${NUMBER}(px|%)?$`);
  const CALC = new RegExp(`^calc\\(\\s*${NUMBER}(px|%)\\s*([+-])\\s*${NUMBER}(px|%)\\s*\\)$`);
  function lengthOf(value) {
    const text2 = value.trim();
    const plain = PLAIN.exec(text2);
    if (plain) {
      const amount = Number(plain[1]);
      return plain[2] === "%" ? { px: 0, pct: amount } : { px: amount, pct: 0 };
    }
    const calc = CALC.exec(text2);
    if (calc) {
      const first = Number(calc[1]);
      const sign = calc[3] === "-" ? -1 : 1;
      const second = sign * Number(calc[4]);
      if (calc[2] === calc[5]) return null;
      return calc[2] === "%" ? { pct: first, px: second } : { px: first, pct: second };
    }
    return null;
  }
  function dimensionOf(value) {
    const text2 = value.trim();
    if (text2 === "auto") return "auto";
    const plain = PLAIN.exec(text2);
    if (!plain) return null;
    const amount = Number(plain[1]);
    return plain[2] === "%" ? { pct: amount } : { px: amount };
  }
  const boxOf = (value, fallback) => value === "border-box" || value === "padding-box" || value === "content-box" ? value : fallback;
  function parseBackground$1(raw) {
    const layers = splitList(raw.image);
    const index = layers.findIndex((layer) => {
      const url2 = urlOf(layer);
      return url2 !== "" && !url2.startsWith("#");
    });
    if (index < 0) return null;
    const url = urlOf(layers[index] ?? "");
    const at = (list) => {
      const entries2 = splitList(list);
      return entries2[index % Math.max(1, entries2.length)] ?? "";
    };
    if (at(raw.attachment) === "fixed") return null;
    const clipValue = at(raw.clip);
    if (clipValue === "text") return null;
    const sizeText = at(raw.size).trim() || "auto";
    let size;
    if (sizeText === "cover" || sizeText === "contain") size = { kind: sizeText };
    else {
      const tokens = sizeText.split(/\s+(?![^(]*\))/);
      const width = dimensionOf(tokens[0] ?? "auto");
      const height = dimensionOf(tokens[1] ?? "auto");
      if (!width || !height) return null;
      size = { kind: "lengths", width, height };
    }
    const x = lengthOf(at(raw.positionX));
    const y = lengthOf(at(raw.positionY));
    if (!x || !y) return null;
    const [first = "repeat", second] = at(raw.repeat).trim().split(/\s+/);
    if ([first, second].some((word) => word === "space" || word === "round")) return null;
    const repeatX = second === void 0 ? first === "repeat" || first === "repeat-x" : first === "repeat";
    const repeatY = second === void 0 ? first === "repeat" || first === "repeat-y" : second === "repeat";
    return {
      url,
      spec: {
        size,
        x,
        y,
        repeatX,
        repeatY,
        origin: boxOf(at(raw.origin), "padding-box"),
        clip: boxOf(clipValue, "border-box")
      }
    };
  }
  const resolve = (dimension, of) => dimension === "auto" ? null : "px" in dimension ? dimension.px : dimension.pct / 100 * of;
  function paintedSize(spec, area, natural) {
    if (!(natural.width > 0 && natural.height > 0)) return null;
    if (spec.size.kind !== "lengths") {
      const fit = spec.size.kind === "cover" ? Math.max : Math.min;
      const scale = fit(area.width / natural.width, area.height / natural.height);
      return { width: natural.width * scale, height: natural.height * scale };
    }
    const width = resolve(spec.size.width, area.width);
    const height = resolve(spec.size.height, area.height);
    if (width !== null && height !== null) return { width, height };
    if (width !== null) return { width, height: width * natural.height / natural.width };
    if (height !== null) return { width: height * natural.width / natural.height, height };
    return { width: natural.width, height: natural.height };
  }
  function paintRect(spec, area, natural) {
    const size = paintedSize(spec, area, natural);
    if (!size || !(size.width > 0 && size.height > 0)) return null;
    return {
      x: (area.width - size.width) * spec.x.pct / 100 + spec.x.px,
      y: (area.height - size.height) * spec.y.pct / 100 + spec.y.px,
      width: size.width,
      height: size.height
    };
  }
  const EPSILON = 1;
  function tilesVisibly(spec, rect, area) {
    const coversX = rect.x <= EPSILON && rect.x + rect.width >= area.width - EPSILON;
    const coversY = rect.y <= EPSILON && rect.y + rect.height >= area.height - EPSILON;
    return spec.repeatX && !coversX || spec.repeatY && !coversY;
  }
  function mayBePicture(spec, area) {
    if (!spec.repeatX && !spec.repeatY) return true;
    if (spec.size.kind === "cover") return true;
    if (spec.size.kind === "contain") return false;
    const { width, height } = spec.size;
    const fills = (dimension, of) => {
      const length = resolve(dimension, of);
      return length !== null && length >= of - EPSILON;
    };
    return (!spec.repeatX || fills(width, area.width)) && (!spec.repeatY || fills(height, area.height));
  }
  function knownPaintedSize(spec, area) {
    if (spec.size.kind === "lengths") {
      const width = resolve(spec.size.width, area.width);
      const height = resolve(spec.size.height, area.height);
      if (width !== null && height !== null) return { width, height };
    }
    return null;
  }
  let ignored = () => false;
  function ignoreElements(predicate) {
    ignored = predicate;
  }
  function backgroundOf(element) {
    if (element.tagName === "BODY" || element.tagName === "HTML") return null;
    const style = window.getComputedStyle(element);
    const image = style.backgroundImage;
    if (!image || image === "none") return null;
    const parsed = parseBackground$1({
      image,
      size: style.backgroundSize,
      positionX: style.backgroundPositionX,
      positionY: style.backgroundPositionY,
      repeat: style.backgroundRepeat,
      origin: style.backgroundOrigin,
      clip: style.backgroundClip,
      attachment: style.backgroundAttachment
    });
    if (!parsed) return null;
    return mayBePicture(parsed.spec, { width: element.offsetWidth, height: element.offsetHeight }) ? parsed : null;
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
        const background = backgroundOf(element);
        return background ? { element, kind: "background", url: background.url, pointable, background: background.spec } : null;
      }
    }
  }
  function isBigEnough(target, minSize) {
    const rect = target.element.getBoundingClientRect();
    if (!(rect.width >= minSize && rect.height >= minSize)) return false;
    const painted = target.background && knownPaintedSize(target.background, { width: rect.width, height: rect.height });
    return !painted || painted.width >= minSize && painted.height >= minSize;
  }
  function* walk(root) {
    for (const element of root.querySelectorAll("*")) {
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
  const MIN_OPACITY = 40;
  const MAX_OPACITY = 100;
  const OPACITY_STEP = 5;
  function clampOpacity(raw) {
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value)) return MAX_OPACITY;
    const snapped = Math.round(value / OPACITY_STEP) * OPACITY_STEP;
    return Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, snapped));
  }
  const STORAGE_KEY = "lens-translate:settings";
  const SETTINGS_KEYS = [STORAGE_KEY];
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
    batchHotkey: true,
    peekKey: "off",
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
    textAlign: "auto",
    uiMode: "simple",
    aiPrompt: "What is in this picture?",
    frames: true,
    popupOpacity: MAX_OPACITY
  };
  const GROUPS = [
    "Interface",
    "Languages",
    "Layout",
    "Erasing the original",
    "Legibility",
    "Behaviour",
    "Advanced"
  ];
  const FIELDS = [
    {
      key: "uiMode",
      group: "Interface",
      essential: true,
      label: "Interface",
      type: "select",
      options: [
        ["simple", "simple - translate, search, ask, copy"],
        ["pro", "pro - areas, objects, text picking, every setting"]
      ]
    },
    {
      key: "aiPrompt",
      group: "Interface",
      label: "Default AI question",
      type: "text",
      hint: 'what the "Ask AI" field starts with; blank sends the picture alone'
    },
    {
      key: "popupOpacity",
      group: "Interface",
      essential: true,
      label: "Popup opacity",
      type: "range",
      min: String(MIN_OPACITY),
      max: String(MAX_OPACITY),
      step: String(OPACITY_STEP),
      unit: "pct",
      hint: "the menu, settings and messages; below 100 the picture shows through, blurred"
    },
    { key: "enabled", group: "Behaviour", essential: true, label: "Translation enabled", type: "checkbox" },
    {
      key: "frames",
      group: "Behaviour",
      label: "Work inside frames",
      type: "checkbox",
      hint: "for readers and galleries that show pages in an iframe; small frames such as ads are always left alone"
    },
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
    { key: "targetLang", group: "Languages", essential: true, label: "Translate to", type: "select", options: languageOptions() },
    {
      key: "sourceLang",
      group: "Languages",
      essential: true,
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
      essential: true,
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
    { key: "showButton", group: "Behaviour", label: "Show the button over images", type: "checkbox" },
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
      key: "batchHotkey",
      group: "Behaviour",
      label: "Alt + Shift + T translates all in view",
      type: "checkbox",
      hint: "every picture currently on screen; also in the userscript menu and Actions below"
    },
    {
      key: "peekKey",
      group: "Behaviour",
      label: "Hold to see the original",
      type: "select",
      options: [
        ["off", "off - holding the button down still works"],
        ["backquote", "` (backtick), held"],
        ["shift", "Shift, held"],
        ["control", "Ctrl, held"]
      ],
      hint: "while held, every translation steps aside; let go and it is back"
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
      essential: true,
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
      let stored2 = {};
      try {
        const raw = readStored(STORAGE_KEY);
        if (typeof raw === "string") stored2 = JSON.parse(raw);
        else if (raw && typeof raw === "object") stored2 = raw;
      } catch {
        stored2 = {};
      }
      cache = { ...DEFAULTS, ...stored2 };
    }
    return cache;
  }
  function reloadSettings() {
    cache = null;
    return getSettings();
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
    if (field.key === "popupOpacity") return clampOpacity(raw);
    if (field.key === "uiMode") return raw === "pro" ? "pro" : "simple";
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
      rotationZ: 5,
      coordinateType: 6
    },
    ClientImage: {
      imageContent: 1
    },
    DeepGleamData: {
      translation: 10
    },
    Geometry: {
      boundingBox: 1
    },
    ImageCrop: {
      image: 2,
      zoomedCrop: 3
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
    LensOverlayInteractionRequest: {
      requestContext: 1,
      interactionRequestMetadata: 2,
      imageCrop: 3
    },
    LensOverlayInteractionRequestMetadata: {
      type: 1,
      selectionMetadata: 2,
      queryMetadata: 4
    },
    LensOverlayInteractionRequestMetadata_QueryMetadata: {
      textQuery: 2
    },
    LensOverlayInteractionRequestMetadata_SelectionMetadata: {
      region: 2,
      object: 3
    },
    LensOverlayInteractionRequestMetadata_SelectionMetadata_Object: {
      objectId: 1
    },
    LensOverlayInteractionRequestMetadata_SelectionMetadata_Region: {
      region: 1
    },
    LensOverlayObjectsRequest: {
      requestContext: 1,
      imageData: 3
    },
    LensOverlayObjectsResponse: {
      overlayObjects: 2,
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
      imageSequenceId: 3,
      analyticsId: 4,
      longContextId: 9,
      routingInfo: 6,
      timeUsec: 7,
      contextId: 12
    },
    LensOverlayServerClusterInfoRequest: {
      enableSearchSessionId: 1,
      surface: 2,
      platform: 3,
      renderingContext: 4
    },
    LensOverlayServerClusterInfoResponse: {
      serverSessionId: 1,
      searchSessionId: 2,
      routingInfo: 3
    },
    LensOverlayServerError: {
      errorType: 1
    },
    LensOverlayServerRequest: {
      objectsRequest: 1,
      interactionRequest: 2
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
    OverlayObject: {
      id: 1,
      geometry: 2
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
    TextQuery: {
      query: 1
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
    },
    ZoomedCrop: {
      crop: 1,
      parentWidth: 2,
      parentHeight: 3,
      zoom: 4
    }
  };
  const Wire = {
    Varint: 0,
    Fixed64: 1,
    Length: 2,
    Fixed32: 5
  };
  function encodeVarint(value) {
    if (typeof value === "number" && !Number.isInteger(value)) {
      throw new RangeError(`${value} is not an integer, so it has no varint encoding`);
    }
    let v = BigInt.asUintN(64, BigInt(value));
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
      float(field, value) {
        if (!value) return self;
        const out = new Uint8Array(4);
        new DataView(out.buffer).setFloat32(0, value, true);
        return self.tag(field, Wire.Fixed32).raw(out);
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
  const MAX_VARINT_BYTES = 10;
  function decode(buf) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const out = {};
    let p = 0;
    const readVarint = () => {
      let shift = 0n;
      let result = 0n;
      for (let read = 0; read < MAX_VARINT_BYTES; read += 1) {
        const byte = buf[p++];
        if (byte === void 0) throw new Error("Truncated protobuf varint");
        result |= BigInt(byte & 127) << shift;
        if (!(byte & 128)) return result;
        shift += 7n;
      }
      throw new Error(`Malformed protobuf varint at byte ${p}: longer than ${MAX_VARINT_BYTES} bytes`);
    };
    const need = (count, what) => {
      if (count < 0 || p + count > buf.length) {
        throw new Error(
          `Truncated protobuf ${what}: needs ${count} bytes at byte ${p}, ${buf.length - p} left`
        );
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
          need(8, "fixed64");
          value = view.getFloat64(p, true);
          p += 8;
          break;
        case Wire.Length: {
          const length = Number(readVarint());
          need(length, "length-delimited field");
          value = buf.subarray(p, p + length);
          p += length;
          break;
        }
        case Wire.Fixed32:
          need(4, "fixed32");
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
  function writeClientContext(client, settings, translate) {
    client.int(F.LensOverlayClientContext.platform, PLATFORM_WEB);
    client.int(F.LensOverlayClientContext.surface, SURFACE_CHROMIUM);
    client.sub(
      F.LensOverlayClientContext.localeContext,
      (locale) => locale.str(F.LocaleContext.language, settings.ocrLang || settings.targetLang).str(F.LocaleContext.region, settings.region).str(F.LocaleContext.timeZone, settings.timeZone)
    );
    client.sub(
      F.LensOverlayClientContext.clientFilters,
      (filters) => filters.sub(F.AppliedFilters.filter, (filter) => {
        if (!translate) {
          filter.int(F.AppliedFilter.filterType, FILTER_AUTO);
          return;
        }
        filter.int(F.AppliedFilter.filterType, FILTER_TRANSLATE);
        filter.sub(
          F.AppliedFilter.translate,
          (t) => t.str(F.AppliedFilter_Translate.targetLanguage, settings.targetLang).str(F.AppliedFilter_Translate.sourceLanguage, settings.sourceLang)
        );
      })
    );
    client.sub(
      F.LensOverlayClientContext.renderingContext,
      (rendering) => rendering.int(F.RenderingContext.renderingEnvironment, RENDERING_ENV_LENS_OVERLAY)
    );
  }
  function writeImageData(data, image) {
    data.sub(F.ImageData.payload, (payload) => payload.bytes(F.ImagePayload.imageBytes, image.imageBytes));
    data.sub(
      F.ImageData.imageMetadata,
      (meta) => meta.int(F.ImageMetadata.width, image.width).int(F.ImageMetadata.height, image.height)
    );
  }
  function buildRequest(image, settings) {
    return writer().sub(F.LensOverlayServerRequest.objectsRequest, (objects) => {
      objects.sub(F.LensOverlayObjectsRequest.requestContext, (ctx) => {
        ctx.sub(
          F.LensOverlayRequestContext.requestId,
          (id) => id.int(F.LensOverlayRequestId.uuid, randomUuid()).int(F.LensOverlayRequestId.sequenceId, 1).int(F.LensOverlayRequestId.imageSequenceId, 1)
        );
        ctx.sub(
          F.LensOverlayRequestContext.clientContext,
          (client) => writeClientContext(client, settings, Boolean(settings.targetLang))
        );
      });
      objects.sub(F.LensOverlayObjectsRequest.imageData, (data) => writeImageData(data, image));
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
  async function callLens(image, settings) {
    const response = await getTransport().post({
      url: LENS_ENDPOINT,
      headers: {
        "Content-Type": "application/x-protobuf",
        "X-Goog-Api-Key": settings.apiKey
      },
      body: buildRequest(image, settings),
      timeoutMs: settings.timeoutMs
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
      response = await transport.get(url, IMAGE_TIMEOUT_MS, {
        ...typeof location === "undefined" ? {} : { referer: location.href }
      });
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
    const settings = getSettings();
    return [
      [
        "lens",
        {
          url: LENS_ENDPOINT,
          method: "POST",
          headers: {
            "Content-Type": "application/x-protobuf",
            "X-Goog-Api-Key": settings.apiKey
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
  const CLUSTER_INFO_ENDPOINT = "https://lensfrontend-pa.googleapis.com/v1/gsessionid";
  const RESULTS_URL = "https://www.google.com/search";
  const SESSION_LIFETIME_MS = 1800 * 1e3;
  const SESSION_MARGIN_MS = 60 * 1e3;
  const COORDINATE_NORMALIZED = 1;
  const INTERACTION_TAP = 1;
  const INTERACTION_REGION_SEARCH = 4;
  function randomBytes(n) {
    const out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
  }
  function writeRequestId(w, id, routingInfo) {
    w.int(F.LensOverlayRequestId.uuid, id.uuid).int(F.LensOverlayRequestId.sequenceId, id.sequenceId).int(F.LensOverlayRequestId.imageSequenceId, id.imageSequenceId).bytes(F.LensOverlayRequestId.analyticsId, id.analyticsId).int(F.LensOverlayRequestId.longContextId, 1).bytes(F.LensOverlayRequestId.routingInfo, routingInfo ?? void 0).int(F.LensOverlayRequestId.timeUsec, BigInt(Date.now()) * 1000n).int(F.LensOverlayRequestId.contextId, id.contextId);
  }
  function base64Url(data) {
    let binary = "";
    for (const byte of data) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function post(url, body2, settings) {
    const response = await getTransport().post({
      url,
      headers: { "Content-Type": "application/x-protobuf", "X-Goog-Api-Key": settings.apiKey },
      body: body2,
      timeoutMs: settings.timeoutMs
    });
    return decode(response.bytes);
  }
  async function openSession(settings) {
    const body2 = writer().int(F.LensOverlayServerClusterInfoRequest.enableSearchSessionId, 1).int(F.LensOverlayServerClusterInfoRequest.surface, SURFACE_CHROMIUM).int(F.LensOverlayServerClusterInfoRequest.platform, PLATFORM_WEB).sub(
      F.LensOverlayServerClusterInfoRequest.renderingContext,
      (r) => r.int(F.RenderingContext.renderingEnvironment, RENDERING_ENV_LENS_OVERLAY)
    ).finish();
    const response = await post(CLUSTER_INFO_ENDPOINT, body2, settings);
    const ids = {
      serverSessionId: text(response, F.LensOverlayServerClusterInfoResponse.serverSessionId),
      searchSessionId: text(response, F.LensOverlayServerClusterInfoResponse.searchSessionId),
      routingInfo: bytes(response, F.LensOverlayServerClusterInfoResponse.routingInfo),
      openedAt: Date.now()
    };
    if (!ids.serverSessionId || !ids.searchSessionId) {
      throw new Error("Lens did not open a search session");
    }
    return ids;
  }
  function parseObjects(raw) {
    const objects = sub(decode(raw), F.LensOverlayServerResponse.objectsResponse);
    return subs(objects, F.LensOverlayObjectsResponse.overlayObjects).map((object) => ({
      id: text(object, F.OverlayObject.id),
      geometry: parseGeometry(sub(object, F.OverlayObject.geometry))
    })).filter((object) => object.id);
  }
  function writeBox(w, box) {
    w.float(F.CenterRotatedBox.centerX, box.cx).float(F.CenterRotatedBox.centerY, box.cy).float(F.CenterRotatedBox.width, box.w).float(F.CenterRotatedBox.height, box.h).int(F.CenterRotatedBox.coordinateType, COORDINATE_NORMALIZED);
  }
  const WHOLE = { cx: 0.5, cy: 0.5, w: 1, h: 1 };
  function clampBox(box) {
    const x0 = Math.max(0, box.cx - box.w / 2);
    const y0 = Math.max(0, box.cy - box.h / 2);
    const x1 = Math.min(1, box.cx + box.w / 2);
    const y1 = Math.min(1, box.cy + box.h / 2);
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }
  function buildSearchUrl(searchSessionId, vsrid, options = {}) {
    const mode = options.mode ?? "visual";
    const query = options.text?.trim() ?? "";
    const multimodal = Boolean(query) || mode === "ai";
    const udm = mode === "ai" ? "50" : multimodal ? "24" : "26";
    const params = new URLSearchParams({
      q: query,
      lns_mode: multimodal ? "mu" : "un",
      lns_fp: "1",
      lns_surface: "42",
      gsessionid: searchSessionId,
      udm,
      vsrid,
      source: "chrome.cr.ctxi"
    });
    if (options.uiLanguage) params.set("hl", options.uiLanguage);
    if (options.dark !== void 0) params.set("cs", options.dark ? "1" : "0");
    return `${RESULTS_URL}?${params.toString()}`;
  }
  function textSearchUrl(words, options = {}) {
    const params = new URLSearchParams({ q: words.trim(), lns_fp: "1", lns_mode: "text", lns_surface: "42" });
    if (options.uiLanguage) params.set("hl", options.uiLanguage);
    if (options.dark !== void 0) params.set("cs", options.dark ? "1" : "0");
    return `${RESULTS_URL}?${params.toString()}`;
  }
  class ImageSearch {
    constructor(image, settings) {
      this.image = image;
      this.settings = settings;
    }
    image;
    settings;
    /** The objects Lens detected, normalised to the picture. */
    objects = [];
    /** OCR from the same upload; a search asks for no translation. */
    result = { contentLanguage: "", ocr: [], blocks: [] };
    ids = null;
    uuid = randomUuid();
    contextId = randomUuid();
    sequence = 0;
    /**
     * Every request goes through this chain, one at a time. The sequence numbers
     * are a counter, and two searches interleaving their requests would number
     * them 2,3,4,5 in the wrong order - or, on an expired session, both reopen it.
     */
    queue = Promise.resolve();
    static async upload(image, settings) {
      const search = new ImageSearch(image, settings);
      await search.start();
      return search;
    }
    /** Whether the session behind this upload is still good. */
    get fresh() {
      return Boolean(this.ids) && Date.now() - (this.ids?.openedAt ?? 0) < SESSION_LIFETIME_MS - SESSION_MARGIN_MS;
    }
    static endpoint(ids) {
      return `${LENS_ENDPOINT}?gsessionid=${encodeURIComponent(ids.serverSessionId)}`;
    }
    nextId(analyticsId) {
      this.sequence += 1;
      return {
        uuid: this.uuid,
        sequenceId: this.sequence,
        imageSequenceId: 1,
        analyticsId,
        contextId: this.contextId
      };
    }
    /**
     * Open a session and upload the picture into it.
     *
     * Nothing is kept until the upload has succeeded: a session whose upload
     * failed has no picture in it, and searching it would mint URLs that show
     * nothing.
     */
    async start() {
      const ids = await openSession(this.settings);
      const uuid = randomUuid();
      const contextId = randomUuid();
      const id = { uuid, sequenceId: 1, imageSequenceId: 1, analyticsId: randomBytes(16), contextId };
      const routing = ids.routingInfo;
      const body2 = writer().sub(F.LensOverlayServerRequest.objectsRequest, (objects) => {
        objects.sub(F.LensOverlayObjectsRequest.requestContext, (ctx) => {
          ctx.sub(F.LensOverlayRequestContext.requestId, (w) => writeRequestId(w, id, routing));
          ctx.sub(
            F.LensOverlayRequestContext.clientContext,
            (client) => writeClientContext(client, this.settings, false)
          );
        });
        objects.sub(F.LensOverlayObjectsRequest.imageData, (data) => writeImageData(data, this.image));
      }).finish();
      const response = await getTransport().post({
        url: ImageSearch.endpoint(ids),
        headers: { "Content-Type": "application/x-protobuf", "X-Goog-Api-Key": this.settings.apiKey },
        body: body2,
        timeoutMs: this.settings.timeoutMs
      });
      const result = parseResponse(response.bytes);
      this.result = result;
      this.objects = parseObjects(response.bytes);
      this.ids = ids;
      this.uuid = uuid;
      this.contextId = contextId;
      this.sequence = 1;
    }
    /**
     * Describe a selection to Lens and return the results URL for it.
     *
     * Chrome builds the URL as soon as the interaction is *sent*, but the page
     * resolves `vsrid` against the interaction, so this waits for the answer:
     * opening the page first would race the request it names.
     */
    search(selection, options = {}) {
      const run = this.queue.then(() => this.searchNow(selection, options));
      this.queue = run.catch(() => void 0);
      return run;
    }
    async searchNow(selection, options) {
      if (!this.fresh) await this.start();
      const ids = this.ids;
      if (!ids) throw new Error("Lens did not open a search session");
      const analytics = randomBytes(16);
      const interactionId = this.nextId(analytics);
      const routing = ids.routingInfo;
      const query = options.text?.trim() ?? "";
      const body2 = writer().sub(F.LensOverlayServerRequest.interactionRequest, (interaction) => {
        interaction.sub(F.LensOverlayInteractionRequest.requestContext, (ctx) => {
          ctx.sub(F.LensOverlayRequestContext.requestId, (w) => writeRequestId(w, interactionId, routing));
          ctx.sub(
            F.LensOverlayRequestContext.clientContext,
            (client) => writeClientContext(client, this.settings, false)
          );
        });
        interaction.sub(F.LensOverlayInteractionRequest.interactionRequestMetadata, (meta) => {
          if (selection.kind === "object") {
            meta.int(F.LensOverlayInteractionRequestMetadata.type, INTERACTION_TAP);
            meta.sub(
              F.LensOverlayInteractionRequestMetadata.selectionMetadata,
              (s) => s.sub(
                F.LensOverlayInteractionRequestMetadata_SelectionMetadata.object,
                (o) => o.str(F.LensOverlayInteractionRequestMetadata_SelectionMetadata_Object.objectId, selection.id)
              )
            );
          } else {
            const box = selection.kind === "region" ? clampBox(selection.box) : WHOLE;
            meta.int(F.LensOverlayInteractionRequestMetadata.type, INTERACTION_REGION_SEARCH);
            meta.sub(
              F.LensOverlayInteractionRequestMetadata.selectionMetadata,
              (s) => s.sub(
                F.LensOverlayInteractionRequestMetadata_SelectionMetadata.region,
                (r) => r.sub(F.LensOverlayInteractionRequestMetadata_SelectionMetadata_Region.region, (b) => writeBox(b, box))
              )
            );
          }
          if (query) {
            meta.sub(
              F.LensOverlayInteractionRequestMetadata.queryMetadata,
              (q) => q.sub(
                F.LensOverlayInteractionRequestMetadata_QueryMetadata.textQuery,
                (t) => t.str(F.TextQuery.query, query)
              )
            );
          }
        });
        if (selection.kind !== "object") {
          const box = selection.kind === "region" ? clampBox(selection.box) : WHOLE;
          const crop = selection.kind === "region" && selection.crop ? selection.crop : null;
          interaction.sub(F.LensOverlayInteractionRequest.imageCrop, (c) => {
            c.sub(
              F.ImageCrop.image,
              (img) => img.bytes(F.ClientImage.imageContent, crop ? crop.bytes : this.image.imageBytes)
            );
            c.sub(F.ImageCrop.zoomedCrop, (z) => {
              z.sub(F.ZoomedCrop.crop, (b) => writeBox(b, box));
              z.int(F.ZoomedCrop.parentWidth, this.image.width).int(F.ZoomedCrop.parentHeight, this.image.height).float(F.ZoomedCrop.zoom, 1);
            });
          });
        }
      }).finish();
      const response = await getTransport().post({
        url: ImageSearch.endpoint(ids),
        headers: { "Content-Type": "application/x-protobuf", "X-Goog-Api-Key": this.settings.apiKey },
        body: body2,
        timeoutMs: this.settings.timeoutMs
      });
      const error = sub(decode(response.bytes), F.LensOverlayServerResponse.error);
      const errorType = error ? num(error, F.LensOverlayServerError.errorType) : 0;
      if (errorType) throw new Error(`Lens returned server error type ${errorType}`);
      const urlId = this.nextId(analytics);
      const vsrid = base64Url(requestIdBytes(urlId, routing));
      return buildSearchUrl(ids.searchSessionId, vsrid, options);
    }
  }
  function requestIdBytes(id, routingInfo) {
    const w = writer();
    writeRequestId(w, id, routingInfo);
    return w.finish();
  }
  function translationText(result) {
    return result.blocks.map((block) => block.translation.trim()).filter(Boolean).join("\n\n");
  }
  function ocrText(result) {
    return result.ocr.map(
      (paragraph) => paragraph.lines.map((line) => line.text.trim()).filter(Boolean).join("\n")
    ).filter(Boolean).join("\n\n");
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
  async function encodeForUpload(source, settings, release2 = () => {
  }) {
    const natural = sourceSize(source);
    const { width, height } = targetSize(natural.width, natural.height, settings);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2d canvas context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    const jpeg = await new Promise((resolve2, reject) => {
      try {
        canvas.toBlob(resolve2, "image/jpeg", settings.jpegQuality);
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
      release: release2
    };
  }
  async function encodeRegion(image, box, settings) {
    const W = image.sourceWidth;
    const H = image.sourceHeight;
    const sx = Math.max(0, Math.floor((box.cx - box.w / 2) * W));
    const sy = Math.max(0, Math.floor((box.cy - box.h / 2) * H));
    const sw = Math.max(1, Math.min(W - sx, Math.ceil(box.w * W)));
    const sh = Math.max(1, Math.min(H - sy, Math.ceil(box.h * H)));
    const { width, height } = targetSize(sw, sh, settings);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2d canvas context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image.source, sx, sy, sw, sh, 0, 0, width, height);
    const jpeg = await new Promise((resolve2, reject) => {
      try {
        canvas.toBlob(resolve2, "image/jpeg", settings.jpegQuality);
      } catch (e) {
        reject(e);
      }
    });
    if (!jpeg) throw new Error("Canvas is tainted");
    return { bytes: new Uint8Array(await jpeg.arrayBuffer()), width, height };
  }
  function loadWithCors(url) {
    return new Promise((resolve2, reject) => {
      const probe2 = new Image();
      probe2.crossOrigin = "anonymous";
      probe2.decoding = "sync";
      probe2.onload = () => resolve2(probe2);
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
  const DB_VERSION = 2;
  const RESPONSES = "responses";
  const META = "meta";
  let open = null;
  function database() {
    if (open) return open;
    open = new Promise((resolve2) => {
      let request2;
      try {
        request2 = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve2(null);
        return;
      }
      request2.onupgradeneeded = () => {
        const db = request2.result;
        if (db.objectStoreNames.contains(RESPONSES)) db.deleteObjectStore(RESPONSES);
        if (db.objectStoreNames.contains(META)) db.deleteObjectStore(META);
        db.createObjectStore(RESPONSES, { keyPath: "key" });
        db.createObjectStore(META, { keyPath: "key" }).createIndex("used", "used");
      };
      request2.onsuccess = () => {
        const db = request2.result;
        db.onversionchange = () => {
          db.close();
          open = null;
        };
        resolve2(db);
      };
      request2.onerror = () => resolve2(null);
      request2.onblocked = () => resolve2(null);
    });
    return open;
  }
  function transact(mode, stores, body2) {
    return database().then(
      (db) => new Promise((resolve2) => {
        if (!db) {
          resolve2(false);
          return;
        }
        try {
          const tx = db.transaction(stores, mode);
          tx.oncomplete = () => resolve2(true);
          tx.onabort = () => resolve2(false);
          tx.onerror = () => resolve2(false);
          body2(tx);
        } catch {
          resolve2(false);
        }
      })
    );
  }
  const languagesOf = (settings) => [settings.targetLang, settings.sourceLang, settings.ocrLang].join("|");
  const entryKey = (hash, settings) => `${hash}\0${languagesOf(settings)}`;
  function weigh$1(result) {
    let bytes2 = 0;
    for (const block of result.blocks) {
      bytes2 += block.translation.length * 2;
      for (const line of block.lines) bytes2 += line.background?.bytes.byteLength ?? 0;
    }
    return bytes2;
  }
  const TOUCH_INTERVAL_MS = 6e4;
  const lastTouched = /* @__PURE__ */ new Map();
  async function getStored(hash, settings) {
    if (!hash || !settings.persistCache) return null;
    const key = entryKey(hash, settings);
    let entry;
    await transact("readonly", [RESPONSES], (tx) => {
      const request2 = tx.objectStore(RESPONSES).get(key);
      request2.onsuccess = () => {
        entry = request2.result;
      };
    });
    if (!entry) return null;
    const now = Date.now();
    if (now - (lastTouched.get(key) ?? 0) >= TOUCH_INTERVAL_MS) {
      lastTouched.set(key, now);
      const meta = { key, used: now, bytes: entry.bytes };
      void transact("readwrite", [META], (tx) => {
        tx.objectStore(META).put(meta);
      });
    }
    return entry.result;
  }
  let total = null;
  let writesSinceCount = 0;
  const RECOUNT_EVERY = 50;
  async function stored() {
    let all2 = [];
    await transact("readonly", [META], (tx) => {
      const request2 = tx.objectStore(META).getAll();
      request2.onsuccess = () => {
        all2 = request2.result;
      };
    });
    return all2;
  }
  async function putStored(hash, result, settings) {
    if (!hash || !settings.persistCache || settings.cacheBytes <= 0) return;
    const bytes2 = weigh$1(result);
    if (bytes2 > settings.cacheBytes) return;
    const key = entryKey(hash, settings);
    const now = Date.now();
    const entry = { key, hash, languages: languagesOf(settings), result, bytes: bytes2 };
    let delta = bytes2;
    const written = await transact("readwrite", [RESPONSES, META], (tx) => {
      const metas = tx.objectStore(META);
      const previous = metas.get(key);
      previous.onsuccess = () => {
        delta = bytes2 - (previous.result?.bytes ?? 0);
        tx.objectStore(RESPONSES).put(entry);
        const meta = { key, used: now, bytes: bytes2 };
        metas.put(meta);
      };
    });
    if (!written) return;
    lastTouched.set(key, now);
    writesSinceCount += 1;
    if (writesSinceCount >= RECOUNT_EVERY) total = null;
    if (total !== null) total += delta;
    await evict$1(settings.cacheBytes);
  }
  async function evict$1(budget) {
    if (total === null) {
      total = (await stored()).reduce((sum, meta) => sum + meta.bytes, 0);
      writesSinceCount = 0;
    }
    if (total <= budget) return;
    let remaining = total;
    const done = await transact("readwrite", [RESPONSES, META], (tx) => {
      const metas = tx.objectStore(META);
      const responses = tx.objectStore(RESPONSES);
      const cursor = metas.index("used").openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at || remaining <= budget) return;
        const meta = at.value;
        remaining -= meta.bytes;
        responses.delete(meta.key);
        lastTouched.delete(meta.key);
        at.delete();
        at.continue();
      };
    });
    total = done ? remaining : null;
  }
  async function clearStored() {
    await transact("readwrite", [RESPONSES, META], (tx) => {
      tx.objectStore(RESPONSES).clear();
      tx.objectStore(META).clear();
    });
    lastTouched.clear();
    total = 0;
    writesSinceCount = 0;
  }
  async function storedStats() {
    const all2 = await stored();
    return { entries: all2.length, bytes: all2.reduce((sum, meta) => sum + meta.bytes, 0) };
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
  const DEG$1 = Math.PI / 180;
  let measureCtx;
  function measurer() {
    if (measureCtx === void 0) {
      measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    }
    return measureCtx;
  }
  const baseLang = (tag) => tag.split("-")[0]?.toLowerCase() ?? "";
  function fitFontSize(str, boxWidth, boxHeight, fontFamily, maxSize = MAX_FONT_SIZE) {
    const ctx = measurer();
    if (!ctx) return MIN_FONT_SIZE;
    let low = MIN_FONT_SIZE;
    let high = maxSize;
    while (low <= high) {
      const mid = low + high >> 1;
      ctx.font = `${mid}px ${fontFamily}`;
      const metrics = ctx.measureText(str);
      const height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
      if (metrics.width >= boxWidth || height >= boxHeight) high = mid - 1;
      else low = mid + 1;
    }
    return Math.max(MIN_FONT_SIZE, Math.min(low - 1, maxSize));
  }
  function buildLineText(translation, line, nextLine) {
    let out = "";
    line.words.forEach(([start2, end], i) => {
      out += translation.slice(start2, end);
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
  function fitTextBlock(setFont, measure, lineHeight, text2, boxWidth, boxHeight, perCharacter = false, maxSize = MAX_FONT_SIZE) {
    let low = MIN_FONT_SIZE;
    let high = maxSize;
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
    const size = Math.max(MIN_FONT_SIZE, Math.min(low - 1, maxSize));
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
  const ROTATED_PUNCT = new Set("ー〜～‐‑‒–—―－…‥（）｛｝〔〕［］【】「」『』〈〉《》");
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
  function fitInside(box, width, height) {
    const radians = box.angle * DEG$1;
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
  function weigh(blocks) {
    let bytes2 = 0;
    for (const block of blocks) {
      bytes2 += block.translation.length * 2;
      for (const line of block.lines) bytes2 += line.background?.bytes.byteLength ?? 0;
    }
    return bytes2;
  }
  const entries = /* @__PURE__ */ new Map();
  const renders = /* @__PURE__ */ new Map();
  let totalBytes = 0;
  let clock = 0;
  const SIZE_NAME = /^(thumb|tiny|small|medium|large|orig|original|\d{2,4}x\d{2,4}|\d{2,4})$/i;
  const RENDITION_PARAMS = {
    name: SIZE_NAME,
    format: /^(jpe?g|png|webp|avif|gif|auto)$/i,
    fm: /^(jpe?g|png|webp|avif|gif|auto)$/i,
    q: /^\d+$/,
    quality: /^\d+$/,
    dpr: /^\d+(\.\d+)?$/,
    auto: /^[a-z,]+$/i
  };
  function normalizeUrl(raw) {
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
    try {
      const url = new URL(raw, document.baseURI);
      for (const [name, value] of [...url.searchParams]) {
        if (RENDITION_PARAMS[name.toLowerCase()]?.test(value)) url.searchParams.delete(name);
      }
      url.hash = "";
      const query = url.searchParams.toString();
      return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
    } catch {
      return raw;
    }
  }
  function sameShape(a, b) {
    if (!a || !b) return true;
    if (!(a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0)) return true;
    const ratio = a.width / a.height / (b.width / b.height);
    return Math.abs(ratio - 1) <= 0.02;
  }
  function cacheKey(url, settings) {
    return [normalizeUrl(url), settings.targetLang, settings.sourceLang, settings.ocrLang].join("\0");
  }
  function evict(limit) {
    while (totalBytes > limit && entries.size + renders.size > 1) {
      let oldest = null;
      let oldestUsed = Infinity;
      for (const [key, entry] of entries) {
        if (entry.used < oldestUsed) {
          oldestUsed = entry.used;
          oldest = { map: "response", key };
        }
      }
      for (const [key, entry] of renders) {
        if (entry.used < oldestUsed) {
          oldestUsed = entry.used;
          oldest = { map: "render", key };
        }
      }
      if (!oldest) break;
      if (oldest.map === "response") {
        totalBytes -= entries.get(oldest.key)?.bytes ?? 0;
        entries.delete(oldest.key);
      } else {
        totalBytes -= renders.get(oldest.key)?.blob.size ?? 0;
        renders.delete(oldest.key);
      }
    }
  }
  function getCached(key, settings, size) {
    if (settings.cacheBytes <= 0) return null;
    const entry = entries.get(key);
    if (!entry) return null;
    if (!sameShape(entry.size, size)) return null;
    entry.used = ++clock;
    return entry.result;
  }
  function putCached(key, result, settings, size) {
    const limit = settings.cacheBytes;
    if (limit <= 0) return;
    const bytes2 = weigh(result.blocks);
    if (bytes2 > limit) return;
    const existing = entries.get(key);
    if (existing) totalBytes -= existing.bytes;
    entries.set(key, { result, bytes: bytes2, used: ++clock, size });
    totalBytes += bytes2;
    evict(limit);
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
  function renderKey(key, settings, displayedWidth) {
    const parts = [key];
    for (const name of DRAWN) parts.push(`${name}=${String(settings[name])}`);
    parts.push(`w=${Math.round(displayedWidth / 50)}`);
    return parts.join(SEPARATOR);
  }
  function getRender(key, settings, size) {
    if (settings.cacheBytes <= 0) return null;
    const entry = renders.get(key);
    if (!entry) return null;
    if (!sameShape(entry.size, size)) return null;
    entry.used = ++clock;
    return entry.blob;
  }
  function putRender(key, blob, settings, size) {
    const limit = settings.cacheBytes;
    if (limit <= 0 || blob.size > limit) return;
    const existing = renders.get(key);
    if (existing) totalBytes -= existing.blob.size;
    renders.set(key, { blob, used: ++clock, size });
    totalBytes += blob.size;
    evict(limit);
  }
  function clearCache() {
    const stats = cacheStats();
    entries.clear();
    renders.clear();
    totalBytes = 0;
    return stats;
  }
  const cacheStats = () => ({
    entries: entries.size + renders.size,
    bytes: totalBytes
  });
  const SETTLE_MS = 60;
  const identityOf = (element) => normalizeUrl(classify(element)?.url ?? "");
  const signatureOf = (element) => ["src", "srcset", "sizes"].map((name) => element.getAttribute(name) ?? "").join("\0");
  function watchPicture(element, handlers) {
    const ref = new WeakRef(element);
    const isImage = element.tagName === "IMG";
    const remembered = identityOf(element);
    let signature = signatureOf(element);
    let timer;
    let stopped = false;
    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      observer.disconnect();
      element.removeEventListener("load", check);
      element.removeEventListener("error", check);
    };
    function check() {
      if (stopped) return;
      window.clearTimeout(timer);
      const current = ref.deref();
      if (!current || !current.isConnected || identityOf(current) !== remembered) {
        stop();
        handlers.stale();
        return;
      }
      signature = signatureOf(current);
      handlers.pending(false);
    }
    const observer = new MutationObserver(() => {
      if (stopped) return;
      const current = ref.deref();
      if (!current) return;
      if (!isImage) {
        check();
        return;
      }
      const now = signatureOf(current);
      if (now === signature) return;
      handlers.pending(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(check, SETTLE_MS);
    });
    observer.observe(element, {
      attributes: true,
      attributeFilter: isImage ? ["src", "srcset", "sizes"] : ["style", "class"]
    });
    element.addEventListener("load", check);
    element.addEventListener("error", check);
    return stop;
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
  const live = /* @__PURE__ */ new Set();
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
    entry.stopWatching();
    for (const url of entry.objectUrls) URL.revokeObjectURL(url);
    entry.layer.remove();
    overlays.delete(img);
    live.delete(entry.ref);
    return true;
  }
  function showOrHide$1(entry) {
    entry.layer.style.visibility = entry.hiddenFor.size ? "hidden" : "";
  }
  function peekOverlay(img, peeking) {
    const entry = overlays.get(img);
    if (!entry) return false;
    if (peeking) entry.hiddenFor.add("peek");
    else entry.hiddenFor.delete("peek");
    showOrHide$1(entry);
    return true;
  }
  function peekAllOverlays(peeking) {
    for (const img of overlaid()) peekOverlay(img, peeking);
  }
  function sweepOverlays() {
    let removed = 0;
    for (const img of overlaid()) {
      if (!img.isConnected && clearOverlay(img)) removed += 1;
    }
    return removed;
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
    for (const ref of live) {
      const element = ref.deref();
      if (!element || !overlays.has(element)) live.delete(ref);
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
  function renderTranslation(img, blocks, settings, natural, root, options = {}) {
    clearOverlay(img);
    const rect = img.getBoundingClientRect();
    const aspect = natural.width / natural.height;
    const fontFamily = settings.fontFamily || getComputedStyle(img).fontFamily || "system-ui, sans-serif";
    const layer = document.createElement("div");
    layer.className = "lt-layer";
    placeLayer(layer, img);
    root.append(layer);
    const objectUrls = [];
    const ref = new WeakRef(img);
    const entry = {
      layer,
      objectUrls,
      ref,
      hiddenFor: /* @__PURE__ */ new Set(),
      stopWatching: () => {
      }
    };
    entry.stopWatching = watchPicture(img, {
      stale: () => {
        const current = ref.deref();
        if (current && clearOverlay(current)) options.onGone?.();
      },
      pending: (on) => {
        if (on) entry.hiddenFor.add("pending");
        else entry.hiddenFor.delete("pending");
        showOrHide$1(entry);
      }
    });
    overlays.set(img, entry);
    live.add(ref);
    let rendered = 0;
    for (const block of blocks) {
      const rtl = isRtl(block);
      const vertical = shouldStayVertical(block, settings.verticalText);
      const justify = justification(block.alignment, rtl);
      block.lines.forEach((line, index) => {
        const geometry = line.geometry;
        if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;
        const patch = Boolean(settings.drawBackground && line.background);
        if (patch) renderBackground(layer, line, geometry, aspect, objectUrls);
        const str = buildLineText(block.translation, line, block.lines[index + 1]);
        if (!str.trim()) return;
        const boxW = geometry.w * rect.width;
        const boxH = geometry.h * rect.height;
        const size = fitFontSize(str, vertical ? boxH : boxW, vertical ? boxW : boxH, fontFamily);
        const bgColor = argbToCss(line.bgColor);
        const outline = size * OUTLINE_RATIO * settings.outlineScale;
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
    let total2 = 0;
    for (const [upright, run] of verticalRuns(text2)) {
      total2 += upright ? em * [...run].length : ctx.measureText(run).width;
    }
    let y = (boxH - total2) / 2;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    for (const [upright, run] of verticalRuns(text2)) {
      if (upright) {
        for (const char of run) {
          const advance = ctx.measureText(char).width;
          if (ROTATED_PUNCT.has(char)) {
            ctx.save();
            ctx.translate(boxW / 2, y + em / 2);
            ctx.rotate(90 * DEG);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            strokeThenFill(ctx, char, 0, 0, outline, outlineColor);
            ctx.fillStyle = fill;
            ctx.fillText(char, 0, 0);
            ctx.restore();
            y += em;
            continue;
          }
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
  function drawReflowedParagraph(draw, block, settings, room) {
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
    ctx.direction = isRtl(block) ? "rtl" : "ltr";
    const spacing = settings.lineSpacing > 0 ? settings.lineSpacing : 1.25;
    const perCharacter = wrapsPerCharacter(block);
    const measure = (candidate) => ctx.measureText(candidate).width;
    const setFont = (px2) => {
      ctx.font = `${px2}px ${fontFamily}`;
    };
    const { size } = fitTextBlock(
      setFont,
      measure,
      (px2) => px2 * spacing,
      text2,
      boxW,
      boxH,
      perCharacter,
      draw.maxFontPx
    );
    let fontSize = Math.max(size, draw.minFontPx);
    setFont(fontSize);
    let lines = wrapText(measure, text2, boxW, perCharacter);
    const widest = lines.reduce((max, line) => Math.max(max, measure(line)), 0);
    if (widest > boxW && widest > 0) {
      fontSize = Math.max(MIN_FONT_SIZE, fontSize * boxW / widest);
      setFont(fontSize);
      lines = wrapText(measure, text2, boxW, perCharacter);
    }
    if (settings.fitToBox) {
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
      Math.round(fontSize * OUTLINE_RATIO * 2 * settings.outlineScale)
    );
    const outlineColor = argbToCss(style.bgColor);
    const justify = justification(block.alignment, isRtl(block), settings.textAlign);
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
  function eraseTextArea(draw, block, settings) {
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
    const pad = Number.isFinite(thinnest) ? thinnest * settings.hullPadding : 0;
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
  async function drawLine(draw, block, line, nextLine, settings, backgroundOnly = false, skipBackground = false) {
    const geometry = line.geometry;
    if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;
    const { ctx, width, height, fontFamily } = draw;
    const boxW = geometry.w * width;
    const boxH = geometry.h * height;
    const cx = geometry.cx * width;
    const cy = geometry.cy * height;
    const patch = settings.drawBackground && !skipBackground ? line.background : null;
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
    } else if (settings.drawBackground && !skipBackground) {
      ctx.fillStyle = argbToCss(line.bgColor);
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
    }
    const text2 = backgroundOnly ? "" : buildLineText(block.translation, line, nextLine);
    if (text2.trim()) {
      const vertical = shouldStayVertical(block, settings.verticalText);
      const fitted = fitFontSize(
        text2,
        vertical ? boxH : boxW,
        vertical ? boxW : boxH,
        fontFamily,
        draw.maxFontPx
      );
      const size = Math.max(fitted, draw.minFontPx);
      ctx.font = `${size}px ${fontFamily}`;
      ctx.direction = isRtl(block) ? "rtl" : "ltr";
      const fill = argbToCss(line.textColor);
      const outline = patch ? Math.max(1, Math.round(size * OUTLINE_RATIO * settings.outlineScale)) : 0;
      const outlineColor = patch ? argbToCss(line.bgColor) : null;
      const enlarged = size > fitted;
      const advance = ctx.measureText(text2).width;
      const drawW = enlarged ? Math.min(Math.max(boxW, advance + size * 0.4), width) : boxW;
      const drawH = enlarged ? Math.min(Math.max(boxH, size * 1.35), height) : boxH;
      nudgeInside(draw, { w: drawW, h: drawH }, { cx, cy, angle: geometry.angle, rtl: isRtl(block) });
      if (enlarged && settings.drawBackground && !skipBackground) {
        ctx.fillStyle = argbToCss(line.bgColor);
        ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
      }
      ctx.translate(-drawW / 2, -drawH / 2);
      if (vertical) {
        drawVertical(draw, text2, drawW, drawH, size, fill, outline, outlineColor);
      } else {
        const justify = justification(block.alignment, isRtl(block), settings.textAlign);
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
  async function renderToBlob(source, naturalWidth, naturalHeight, blocks, settings, displayedWidth = naturalWidth) {
    const scale = Math.min(
      Math.max(1, Math.round(settings.supersample)),
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
    const fontFamily = settings.fontFamily || "system-ui, -apple-system, sans-serif";
    const canvasPerCssPx = width / Math.max(1, displayedWidth);
    const floorCssPx = settings.mangaMode ? Math.max(settings.minReadablePx, 14) : settings.minReadablePx;
    const draw = {
      ctx,
      width,
      height,
      fontFamily,
      minFontPx: floorCssPx > 0 ? floorCssPx * canvasPerCssPx : 0,
      maxFontPx: MAX_FONT_SIZE * scale
    };
    const boxes = blocks.map(
      (block) => block.geometry ? rectOf(block.geometry, width, height) : null
    );
    const growth = settings.mangaMode ? Math.max(1, settings.mangaBoxGrowth) : 1;
    for (const [index, block] of blocks.entries()) {
      const vertical = block.writingDirection === 2;
      const stayVertical = !settings.mangaMode && shouldStayVertical(block, settings.verticalText);
      const hull = settings.drawBackground && (settings.eraseMode === "hull" || settings.mangaMode);
      if (hull) eraseTextArea(draw, block, settings);
      const reflow = Boolean(block.geometry) && !stayVertical && (vertical || settings.reflowHorizontal);
      for (let i = 0; i < block.lines.length; i += 1) {
        const line = block.lines[i];
        if (!line) continue;
        if (reflow) {
          if (!hull) await drawLine(draw, block, line, block.lines[i + 1], settings, true);
        } else await drawLine(draw, block, line, block.lines[i + 1], settings, false, hull);
      }
      if (reflow) {
        const own = boxes[index];
        if (own) {
          const others = boxes.filter((rect, at) => rect !== null && at !== index);
          drawReflowedParagraph(draw, block, settings, roomFor(own, others, growth, width, height));
        }
      }
    }
    const blob = await new Promise((resolve2) => canvas.toBlob(resolve2, "image/png"));
    if (!blob) throw new Error("Could not encode the translated image");
    return blob;
  }
  const registry = /* @__PURE__ */ new Map();
  const covers = /* @__PURE__ */ new WeakMap();
  const isCovered = (img) => covers.has(img);
  const COVER_MARK = "data-lens-translate";
  const isCover = (node) => node.hasAttribute(COVER_MARK);
  const px = (value) => Number.parseFloat(value) || 0;
  const borderOf = (style) => ({
    top: px(style.borderTopWidth),
    right: px(style.borderRightWidth),
    bottom: px(style.borderBottomWidth),
    left: px(style.borderLeftWidth)
  });
  const paddingOf = (style) => ({
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft)
  });
  function inset(style, box) {
    const border = borderOf(style);
    if (box === "border-box") return { top: 0, right: 0, bottom: 0, left: 0 };
    if (box === "padding-box") return border;
    const padding = paddingOf(style);
    return {
      top: border.top + padding.top,
      right: border.right + padding.right,
      bottom: border.bottom + padding.bottom,
      left: border.left + padding.left
    };
  }
  function place(cover, img) {
    const target = cover.element;
    const style = getComputedStyle(img);
    if (!cover.background) {
      const border = borderOf(style);
      const padding = paddingOf(style);
      const left = border.left + padding.left;
      const top = border.top + padding.top;
      target.style.left = `${img.offsetLeft + left}px`;
      target.style.top = `${img.offsetTop + top}px`;
      target.style.width = `${img.offsetWidth - left - border.right - padding.right}px`;
      target.style.height = `${img.offsetHeight - top - border.bottom - padding.bottom}px`;
      return true;
    }
    const { spec, natural } = cover.background;
    const width = img.offsetWidth;
    const height = img.offsetHeight;
    const origin = inset(style, spec.origin);
    const area = {
      width: width - origin.left - origin.right,
      height: height - origin.top - origin.bottom
    };
    const rect = paintRect(spec, area, natural);
    if (!rect || tilesVisibly(spec, rect, area)) return false;
    const x = origin.left + rect.x;
    const y = origin.top + rect.y;
    const clip = inset(style, spec.clip);
    const cut = {
      top: Math.max(0, clip.top - y),
      right: Math.max(0, x + rect.width - (width - clip.right)),
      bottom: Math.max(0, y + rect.height - (height - clip.bottom)),
      left: Math.max(0, clip.left - x)
    };
    if (cut.left + cut.right >= rect.width || cut.top + cut.bottom >= rect.height) return false;
    target.style.left = `${img.offsetLeft + x}px`;
    target.style.top = `${img.offsetTop + y}px`;
    target.style.width = `${rect.width}px`;
    target.style.height = `${rect.height}px`;
    const radius = style.borderRadius.trim();
    const round = radius && !/^0(px)?$/.test(radius) ? ` round ${radius}` : "";
    const visible = `inset(${cut.top}px ${cut.right}px ${cut.bottom}px ${cut.left}px${round})`;
    target.style.setProperty("clip-path", visible, "important");
    return true;
  }
  function showOrHide(cover) {
    if (cover.hiddenFor.size) cover.element.style.setProperty("visibility", "hidden", "important");
    else cover.element.style.removeProperty("visibility");
  }
  function coverImage(img, blobUrl, options = {}) {
    uncoverImage(img);
    const parent = img.parentElement;
    if (!parent) {
      URL.revokeObjectURL(blobUrl);
      return false;
    }
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
        // A background's window, corners included, is cut out by place().
        ...options.background ? ["border-radius: 0", "object-fit: fill"] : [
          // Inherit the shape so rounded media does not get square corners.
          `border-radius: ${getComputedStyle(img).borderRadius}`,
          // And how the picture sits in its box: `contain` letterboxes it,
          // and where in the box it lands is object-position's to say.
          `object-fit: ${getComputedStyle(img).objectFit || "fill"}`,
          `object-position: ${getComputedStyle(img).objectPosition || "50% 50%"}`
        ]
      ].map((rule) => `${rule} !important`).join(";")
    );
    if (getComputedStyle(parent).position === "static") {
      parent.style.setProperty("position", "relative", "important");
    }
    const cover = {
      element,
      blobUrl,
      background: options.background,
      // Both are filled in below, once what they need exists.
      resize: void 0,
      stopWatching: () => {
      },
      hiddenFor: /* @__PURE__ */ new Set(),
      onGone: options.onGone
    };
    img.insertAdjacentElement("afterend", element);
    if (!place(cover, img)) {
      element.remove();
      URL.revokeObjectURL(blobUrl);
      return false;
    }
    const ref = new WeakRef(img);
    cover.resize = new ResizeObserver(() => {
      const current = ref.deref();
      if (!current) return;
      if (!current.isConnected || !place(cover, current)) drop(current);
    });
    cover.resize.observe(img);
    cover.stopWatching = watchPicture(img, {
      stale: () => {
        const current = ref.deref();
        if (current) drop(current);
      },
      pending: (on) => {
        if (on) cover.hiddenFor.add("pending");
        else cover.hiddenFor.delete("pending");
        showOrHide(cover);
      }
    });
    covers.set(img, cover);
    registry.set(element, { image: ref, blobUrl });
    return true;
  }
  function drop(img) {
    const onGone = covers.get(img)?.onGone;
    if (uncoverImage(img)) onGone?.();
  }
  function uncoverImage(img) {
    const cover = covers.get(img);
    if (!cover) return false;
    release(cover);
    covers.delete(img);
    return true;
  }
  function release(cover) {
    cover.stopWatching();
    cover.resize.disconnect();
    cover.element.remove();
    URL.revokeObjectURL(cover.blobUrl);
    registry.delete(cover.element);
  }
  function sweepCovers() {
    let removed = 0;
    for (const [element, entry] of [...registry]) {
      const img = entry.image.deref();
      if (img?.isConnected) continue;
      if (img) {
        drop(img);
      } else {
        element.remove();
        URL.revokeObjectURL(entry.blobUrl);
        registry.delete(element);
      }
      removed += 1;
    }
    return removed;
  }
  function uncoverAll() {
    let count = 0;
    for (const [element, entry] of [...registry]) {
      const img = entry.image.deref();
      if (img && uncoverImage(img)) count += 1;
      else {
        element.remove();
        URL.revokeObjectURL(entry.blobUrl);
        registry.delete(element);
        count += 1;
      }
    }
    for (const stray of Array.from(document.querySelectorAll("img[data-lens-translate]"))) {
      stray.remove();
      count += 1;
    }
    return count;
  }
  function peekCover(img, peeking) {
    const cover = covers.get(img);
    if (!cover) return false;
    if (peeking) cover.hiddenFor.add("peek");
    else cover.hiddenFor.delete("peek");
    showOrHide(cover);
    return true;
  }
  function peekAllCovers(peeking) {
    for (const entry of registry.values()) {
      const img = entry.image.deref();
      if (img) peekCover(img, peeking);
    }
  }
  const SITES_KEY = "lens-translate:sites";
  const hostOf = (hostname = window.location.hostname) => hostname.toLowerCase().replace(/^www\./, "");
  let rules = null;
  function load() {
    if (rules) return rules;
    rules = {};
    try {
      const raw = readStored(SITES_KEY);
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object") {
        for (const [host2, mode] of Object.entries(parsed)) {
          if (mode === "off" || mode === "auto") rules[host2] = mode;
        }
      }
    } catch {
    }
    return rules;
  }
  function reloadSites() {
    rules = null;
  }
  function siteMode(host2 = hostOf()) {
    return load()[host2] ?? "default";
  }
  function setSiteMode(mode, host2 = hostOf()) {
    const next = { ...load() };
    if (mode === "default") delete next[host2];
    else next[host2] = mode;
    rules = next;
    writeStored(SITES_KEY, next);
  }
  const PATHS = {
    translate: "m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6",
    search: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.3-4.3",
    sparkles: "M12 3l1.9 5.1a2 2 0 0 0 1.2 1.2L20 11l-4.9 1.7a2 2 0 0 0-1.2 1.2L12 19l-1.9-5.1a2 2 0 0 0-1.2-1.2L4 11l4.9-1.7a2 2 0 0 0 1.2-1.2zM19 3v4M21 5h-4",
    copy: "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2",
    settings: "M20 7h-9M14 17H5M17 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM7 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    more: "M12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM19 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM5 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z",
    area: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2",
    objects: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    text: "M4 7V4h16v3M9 20h6M12 4v16",
    undo: "M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13",
    close: "M18 6 6 18M6 6l12 12",
    send: "m5 12 7-7 7 7M12 19V5",
    external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
    images: "M18 22H4a2 2 0 0 1-2-2V6M8 2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM22 13l-3-3-7 7",
    loader: "M21 12a9 9 0 1 1-6.2-8.6"
  };
  function icon(name, size = 18) {
    return `<svg class="lt-icon lt-icon-${name}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
  }
  function positionFraction(component, free) {
    const value = Number.parseFloat(component ?? "");
    if (!Number.isFinite(value)) return 0.5;
    if ((component ?? "").trim().endsWith("%")) return value / 100;
    return free === 0 ? 0 : value / free;
  }
  function fittedRect(box, natural, fit, position) {
    if (!(natural.width > 0) || !(natural.height > 0) || fit === "fill" || fit === "") return { ...box };
    const contain = Math.min(box.width / natural.width, box.height / natural.height);
    const cover = Math.max(box.width / natural.width, box.height / natural.height);
    const scale = fit === "contain" ? contain : fit === "cover" ? cover : fit === "scale-down" ? Math.min(1, contain) : 1;
    const width = natural.width * scale;
    const height = natural.height * scale;
    const [px2, py] = position.trim().split(/\s+/);
    const freeX = box.width - width;
    const freeY = box.height - height;
    return {
      left: box.left + freeX * positionFraction(px2, freeX),
      top: box.top + freeY * positionFraction(py, freeY),
      width,
      height
    };
  }
  function insetRect(rect, edges) {
    return {
      left: rect.left + edges.left,
      top: rect.top + edges.top,
      width: Math.max(0, rect.width - edges.left - edges.right),
      height: Math.max(0, rect.height - edges.top - edges.bottom)
    };
  }
  const clamp01 = (value) => Math.min(1, Math.max(0, value));
  const MIN_DRAG_PX = 12;
  function dragToBox(from, to, picture) {
    if (!(picture.width > 0) || !(picture.height > 0)) return null;
    const x0 = clamp01((Math.min(from.x, to.x) - picture.left) / picture.width);
    const x1 = clamp01((Math.max(from.x, to.x) - picture.left) / picture.width);
    const y0 = clamp01((Math.min(from.y, to.y) - picture.top) / picture.height);
    const y1 = clamp01((Math.max(from.y, to.y) - picture.top) / picture.height);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w * picture.width < MIN_DRAG_PX || h * picture.height < MIN_DRAG_PX) return null;
    return { cx: x0 + w / 2, cy: y0 + h / 2, w, h };
  }
  function boxAfterRelease(from, to, picture, chosen) {
    const dragged = dragToBox(from, to, picture);
    return dragged ? { box: dragged, changed: true } : { box: chosen, changed: false };
  }
  function boxToRect(box, picture) {
    return {
      left: (box.cx - box.w / 2) * picture.width,
      top: (box.cy - box.h / 2) * picture.height,
      width: box.w * picture.width,
      height: box.h * picture.height
    };
  }
  function centreOf(geometry, picture) {
    return { x: geometry.cx * picture.width, y: geometry.cy * picture.height };
  }
  function keyboardInset(layoutHeight, visual) {
    if (!visual || Math.abs(visual.scale - 1) > 0.01) return 0;
    return Math.max(0, Math.round(layoutHeight - visual.height - visual.offsetTop));
  }
  const CHILDLESS = /* @__PURE__ */ new Set([
    "IMG",
    "VIDEO",
    "CANVAS",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "AUDIO",
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "PICTURE",
    "SVG"
  ]);
  const canHoldUi = (tagName) => !CHILDLESS.has(tagName.toUpperCase());
  function pickables(paragraphs) {
    const out = [];
    for (const paragraph of paragraphs) {
      for (const line of paragraph.lines) {
        const words = line.words.filter((word) => word.text);
        if (words.length && words.every((word) => word.geometry)) {
          words.forEach((word, index) => {
            const last = index === words.length - 1;
            const spaced = (word.text.codePointAt(word.text.length - 1) ?? 0) < 11904;
            out.push({
              text: word.text,
              separator: last && !word.separator && spaced ? " " : word.separator,
              geometry: word.geometry
            });
          });
        } else if (line.geometry && line.text) {
          out.push({ text: line.text, separator: " ", geometry: line.geometry });
        }
      }
    }
    return out;
  }
  function joinPicked(items, picked) {
    let text2 = "";
    let previous = -2;
    items.forEach((item, index) => {
      if (!picked.has(index)) return;
      if (text2 && previous !== index - 1 && !/\s$/.test(text2)) text2 += " ";
      text2 += item.text + item.separator;
      previous = index;
    });
    return text2.replace(/\s+/g, " ").trim();
  }
  const objectsStillValid = (source, list) => source.fresh && source.objects === list;
  const styles = "/* Lives inside a shadow root, so these selectors compete with nothing. The\n   :host is a fixed, click-through, full-viewport layer; everything here is\n   positioned in viewport coordinates.\n\n   The look is shadcn/ui's: zinc neutrals named by role, one radius, hairline\n   borders, a ring on focus. Only the look - there is no framework behind it,\n   because this stylesheet is parsed on every page the script runs on. */\n\n:host {\n  --background: #ffffff;\n  --foreground: #09090b;\n  --muted: #f4f4f5;\n  --muted-foreground: #71717a;\n  --accent: #f4f4f5;\n  --border: #e4e4e7;\n  --input: #d4d4d8;\n  --ring: #a1a1aa;\n  --primary: #18181b;\n  --primary-foreground: #fafafa;\n  --destructive: #dc2626;\n  --success: #059669;\n  --shadow: 0 10px 30px -8px rgba(9, 9, 11, 0.28), 0 2px 6px -2px rgba(9, 9, 11, 0.12);\n  /* 0.5rem, written in pixels: inside a shadow root `rem` is still the page's\n     root font size, and a site that sets that to 10px would shrink every\n     corner and control here with it. */\n  --radius: 8px;\n  /* What the keyboard covers; ui/root.ts keeps it current where it can. */\n  --lt-kb: 0px;\n  /* A hundredth of the viewport, by the best unit this browser has. `svh` is\n     the height with the address bar showing, so a sheet sized by it does not\n     jump when the bar slides away; `dvh` follows the bar. */\n  --lt-svh: 1vh;\n  --lt-dvh: 1vh;\n  /* The backgrounds of our popups, and only those: the menu, the panels, the\n     messages and a tool's bar. ui/root.ts sets --lt-opacity on the host from\n     the \"Popup opacity\" setting. Text and icons are drawn in --foreground and\n     friends, which are never touched, so the words stay solid while what is\n     behind them shows through. Without color-mix the surfaces simply stay\n     opaque: a custom property that fails to compute does not fall back to an\n     earlier declaration, it makes the background transparent, so the mix is\n     only declared where it is known to parse - and only while the setting is\n     below 100, so a fully opaque popup is the plain colour it always was. */\n  --lt-opacity: 100%;\n  --surface: var(--background);\n  --surface-muted: var(--muted);\n\n  font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;\n  color: var(--foreground);\n}\n@supports (background: color-mix(in srgb, red 50%, transparent)) {\n  :host([data-translucent]) {\n    --surface: color-mix(in srgb, var(--background) var(--lt-opacity), transparent);\n    --surface-muted: color-mix(in srgb, var(--muted) var(--lt-opacity), transparent);\n  }\n}\n/* A see-through popup over a photograph is a popup over noise, and the blur is\n   what turns the noise back into a tint. Only while it is see-through: a\n   backdrop filter costs a compositing pass under every surface that has one. */\n:host([data-translucent]) .lt-menu,\n:host([data-translucent]) .lt-panel,\n:host([data-translucent]) #lt-toast,\n:host([data-translucent]) .lt-bar {\n  -webkit-backdrop-filter: blur(14px) saturate(1.3);\n  backdrop-filter: blur(14px) saturate(1.3);\n}\n@supports (height: 1dvh) {\n  :host {\n    --lt-svh: 1svh;\n    --lt-dvh: 1dvh;\n  }\n}\n@media (prefers-color-scheme: dark) {\n  :host {\n    --background: #09090b;\n    --foreground: #fafafa;\n    --muted: #27272a;\n    --muted-foreground: #a1a1aa;\n    --accent: #27272a;\n    --border: #27272a;\n    --input: #3f3f46;\n    --ring: #71717a;\n    --primary: #fafafa;\n    --primary-foreground: #18181b;\n    --destructive: #ef4444;\n    --success: #10b981;\n    --shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.7), 0 2px 6px -2px rgba(0, 0, 0, 0.5);\n  }\n}\n\n*,\n*::before,\n*::after {\n  box-sizing: border-box;\n}\n\n.lt-icon {\n  display: block;\n  flex: none;\n  width: 18px;\n}\n.lt-icon-loader {\n  animation: lt-spin 0.9s linear infinite;\n}\n@keyframes lt-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n/* ------------------------------------------------------------- controls */\n\n/* Hung from the picture's top right corner by its own right edge, so the row\n   can be any width: main.ts sets `left` to the corner and this pulls it back. */\n#lt-controls {\n  position: absolute;\n  z-index: 1;\n  display: flex;\n  gap: 4px;\n  transform: translateX(-100%);\n  pointer-events: none;\n}\n#lt-button,\n#lt-gear,\n#lt-more {\n  width: 32px;\n  height: 32px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  /* These sit on somebody's photograph, not on a surface of ours, so they do\n     not follow the theme: dark glass reads on any picture. */\n  background: rgba(9, 9, 11, 0.72);\n  color: #fafafa;\n  border: 1px solid rgba(255, 255, 255, 0.18);\n  border-radius: var(--radius);\n  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);\n  -webkit-backdrop-filter: blur(6px);\n  backdrop-filter: blur(6px);\n  opacity: 0;\n  transform: scale(0.92);\n  pointer-events: none;\n  cursor: pointer;\n  transition: opacity 0.15s, transform 0.15s, background 0.15s;\n  -webkit-tap-highlight-color: transparent;\n}\n#lt-controls.lt-on #lt-button,\n/* A beat after the main button, so a passing cursor does not summon three. */\n#lt-controls.lt-on.lt-extras #lt-gear,\n#lt-controls.lt-on.lt-extras #lt-more {\n  opacity: 1;\n  transform: none;\n  pointer-events: auto;\n}\n#lt-button:hover,\n#lt-gear:hover,\n#lt-more:hover {\n  background: rgba(9, 9, 11, 0.92);\n}\n/* Held down to peek, and on a touch screen a long press: the browser must not\n   take either for a scroll or a text selection. */\n#lt-button {\n  touch-action: none;\n  -webkit-user-select: none;\n  user-select: none;\n  -webkit-touch-callout: none;\n}\n/* Held down to look at the original: the button says so with a ring. */\n#lt-button.lt-peeking {\n  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.6);\n}\n#lt-button .lt-icon-loader,\n#lt-button.lt-busy .lt-icon-translate {\n  display: none;\n}\n#lt-button.lt-busy .lt-icon-loader {\n  display: block;\n}\n#lt-button.lt-active {\n  background: var(--success);\n  border-color: transparent;\n}\n#lt-button.lt-error {\n  background: var(--destructive);\n  border-color: transparent;\n}\n\n/* -------------------------------------------------------- buttons, fields */\n\n.lt-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  height: 36px;\n  padding: 0 14px;\n  font: inherit;\n  font-weight: 500;\n  white-space: nowrap;\n  text-decoration: none;\n  color: var(--foreground);\n  background: var(--background);\n  border: 1px solid var(--border);\n  border-radius: calc(var(--radius) - 2px);\n  box-shadow: 0 1px 2px rgba(9, 9, 11, 0.05);\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n.lt-btn:hover {\n  background: var(--accent);\n}\n.lt-btn.lt-primary {\n  color: var(--primary-foreground);\n  background: var(--primary);\n  border-color: transparent;\n}\n.lt-btn.lt-primary:hover {\n  opacity: 0.9;\n}\n.lt-btn.lt-ghost {\n  border-color: transparent;\n  box-shadow: none;\n  background: transparent;\n}\n.lt-btn.lt-ghost:hover {\n  background: var(--accent);\n}\n.lt-btn.lt-square {\n  width: 36px;\n  padding: 0;\n  flex: none;\n}\n.lt-btn:disabled {\n  opacity: 0.5;\n  pointer-events: none;\n}\n.lt-btn:focus-visible,\n.lt-x:focus-visible,\n.lt-dot:focus-visible {\n  outline: 2px solid var(--ring);\n  outline-offset: 2px;\n}\n\n.lt-input {\n  height: 36px;\n  min-width: 0;\n  width: 100%;\n  padding: 0 12px;\n  font: inherit;\n  color: var(--foreground);\n  background: var(--background);\n  border: 1px solid var(--input);\n  border-radius: calc(var(--radius) - 2px);\n  box-shadow: 0 1px 2px rgba(9, 9, 11, 0.05);\n}\n.lt-input::placeholder {\n  color: var(--muted-foreground);\n}\n.lt-input:focus-visible {\n  outline: 2px solid var(--ring);\n  outline-offset: 1px;\n}\n.lt-input[type='checkbox'] {\n  justify-self: start;\n  width: 16px;\n  height: 16px;\n  padding: 0;\n  box-shadow: none;\n  accent-color: var(--primary);\n}\n\n/* ----------------------------------------------------------------- menu */\n\n.lt-menu {\n  position: absolute;\n  z-index: 4;\n  width: 260px;\n  padding: 4px;\n  display: flex;\n  flex-direction: column;\n  color: var(--foreground);\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  box-shadow: var(--shadow);\n  pointer-events: auto;\n}\n.lt-menu-item {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  width: 100%;\n  min-height: 36px;\n  padding: 6px 10px;\n  font: inherit;\n  text-align: left;\n  color: inherit;\n  background: transparent;\n  border: 0;\n  border-radius: calc(var(--radius) - 4px);\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n.lt-menu-item .lt-icon {\n  color: var(--muted-foreground);\n}\n/* The item the keyboard is on is highlighted like the one the cursor is on,\n   not ringed: the first item is focused when the menu opens, and a ring there\n   reads as a selection nobody made. */\n.lt-menu-item:hover:not(:disabled),\n.lt-menu-item:focus-visible {\n  background: var(--accent);\n  outline: none;\n}\n.lt-menu-item:disabled {\n  color: var(--muted-foreground);\n  opacity: 0.6;\n  cursor: default;\n}\n.lt-menu-rule {\n  height: 1px;\n  margin: 4px -4px;\n  background: var(--border);\n}\n/* The item and the field under it are one thing to ask. */\n.lt-field-row {\n  display: flex;\n  gap: 6px;\n  padding: 2px 6px 6px 38px;\n}\n\n/* A sheet has to sit on something that takes the press meant to dismiss it. */\n.lt-scrim {\n  position: absolute;\n  inset: 0;\n  z-index: 4;\n  background: rgba(9, 9, 11, 0.5);\n  pointer-events: auto;\n}\n.lt-menu.lt-sheet {\n  left: 0;\n  right: 0;\n  bottom: var(--lt-kb);\n  width: auto;\n  max-width: 560px;\n  margin: 0 auto;\n  max-height: calc(var(--lt-svh) * 100 - var(--lt-kb) - 24px);\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  padding: 8px max(8px, env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px))\n    max(8px, env(safe-area-inset-left, 0px));\n  border-width: 1px 0 0;\n  border-radius: 14px 14px 0 0;\n}\n/* The handle a sheet is expected to have; it says \"this slides\", nothing more. */\n.lt-menu.lt-sheet::before {\n  content: '';\n  flex: none;\n  align-self: center;\n  width: 40px;\n  height: 4px;\n  margin: 0 0 6px;\n  border-radius: 2px;\n  background: var(--input);\n}\n.lt-sheet .lt-menu-item {\n  min-height: 48px;\n  padding: 8px 12px;\n  gap: 14px;\n  font-size: 16px;\n}\n.lt-sheet .lt-menu-item .lt-icon {\n  width: 20px;\n  height: 20px;\n}\n.lt-sheet .lt-field-row {\n  padding: 2px 8px 8px 46px;\n}\n.lt-sheet .lt-menu-rule {\n  margin: 4px 0;\n}\n\n/* ---------------------------------------------------------------- toast */\n\n#lt-toast {\n  position: absolute;\n  z-index: 6;\n  left: 50%;\n  bottom: calc(16px + var(--lt-kb) + env(safe-area-inset-bottom, 0px));\n  transform: translateX(-50%);\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  max-width: min(520px, calc(100% - 24px));\n  padding: 10px 14px;\n  font-size: 13px;\n  color: var(--foreground);\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  box-shadow: var(--shadow);\n  pointer-events: none;\n  opacity: 0;\n  visibility: hidden;\n  transition: opacity 0.2s, visibility 0.2s;\n}\n#lt-toast.lt-show {\n  opacity: 1;\n  visibility: visible;\n}\n/* A message with a link in it is something to press. */\n#lt-toast.lt-show.lt-has-link {\n  pointer-events: auto;\n  padding: 8px 8px 8px 14px;\n}\n#lt-toast > span {\n  flex: 1;\n  min-width: 0;\n}\n/* An address shown because it could not be opened: one line, cut short, and\n   selectable for a host where copying is out of reach too. */\n.lt-url {\n  display: block;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  color: var(--muted-foreground);\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 11px;\n  user-select: text;\n  -webkit-user-select: text;\n}\n/* While a tool's bar has the bottom of the screen, messages go to the top. */\n:host([data-tool]) #lt-toast {\n  bottom: auto;\n  top: calc(12px + env(safe-area-inset-top, 0px));\n}\n\n/* --------------------------------------------------------------- panels */\n\n.lt-panel-backdrop {\n  position: absolute;\n  inset: 0;\n  z-index: 5;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(9, 9, 11, 0.5);\n  pointer-events: auto;\n}\n.lt-panel {\n  width: min(560px, 92vw);\n  max-height: calc(var(--lt-dvh) * 86);\n  display: flex;\n  flex-direction: column;\n  color: var(--foreground);\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: calc(var(--radius) + 4px);\n  box-shadow: var(--shadow);\n  overflow: hidden;\n}\n.lt-panel-head,\n.lt-panel-foot {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 12px 18px;\n  flex: none;\n}\n.lt-panel-head {\n  border-bottom: 1px solid var(--border);\n  justify-content: space-between;\n  font-size: 15px;\n  font-weight: 600;\n  padding-right: 10px;\n}\n.lt-panel-foot {\n  border-top: 1px solid var(--border);\n}\n.lt-spacer {\n  flex: 1;\n}\n.lt-panel-body {\n  padding: 8px 18px 16px;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n}\n.lt-x {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 32px;\n  height: 32px;\n  padding: 0;\n  color: var(--muted-foreground);\n  background: transparent;\n  border: 0;\n  border-radius: calc(var(--radius) - 2px);\n  cursor: pointer;\n}\n.lt-x:hover {\n  color: var(--foreground);\n  background: var(--accent);\n}\n\n.lt-row {\n  display: grid;\n  grid-template-columns: 190px minmax(0, 1fr);\n  align-items: center;\n  gap: 2px 14px;\n  padding: 7px 0;\n}\n.lt-label {\n  font-weight: 500;\n}\n.lt-hint {\n  grid-column: 2;\n  color: var(--muted-foreground);\n  font-size: 12px;\n}\n\n/* Outline slider with its live sample. */\n.lt-slider {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-width: 0;\n}\n.lt-slider input[type='range'] {\n  flex: 1;\n  width: auto;\n  height: 24px;\n  padding: 0;\n  border: 0;\n  box-shadow: none;\n  background: transparent;\n  accent-color: var(--primary);\n}\n.lt-readout {\n  min-width: 42px;\n  text-align: right;\n  font-variant-numeric: tabular-nums;\n  color: var(--muted-foreground);\n}\n.lt-preview {\n  grid-column: 2;\n  width: 100%;\n  height: auto;\n  border-radius: calc(var(--radius) - 2px);\n  border: 1px solid var(--border);\n  margin-top: 6px;\n}\n\n/* Section headings. */\n.lt-group {\n  margin: 18px 0 4px;\n  padding-bottom: 6px;\n  border-bottom: 1px solid var(--border);\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--muted-foreground);\n}\n.lt-group:first-child {\n  margin-top: 6px;\n}\n\n/* Menu commands, for a host that has no menu of its own. */\n.lt-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  padding: 6px 0 0;\n}\n.lt-note {\n  color: var(--muted-foreground);\n  font-size: 12px;\n  padding-top: 10px;\n}\n\n/* The diagnostics report: fixed width, so columns line up as written. */\n.lt-report {\n  margin: 0;\n  padding: 14px 18px;\n  overflow: auto;\n  white-space: pre-wrap;\n  word-break: break-word;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--foreground);\n  background: var(--surface-muted);\n  user-select: text;\n  -webkit-user-select: text;\n}\n\n/* ---------------------------------------------------------------- tools */\n\n/* The layer over a picture while an area, an object or words are being\n   chosen. It scrolls by default: a webtoon page is taller than the screen,\n   and a layer that swallowed every pan would strand the reader halfway down\n   it with only the close button for a way out. Only a gesture that has to be\n   a drag locks the page - see the region layer and the words. */\n.lt-tool {\n  position: absolute;\n  z-index: 2;\n  overflow: hidden;\n  background: rgba(9, 9, 11, 0.2);\n  outline: 2px solid rgba(255, 255, 255, 0.85);\n  outline-offset: -2px;\n  pointer-events: auto;\n  touch-action: pan-x pan-y;\n  -webkit-user-select: none;\n  user-select: none;\n  -webkit-touch-callout: none;\n}\n/* Dragging out a rectangle is the whole of this tool; without `none` the\n   finger scrolls the page instead. */\n.lt-tool-region {\n  cursor: crosshair;\n  touch-action: none;\n}\n/* The chosen area is the one part left undimmed; the shadow is the dimming,\n   clipped by the layer so it stops at the picture's edge. */\n.lt-sel {\n  position: absolute;\n  border: 2px solid #fff;\n  border-radius: 4px;\n  box-shadow: 0 0 0 9999px rgba(9, 9, 11, 0.45);\n  pointer-events: none;\n}\n.lt-sel[hidden] {\n  display: none;\n}\n\n/* A dot is 16px to look at and 44px to hit. */\n.lt-dot {\n  position: absolute;\n  width: 44px;\n  height: 44px;\n  margin: -22px 0 0 -22px;\n  padding: 0;\n  background: transparent;\n  border: 0;\n  border-radius: 50%;\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n.lt-dot::after {\n  content: '';\n  position: absolute;\n  inset: 14px;\n  border-radius: 50%;\n  background: #fff;\n  box-shadow: 0 0 0 3px rgba(9, 9, 11, 0.55), 0 1px 5px rgba(0, 0, 0, 0.6);\n  transition: transform 0.12s;\n}\n.lt-dot:hover::after,\n.lt-dot:focus-visible::after,\n.lt-dot:active::after {\n  transform: scale(1.3);\n}\n.lt-objbox {\n  position: absolute;\n  border: 2px solid #fff;\n  border-radius: 6px;\n  box-shadow: 0 0 0 1px rgba(9, 9, 11, 0.5);\n  opacity: 0;\n  pointer-events: none;\n  transition: opacity 0.12s;\n}\n.lt-dot:hover + .lt-objbox,\n.lt-dot:focus-visible + .lt-objbox,\n.lt-dot:active + .lt-objbox {\n  opacity: 1;\n}\n\n/* A stroke that starts on a word is a drag across words and must not pan; one\n   that starts between them scrolls. touch-action is read from where the touch\n   lands, intersected up the tree, and settled before any pointer event - so it\n   has to be on the word itself; setting it from a handler is too late. */\n.lt-word {\n  position: absolute;\n  border-radius: 3px;\n  background: rgba(255, 255, 255, 0.28);\n  box-shadow: 0 0 0 1px rgba(9, 9, 11, 0.45);\n  cursor: pointer;\n  touch-action: none;\n}\n.lt-word.lt-on {\n  background: rgba(56, 189, 248, 0.5);\n  box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgba(9, 9, 11, 0.6);\n}\n\n.lt-bar {\n  position: absolute;\n  z-index: 3;\n  left: 50%;\n  bottom: calc(16px + var(--lt-kb) + env(safe-area-inset-bottom, 0px));\n  transform: translateX(-50%);\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  width: max-content;\n  max-width: min(720px, calc(100% - 24px));\n  padding: 8px 8px 8px 14px;\n  color: var(--foreground);\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: calc(var(--radius) + 4px);\n  box-shadow: var(--shadow);\n  pointer-events: auto;\n}\n.lt-bar-text {\n  flex: 1 1 180px;\n  min-width: 0;\n  max-height: 2.9em;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.lt-bar .lt-input {\n  flex: 1 1 200px;\n  width: auto;\n}\n.lt-bar-buttons {\n  display: flex;\n  gap: 6px;\n  margin-left: auto;\n}\n\n/* ------------------------------------------------ a thumb, not a cursor */\n\n/* The same question ui/menu.ts asks. Narrow, or touched: either way the\n   targets are 44px, the fields are 16px so iOS does not zoom into them, and\n   whatever opens does so from the bottom edge, where the thumb already is. */\n@media (max-width: 640px), (pointer: coarse) {\n  #lt-button,\n  #lt-gear,\n  #lt-more {\n    width: 44px;\n    height: 44px;\n  }\n  #lt-controls {\n    gap: 6px;\n  }\n  .lt-btn,\n  .lt-input {\n    height: 44px;\n  }\n  .lt-btn.lt-square,\n  .lt-x {\n    width: 44px;\n    height: 44px;\n  }\n  .lt-input {\n    font-size: 16px;\n  }\n  .lt-input[type='checkbox'] {\n    width: 22px;\n    height: 22px;\n  }\n  .lt-slider input[type='range'] {\n    height: 44px;\n  }\n\n  .lt-panel-backdrop {\n    align-items: flex-end;\n  }\n  .lt-panel {\n    width: 100%;\n    max-width: 640px;\n    margin-bottom: var(--lt-kb);\n    max-height: calc(var(--lt-svh) * 100 - var(--lt-kb) - 24px);\n    border-width: 1px 0 0;\n    border-radius: 14px 14px 0 0;\n  }\n  .lt-panel-head,\n  .lt-panel-foot {\n    padding-left: max(14px, env(safe-area-inset-left, 0px));\n    padding-right: max(14px, env(safe-area-inset-right, 0px));\n  }\n  .lt-panel-head {\n    padding-right: max(6px, env(safe-area-inset-right, 0px));\n  }\n  .lt-panel-foot {\n    padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));\n  }\n  .lt-panel-body {\n    padding-left: max(14px, env(safe-area-inset-left, 0px));\n    padding-right: max(14px, env(safe-area-inset-right, 0px));\n  }\n  /* The label goes above its field: 190px of label leaves a phone no field. */\n  .lt-row {\n    grid-template-columns: minmax(0, 1fr);\n    gap: 6px;\n    padding: 9px 0;\n  }\n  .lt-row.lt-row-check {\n    grid-template-columns: minmax(0, 1fr) auto;\n  }\n  .lt-hint,\n  .lt-preview {\n    grid-column: 1 / -1;\n  }\n\n  .lt-bar {\n    left: max(8px, env(safe-area-inset-left, 0px));\n    right: max(8px, env(safe-area-inset-right, 0px));\n    bottom: calc(8px + var(--lt-kb) + env(safe-area-inset-bottom, 0px));\n    transform: none;\n    width: auto;\n    max-width: none;\n  }\n  .lt-bar .lt-input {\n    flex-basis: 100%;\n  }\n  #lt-toast {\n    left: max(8px, env(safe-area-inset-left, 0px));\n    right: max(8px, env(safe-area-inset-right, 0px));\n    transform: none;\n    max-width: none;\n    font-size: 14px;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  #lt-button,\n  #lt-gear,\n  #lt-more,\n  #lt-toast,\n  .lt-dot::after,\n  .lt-objbox {\n    transition: none;\n  }\n}\n";
  const HOST_ID = "lens-translate-root";
  let shadow = null;
  let host = null;
  const TOP = "2147483647";
  function fullscreenElement() {
    const doc = document;
    let element = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    for (; ; ) {
      const inner = element?.shadowRoot?.fullscreenElement;
      if (!inner || inner === element) return element;
      element = inner;
    }
  }
  function placeHost() {
    if (!host) return;
    const full = fullscreenElement();
    const home = full && canHoldUi(full.tagName) ? full.shadowRoot ?? full : document.documentElement;
    if (host.parentNode !== home) home.appendChild(host);
  }
  let overtakes = 0;
  const MAX_OVERTAKES = 5;
  function tendHost() {
    if (!host) return;
    placeHost();
    if (overtakes >= MAX_OVERTAKES) return;
    let sibling = host.nextElementSibling;
    for (let seen = 0; sibling && seen < 20; seen += 1, sibling = sibling.nextElementSibling) {
      const style = getComputedStyle(sibling);
      if (style.zIndex === TOP && style.position !== "static") {
        overtakes += 1;
        host.parentNode?.appendChild(host);
        return;
      }
    }
  }
  function trackKeyboard(target) {
    const visual = window.visualViewport;
    if (!visual || typeof visual.addEventListener !== "function") return;
    const update = () => {
      target.style.setProperty("--lt-kb", `${keyboardInset(window.innerHeight, visual)}px`);
    };
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    update();
  }
  const CONTAINED = [
    "click",
    "dblclick",
    "auxclick",
    "contextmenu",
    "pointerdown",
    "pointerup",
    "pointermove",
    "pointercancel",
    "mousedown",
    "mouseup",
    "touchstart",
    "touchend",
    "touchmove",
    "touchcancel",
    "wheel"
  ];
  function containEvents(target) {
    const stop = (event) => event.stopPropagation();
    for (const type of CONTAINED) target.addEventListener(type, stop, { passive: true });
  }
  function applyPopupOpacity(raw) {
    if (!host) return;
    const percent = clampOpacity(raw);
    host.style.setProperty("--lt-opacity", `${percent}%`);
    host.toggleAttribute("data-translucent", percent < MAX_OPACITY);
  }
  function uiRoot() {
    if (shadow) return shadow;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.dataset["version"] = scriptVersion();
    host.setAttribute(
      "style",
      [
        "all: initial",
        "font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, sans-serif",
        "color: #09090b",
        "position: fixed",
        "top: 0",
        "left: 0",
        "width: 100%",
        "height: 100%",
        `z-index: ${TOP}`,
        "pointer-events: none"
      ].map((rule) => `${rule} !important`).join(";")
    );
    shadow = host.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = `${styles}
${OVERLAY_CSS}`;
    shadow.appendChild(sheet);
    containEvents(host);
    applyPopupOpacity(getSettings().popupOpacity);
    placeHost();
    trackKeyboard(host);
    for (const type of ["fullscreenchange", "webkitfullscreenchange"]) {
      document.addEventListener(type, placeHost);
    }
    return shadow;
  }
  function isOurs(node) {
    const element = node;
    return Boolean(element?.closest?.(`#${HOST_ID}`)) || element?.getRootNode?.() === shadow;
  }
  const COMPACT_QUERY = "(max-width: 640px), (pointer: coarse)";
  const isCompact = () => window.matchMedia(COMPACT_QUERY).matches;
  let menu = null;
  let teardown = null;
  function closeMenu() {
    teardown?.();
    teardown = null;
    menu?.remove();
    menu = null;
  }
  const isMenuOpen = () => menu !== null;
  function buildItem(item) {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "lt-menu-item";
    entry.setAttribute("role", "menuitem");
    entry.innerHTML = item.icon ? icon(item.icon) : '<span class="lt-icon"></span>';
    const label = document.createElement("span");
    label.textContent = item.label;
    entry.appendChild(label);
    if (item.disabled) entry.disabled = true;
    const field = item.field;
    if (!field) {
      entry.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        item.run();
      });
      return entry;
    }
    const group = document.createElement("div");
    group.className = "lt-menu-ask";
    const row = document.createElement("div");
    row.className = "lt-field-row";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "lt-input";
    input.value = field.value;
    input.placeholder = field.placeholder;
    input.setAttribute("aria-label", field.placeholder);
    input.enterKeyHint = "send";
    const send = document.createElement("button");
    send.type = "button";
    send.className = "lt-btn lt-primary lt-square";
    send.setAttribute("aria-label", field.sendLabel);
    send.innerHTML = icon("send");
    row.append(input, send);
    group.append(entry, row);
    const submit = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text2 = input.value;
      closeMenu();
      field.submit(text2);
    };
    entry.addEventListener("click", submit);
    send.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) submit(event);
    });
    return group;
  }
  function openMenu(at, items, opener) {
    closeMenu();
    const compact = isCompact();
    const element = document.createElement("div");
    element.className = compact ? "lt-menu lt-sheet" : "lt-menu";
    element.setAttribute("role", "menu");
    for (const item of items) {
      if (item.divider) {
        const rule = document.createElement("div");
        rule.className = "lt-menu-rule";
        element.appendChild(rule);
      }
      element.appendChild(buildItem(item));
    }
    for (const type of ["keydown", "keyup", "keypress"]) {
      element.addEventListener(type, (event) => {
        if (event.key !== "Escape") event.stopPropagation();
      });
    }
    let outer = element;
    if (compact) {
      const scrim = document.createElement("div");
      scrim.className = "lt-scrim";
      scrim.appendChild(element);
      scrim.addEventListener("click", (event) => {
        if (event.target !== scrim) return;
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
      });
      outer = scrim;
    }
    uiRoot().appendChild(outer);
    menu = outer;
    if (!compact) {
      const box = element.getBoundingClientRect();
      const left = Math.max(4, Math.min(at.left, window.innerWidth - box.width - 4));
      const top = Math.max(4, Math.min(at.top, window.innerHeight - box.height - 4));
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    }
    const away = (event) => {
      const path = event.composedPath();
      if (path.includes(element) || opener && path.includes(opener)) return;
      closeMenu();
    };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeMenu();
    };
    const scrolled = (event) => {
      if (!isOurs(event.target)) closeMenu();
    };
    if (!compact) document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", escape, true);
    if (!compact) window.addEventListener("scroll", scrolled, true);
    window.addEventListener("blur", closeMenu);
    teardown = () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("blur", closeMenu);
    };
    element.querySelector(".lt-menu-item:not(:disabled)")?.focus({ preventScroll: true });
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
  function buildField(field, settings) {
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
      slider.value = String(settings[field.key]);
      const readout = document.createElement("span");
      readout.className = "lt-readout";
      const wantsPreview = field.key === "outlineScale";
      const livePopup = field.key === "popupOpacity";
      const preview = document.createElement("canvas");
      preview.className = "lt-preview";
      preview.width = 460;
      preview.height = 64;
      const refresh = () => {
        const value = Number(slider.value);
        readout.textContent = field.unit === "%" ? `${Math.round(value * 100)}%` : field.unit === "pct" ? `${Math.round(value)}%` : `${value.toFixed(1)}x`;
        if (wantsPreview) drawOutlinePreview(preview, value);
        if (livePopup) applyPopupOpacity(value);
      };
      slider.addEventListener("input", refresh);
      refresh();
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
      select.value = String(settings[field.key]);
      input = select;
    } else {
      const control = document.createElement("input");
      control.type = field.type;
      if (field.step) control.step = field.step;
      if (field.type === "checkbox") {
        control.checked = Boolean(settings[field.key]);
        row.classList.add("lt-row-check");
      } else {
        control.value = field.key === "cacheBytes" ? String(Math.round(settings.cacheBytes / (1024 * 1024) * 10) / 10) : String(settings[field.key]);
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
  function buildActions(pro) {
    const commands2 = panelCommands().filter((command) => pro || command.essential);
    if (!commands2.length) return null;
    const fragment = document.createDocumentFragment();
    const heading = document.createElement("div");
    heading.className = "lt-group";
    heading.textContent = "Actions";
    fragment.appendChild(heading);
    const row = document.createElement("div");
    row.className = "lt-actions";
    for (const command of commands2) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lt-btn";
      button.textContent = command.label;
      button.addEventListener("click", () => {
        closeSettings();
        command.run();
      });
      row.appendChild(button);
    }
    fragment.appendChild(row);
    const note = document.createElement("div");
    note.className = "lt-note";
    note.textContent = "These run at once, and discard anything unsaved above.";
    fragment.appendChild(note);
    return fragment;
  }
  function collect(root) {
    const patch = {};
    for (const field of FIELDS) {
      const input = root.querySelector(
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
    applyPopupOpacity(getSettings().popupOpacity);
  }
  function openSettings(onSaved) {
    if (panel$1) {
      closeSettings();
      return;
    }
    const settings = getSettings();
    const backdrop = document.createElement("div");
    backdrop.className = "lt-panel-backdrop";
    backdrop.innerHTML = `
    <div class="lt-panel" role="dialog" aria-label="Lens Translate settings">
      <header class="lt-panel-head">
        <strong>Lens Translate</strong>
        <button class="lt-x" type="button" aria-label="Close" data-act="cancel">${icon("close")}</button>
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
    const fill = (draft) => {
      if (!body2) return;
      body2.textContent = "";
      const pro = draft.uiMode === "pro";
      for (const group of GROUPS) {
        const fields = FIELDS.filter((field) => field.group === group && (pro || field.essential));
        if (!fields.length) continue;
        const heading = document.createElement("div");
        heading.className = "lt-group";
        heading.textContent = group;
        body2.appendChild(heading);
        for (const field of fields) body2.appendChild(buildField(field, draft));
      }
      const actions = buildActions(pro);
      if (actions) body2.appendChild(actions);
      if (!pro) {
        const note = document.createElement("div");
        note.className = "lt-note";
        note.textContent = 'Switch Interface to "pro" for layout, legibility, caching and the rest.';
        body2.appendChild(note);
      }
      body2.querySelector('[data-key="uiMode"]')?.addEventListener("change", () => fill({ ...draft, ...collect(backdrop) }));
    };
    fill(settings);
    backdrop.addEventListener("click", (event) => {
      const target = event.target;
      if (target === backdrop) return closeSettings();
      const action = target.closest("[data-act]")?.dataset["act"];
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
    if (!isCompact()) backdrop.querySelector(".lt-input")?.focus();
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
        <button class="lt-x" type="button" aria-label="Close" data-act="close">${icon("close")}</button>
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
      if (event.target === backdrop) return closeReport();
      const target = event.target.closest("[data-act]");
      if (!target) return void 0;
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
  let active = null;
  function closeTool() {
    active?.close();
    active = null;
  }
  function repositionTool() {
    active?.reposition();
  }
  function openFrame(options, kind, onLayout) {
    closeTool();
    const first = options.rect();
    if (!first) return null;
    const root = uiRoot();
    const layer = document.createElement("div");
    layer.className = `lt-tool lt-tool-${kind}`;
    const bar = document.createElement("div");
    bar.className = "lt-bar";
    bar.setAttribute("role", "toolbar");
    let current = first;
    const place2 = (rect) => {
      current = rect;
      layer.style.left = `${rect.left}px`;
      layer.style.top = `${rect.top}px`;
      layer.style.width = `${rect.width}px`;
      layer.style.height = `${rect.height}px`;
    };
    place2(first);
    const escape = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeTool();
    };
    document.addEventListener("keydown", escape, true);
    for (const type of ["keydown", "keyup", "keypress"]) {
      bar.addEventListener(type, (event) => {
        if (event.key !== "Escape") event.stopPropagation();
      });
    }
    root.append(layer, bar);
    root.host.setAttribute("data-tool", kind);
    active = {
      close: () => {
        document.removeEventListener("keydown", escape, true);
        root.host.removeAttribute("data-tool");
        layer.remove();
        bar.remove();
      },
      reposition: () => {
        refresh();
      }
    };
    const mine = active;
    const refresh = () => {
      if (active !== mine) return false;
      const rect = options.rect();
      if (!rect) {
        closeTool();
        return false;
      }
      place2(rect);
      onLayout();
      return true;
    };
    let typed = "";
    const setBar = (content) => {
      bar.textContent = "";
      const text2 = document.createElement("div");
      text2.className = "lt-bar-text";
      if (content.busy) text2.innerHTML = icon("loader", 16);
      text2.append(content.text);
      bar.appendChild(text2);
      let input = null;
      if (content.input) {
        input = document.createElement("input");
        input.type = "text";
        input.className = "lt-input";
        input.placeholder = content.input.placeholder;
        input.setAttribute("aria-label", content.input.placeholder);
        input.value = typed;
        const field = input;
        field.addEventListener("input", () => {
          typed = field.value;
        });
        bar.appendChild(input);
      }
      const row = document.createElement("div");
      row.className = "lt-bar-buttons";
      for (const button of content.buttons ?? []) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = button.primary ? "lt-btn lt-primary" : "lt-btn";
        element.innerHTML = button.icon ? icon(button.icon, 16) : "";
        element.append(button.label);
        element.disabled = button.disabled === true;
        element.addEventListener("click", () => button.run());
        row.appendChild(element);
      }
      const close = document.createElement("button");
      close.type = "button";
      close.className = "lt-btn lt-ghost lt-square";
      close.setAttribute("aria-label", "Close");
      close.innerHTML = icon("close", 16);
      close.addEventListener("click", closeTool);
      row.appendChild(close);
      bar.appendChild(row);
      return input;
    };
    return { layer, size: () => current, refresh, setBar };
  }
  function openRegionTool(options) {
    let box = null;
    const selection = document.createElement("div");
    selection.className = "lt-sel";
    selection.hidden = true;
    const draw = () => {
      if (!frame || !box) return;
      const rect = boxToRect(box, frame.size());
      selection.style.left = `${rect.left}px`;
      selection.style.top = `${rect.top}px`;
      selection.style.width = `${rect.width}px`;
      selection.style.height = `${rect.height}px`;
    };
    const frame = openFrame(options, "region", draw);
    if (!frame) return false;
    frame.layer.appendChild(selection);
    const idle = () => {
      frame.setBar({ text: "Drag over the part of the picture to search" });
    };
    const chosen = () => {
      const chosenBox = box;
      if (!chosenBox) return;
      const input = frame.setBar({
        text: "Search this area",
        input: { placeholder: "Add a question (optional)" },
        buttons: [
          {
            label: "Search",
            icon: "search",
            primary: true,
            run: () => send("visual")
          },
          { label: "Ask AI", icon: "sparkles", run: () => send("ai") }
        ]
      });
      const send = (mode) => {
        const text2 = input?.value.trim() ?? "";
        closeTool();
        options.onSearch(chosenBox, mode, text2);
      };
      input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) send("visual");
      });
    };
    idle();
    let start2 = null;
    let before = null;
    const pictureOnScreen = () => frame.size();
    frame.layer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (!frame.refresh()) return;
      event.preventDefault();
      start2 = { x: event.clientX, y: event.clientY };
      before = box;
      try {
        frame.layer.setPointerCapture(event.pointerId);
      } catch {
      }
    });
    frame.layer.addEventListener("pointermove", (event) => {
      if (!start2) return;
      const dragged = dragToBox(start2, { x: event.clientX, y: event.clientY }, pictureOnScreen());
      if (!dragged) return;
      box = dragged;
      selection.hidden = false;
      draw();
    });
    const finish = (event) => {
      if (!start2) return;
      const released = boxAfterRelease(start2, { x: event.clientX, y: event.clientY }, pictureOnScreen(), before);
      start2 = null;
      box = released.box;
      if (!box) return;
      selection.hidden = false;
      draw();
      if (released.changed) chosen();
    };
    frame.layer.addEventListener("pointerup", finish);
    frame.layer.addEventListener("pointercancel", () => {
      if (!start2) return;
      start2 = null;
      box = before;
      selection.hidden = !box;
      draw();
    });
    return true;
  }
  function openObjectsTool(options) {
    const dots = [];
    const layout = () => {
      if (!frame) return;
      const size = frame.size();
      for (const { object, dot, outline } of dots) {
        if (!object.geometry) continue;
        const centre = centreOf(object.geometry, size);
        dot.style.left = `${centre.x}px`;
        dot.style.top = `${centre.y}px`;
        const rect = boxToRect(object.geometry, size);
        outline.style.left = `${rect.left}px`;
        outline.style.top = `${rect.top}px`;
        outline.style.width = `${rect.width}px`;
        outline.style.height = `${rect.height}px`;
      }
    };
    const frame = openFrame(options, "objects", layout);
    if (!frame) return false;
    const mine = active;
    const clear = () => {
      for (const { dot, outline } of dots) {
        dot.remove();
        outline.remove();
      }
      dots.length = 0;
    };
    const show = (text2) => {
      clear();
      frame.setBar({ text: text2, busy: true });
      void options.load().then((source) => {
        if (active !== mine) return;
        if (!source) return closeTool();
        const list = source.objects;
        const found = list.filter((object) => object.geometry);
        if (!found.length) {
          frame.setBar({ text: "Lens found no separate objects in this picture" });
          return void 0;
        }
        found.forEach((object, index) => {
          const outline = document.createElement("div");
          outline.className = "lt-objbox";
          const dot = document.createElement("button");
          dot.type = "button";
          dot.className = "lt-dot";
          dot.setAttribute("aria-label", `Search object ${index + 1}`);
          dot.addEventListener("click", () => {
            if (!objectsStillValid(source, list)) {
              show("Looking for objects again...");
              return;
            }
            closeTool();
            options.onPick(source, object.id);
          });
          frame.layer.append(dot, outline);
          dots.push({ object, dot, outline });
        });
        layout();
        frame.setBar({ text: `Tap a dot to search that object (${found.length} found)` });
        return void 0;
      });
    };
    show("Looking for objects...");
    return true;
  }
  function openTextTool(options) {
    let items = pickables([]);
    const picked = /* @__PURE__ */ new Set();
    const words = [];
    const layout = () => {
      if (!frame) return;
      const size = frame.size();
      items.forEach((item, index) => {
        const element = words[index];
        if (!element) return;
        const rect = boxToRect(item.geometry, size);
        element.style.left = `${rect.left}px`;
        element.style.top = `${rect.top}px`;
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.transform = item.geometry.angle ? `rotate(${item.geometry.angle}deg)` : "";
      });
    };
    const frame = openFrame(options, "text", layout);
    if (!frame) return false;
    frame.setBar({ text: "Reading the text...", busy: true });
    const mine = active;
    const bar = () => {
      const text2 = joinPicked(items, picked);
      frame.setBar({
        text: picked.size ? text2 : "Tap or drag across words to pick them",
        buttons: [
          {
            label: picked.size === items.length ? "None" : "All",
            run: () => {
              const all2 = picked.size !== items.length;
              items.forEach((_, index) => set(index, all2));
              bar();
            }
          },
          { label: "Copy", icon: "copy", disabled: !picked.size, run: () => options.onCopy(text2) },
          {
            label: "Search",
            icon: "search",
            primary: true,
            disabled: !picked.size,
            run: () => {
              closeTool();
              options.onSearch(text2);
            }
          }
        ]
      });
    };
    const set = (index, on) => {
      if (on) picked.add(index);
      else picked.delete(index);
      words[index]?.classList.toggle("lt-on", on);
    };
    const wordAt = (x, y) => {
      const hit = uiRoot().elementFromPoint(x, y);
      return hit ? words.indexOf(hit) : -1;
    };
    let painting = null;
    frame.layer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const index = wordAt(event.clientX, event.clientY);
      if (index < 0) return;
      event.preventDefault();
      painting = !picked.has(index);
      set(index, painting);
      try {
        frame.layer.setPointerCapture(event.pointerId);
      } catch {
      }
    });
    frame.layer.addEventListener("pointermove", (event) => {
      if (painting === null) return;
      const index = wordAt(event.clientX, event.clientY);
      if (index >= 0) set(index, painting);
    });
    for (const type of ["pointerup", "pointercancel"]) {
      frame.layer.addEventListener(type, () => {
        if (painting === null) return;
        painting = null;
        bar();
      });
    }
    void options.paragraphs.then((paragraphs) => {
      if (active !== mine) return;
      if (!paragraphs) return closeTool();
      items = pickables(paragraphs);
      if (!items.length) {
        frame.setBar({ text: "Lens found no text in this picture" });
        return void 0;
      }
      for (const item of items) {
        const element = document.createElement("div");
        element.className = "lt-word";
        element.title = item.text;
        frame.layer.appendChild(element);
        words.push(element);
      }
      layout();
      bar();
      return void 0;
    });
    return true;
  }
  function start({ framed, hovered }) {
    let settings = getSettings();
    let site = siteMode();
    const active2 = () => settings.enabled && site !== "off";
    setTransport(gmTransport);
    ignoreElements((element) => element.id === HOST_ID || isCover(element));
    const root = uiRoot();
    const controls = document.createElement("div");
    controls.id = "lt-controls";
    root.appendChild(controls);
    function control(id, label, content) {
      const element = document.createElement("div");
      element.id = id;
      element.innerHTML = content;
      element.title = label;
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", label);
      return element;
    }
    const button = control(
      "lt-button",
      "Translate the text in this image (click again to undo)",
      icon("translate") + icon("loader")
    );
    const gear = control("lt-gear", "Lens Translate settings", icon("settings", 16));
    const more = control("lt-more", "Search, ask, copy and more", icon("more", 16));
    controls.append(more, gear, button);
    const toastEl = document.createElement("div");
    toastEl.id = "lt-toast";
    toastEl.setAttribute("role", "status");
    root.appendChild(toastEl);
    let toastTimer;
    function hideToast() {
      window.clearTimeout(toastTimer);
      toastEl.classList.remove("lt-show");
    }
    function toast(message, ms = 3200, link) {
      toastEl.textContent = "";
      const text2 = document.createElement("span");
      text2.textContent = message;
      toastEl.appendChild(text2);
      if (link) {
        const anchor = document.createElement("a");
        anchor.className = "lt-btn lt-primary";
        anchor.href = link.href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.innerHTML = icon("external", 16);
        anchor.append(link.label);
        anchor.addEventListener("click", hideToast);
        const close = document.createElement("button");
        close.type = "button";
        close.className = "lt-btn lt-ghost lt-square";
        close.setAttribute("aria-label", "Dismiss");
        close.innerHTML = icon("close", 16);
        close.addEventListener("click", hideToast);
        if (link.copy) {
          const address = document.createElement("span");
          address.className = "lt-url";
          address.textContent = link.href;
          text2.appendChild(address);
          const copy = document.createElement("button");
          copy.type = "button";
          copy.className = "lt-btn";
          copy.innerHTML = icon("copy", 16);
          copy.append("Copy");
          copy.addEventListener("click", () => {
            void copyText(link.href).then((done) => {
              if (done) toast("Address copied");
              else toast("Could not copy; select the address instead", 0, link);
            });
          });
          toastEl.append(anchor, copy, close);
        } else {
          toastEl.append(anchor, close);
        }
      }
      toastEl.classList.toggle("lt-has-link", Boolean(link));
      toastEl.classList.add("lt-show");
      window.clearTimeout(toastTimer);
      if (ms > 0) toastTimer = window.setTimeout(hideToast, ms);
    }
    const busy = /* @__PURE__ */ new WeakSet();
    const showing = /* @__PURE__ */ new Map();
    function naturalSizeOf(target) {
      if (target.kind !== "img") return void 0;
      const { naturalWidth, naturalHeight } = target.element;
      return naturalWidth && naturalHeight ? { width: naturalWidth, height: naturalHeight } : void 0;
    }
    const forgetter = (img) => () => {
      showing.delete(img);
      if (currentTarget?.element === img) button.classList.remove("lt-active");
    };
    const SWEEP_MS = 3e3;
    function sweep() {
      if (document.hidden) return;
      tendHost();
      sweepCovers();
      sweepOverlays();
      repositionTool();
      for (const img of [...showing.keys()]) {
        if (!img.isConnected || !isTranslated(img)) showing.delete(img);
      }
    }
    window.setInterval(sweep, SWEEP_MS);
    const isTranslated = (img) => isCovered(img) || hasOverlay(img);
    function undo(img) {
      showing.delete(img);
      results.delete(img);
      const restored = uncoverImage(img) || clearOverlay(img);
      if (restored) button.classList.remove("lt-active");
      return restored;
    }
    const results = /* @__PURE__ */ new WeakMap();
    let lastShown = null;
    let working = 0;
    function setWorking(delta) {
      working += delta;
      button.classList.toggle("lt-busy", working > 0);
    }
    let lastFailure = "";
    async function translate(target, options = {}) {
      const img = target.element;
      const say = (message, ms) => {
        if (!options.quiet) toast(message, ms);
      };
      if (busy.has(img)) return "skipped";
      if (!settings.enabled) {
        say("Translation is switched off in settings");
        return "skipped";
      }
      if (site === "off") {
        say(`Lens Translate is switched off on ${hostOf()} (userscript menu: toggle for this site)`);
        return "skipped";
      }
      if (undo(img)) return "undone";
      busy.add(img);
      setWorking(1);
      button.classList.remove("lt-error");
      try {
        const key = cacheKey(target.url, settings);
        const displayedWidth = img.getBoundingClientRect().width;
        if (settings.renderMode === "canvas" && target.url && target.kind !== "background") {
          const done = getRender(
            renderKey(key, settings, displayedWidth),
            settings,
            naturalSizeOf(target)
          );
          if (done && coverImage(img, URL.createObjectURL(done), { onGone: forgetter(img) })) {
            shown(img, target, getCached(key, settings, naturalSizeOf(target)));
            return "shown";
          }
        }
        const prepared = await acquireSource(target);
        try {
          const size = { width: prepared.width, height: prepared.height };
          let result = target.url ? getCached(key, settings, size) : void 0;
          const hash = result ? "" : fingerprint(prepared.source, prepared.width, prepared.height);
          if (!result && hash) {
            const remembered = await getStored(hash, settings);
            if (remembered) {
              result = remembered;
              if (target.url) putCached(key, result, settings, size);
            }
          }
          if (!result) {
            const upload2 = await encodeForUpload(prepared.source, settings);
            result = await callLens(upload2, settings);
            if (target.url) putCached(key, result, settings, size);
            void putStored(hash, result, settings);
          }
          if (!result.blocks.length) {
            const detected = result.ocr.some((p) => p.lines.length > 0);
            results.set(img, result);
            say(
              detected ? "Lens read the text but returned no translation (same language?)" : "Lens found no text in this image"
            );
            return "empty";
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
            if (target.url) {
              putRender(renderKey(key, settings, displayedWidth), blob, settings, size);
            }
            const covered = coverImage(img, URL.createObjectURL(blob), {
              onGone: forgetter(img),
              ...target.background ? {
                background: {
                  spec: target.background,
                  natural: { width: prepared.width, height: prepared.height }
                }
              } : {}
            });
            if (!covered) {
              lastFailure = "it cannot be covered here";
              say(
                target.kind === "background" ? "This background is tiled or clipped in a way a translation cannot follow" : "This image cannot be covered here"
              );
              return "failed";
            }
          } else if (target.kind === "background") {
            lastFailure = "backgrounds need the canvas renderer";
            say("Backgrounds need the canvas renderer (Render as, in settings)");
            return "failed";
          } else if (!renderTranslation(
            img,
            result.blocks,
            settings,
            { width: prepared.width, height: prepared.height },
            root,
            { onGone: forgetter(img) }
          )) {
            lastFailure = "nothing could be placed on it";
            say("Nothing could be placed on this image");
            return "failed";
          }
          shown(img, target, result);
          return "shown";
        } finally {
          prepared.release();
        }
      } catch (error) {
        lastFailure = error.message;
        button.classList.add("lt-error");
        say(`Lens: ${lastFailure}`, 5e3);
        window.setTimeout(() => button.classList.remove("lt-error"), 3e3);
        return "failed";
      } finally {
        busy.delete(img);
        setWorking(-1);
      }
    }
    function shown(img, target, result) {
      showing.set(img, target);
      if (result) results.set(img, result);
      lastShown = new WeakRef(img);
      if (currentTarget?.element === img) button.classList.add("lt-active");
    }
    const CONCURRENCY = 2;
    const queued = [];
    let running = 0;
    function pump() {
      while (running < CONCURRENCY) {
        const start2 = queued.shift();
        if (!start2) return;
        running += 1;
        start2();
      }
    }
    function schedule(job) {
      return new Promise((resolve2, reject) => {
        queued.push(() => {
          void job().then(resolve2, reject).finally(() => {
            running -= 1;
            pump();
          });
        });
        pump();
      });
    }
    async function translateAll(targets2) {
      const tally = { shown: 0, empty: 0, failed: 0 };
      await Promise.all(
        targets2.map(
          (target) => schedule(async () => {
            const outcome = await translate(target, { quiet: true });
            if (outcome === "shown") tally.shown += 1;
            else if (outcome === "empty") tally.empty += 1;
            else if (outcome === "failed") tally.failed += 1;
          })
        )
      );
      return tally;
    }
    const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
    function inView(target) {
      if (!target.element.isConnected) return false;
      const part = visiblePart(target.element);
      return part.width * part.height > 0 && isBigEnough(target, settings.minImageSize);
    }
    function untranslatedInView(candidates) {
      return candidates.filter(
        (target) => target.kind !== "video" && inView(target) && !isTranslated(target.element) && !busy.has(target.element)
      );
    }
    function summarise(tally, total2) {
      const parts = [`Translated ${tally.shown} of ${plural(total2, "image")}`];
      if (tally.empty) parts.push(`${tally.empty} had no text`);
      if (tally.failed) parts.push(`${tally.failed} failed (${lastFailure})`);
      return parts.join("; ");
    }
    async function translateVisible() {
      if (!settings.enabled || site === "off") {
        toast(
          site === "off" ? `Lens Translate is switched off on ${hostOf()}` : "Translation is switched off in settings"
        );
        return;
      }
      const targets2 = untranslatedInView(collect$1(settings.minImageSize));
      if (!targets2.length) {
        toast("Nothing left to translate in view");
        return;
      }
      toast(`Translating ${plural(targets2.length, "image")}...`, 12e4);
      toast(summarise(await translateAll(targets2), targets2.length), 5e3);
    }
    const autoTried = /* @__PURE__ */ new WeakMap();
    let autoTimer = 0;
    let lastAutoComplaint = 0;
    function autoTranslate() {
      if (site !== "auto" || !active2()) return;
      const targets2 = untranslatedInView(known).filter(
        (target) => autoTried.get(target.element) !== target.url
      );
      if (!targets2.length) return;
      for (const target of targets2) autoTried.set(target.element, target.url);
      void translateAll(targets2).then((tally) => {
        if (tally.failed && Date.now() - lastAutoComplaint > 3e4) {
          lastAutoComplaint = Date.now();
          toast(`Auto-translate: ${plural(tally.failed, "image")} failed (${lastFailure})`, 5e3);
        }
      });
    }
    function scheduleAuto() {
      if (autoTimer || site !== "auto") return;
      autoTimer = window.setTimeout(() => {
        autoTimer = 0;
        autoTranslate();
      }, 250);
    }
    let currentTarget = null;
    let hideTimer;
    let gearTimer;
    const GEAR_DELAY_MS = 550;
    let extrasShown = false;
    function showGear() {
      extrasShown = true;
      controls.classList.add("lt-extras");
    }
    function hideGear() {
      window.clearTimeout(gearTimer);
      extrasShown = false;
      controls.classList.remove("lt-extras");
    }
    function showButton(target, anchor) {
      if (!settings.showButton || site === "off") return;
      const img = target.element;
      currentTarget = target;
      const rect = anchor ?? img.getBoundingClientRect();
      controls.style.top = `${rect.top + 6}px`;
      controls.style.left = `${rect.left + rect.width - 6}px`;
      controls.classList.add("lt-on");
      button.classList.toggle("lt-active", isTranslated(img));
      window.clearTimeout(gearTimer);
      if (!extrasShown) gearTimer = window.setTimeout(showGear, GEAR_DELAY_MS);
    }
    function hideButton() {
      controls.classList.remove("lt-on");
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
      autoTranslate();
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
        const found = settings.showButton && site !== "off" ? mostVisible() : null;
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
        showGear();
      });
    }
    function onImageLoad(event) {
      if (event.target?.tagName === "IMG") somethingChanged();
    }
    const TOUCH_QUERY = "(hover: none), (pointer: coarse)";
    let watching = false;
    function syncWatchers() {
      const wanted = pinned || site === "auto";
      if (wanted === watching) return false;
      watching = wanted;
      if (watching) {
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
      }
      return watching;
    }
    function applyButtonMode() {
      const wanted = settings.buttonMode === "pinned" || settings.buttonMode === "auto" && window.matchMedia(TOUCH_QUERY).matches;
      const turnedOn = wanted && !pinned;
      if (wanted !== pinned) {
        pinned = wanted;
        if (!pinned) hideButton();
      }
      const started = syncWatchers();
      if (turnedOn && !started) refresh();
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
    for (const control2 of [button, gear, more]) {
      control2.addEventListener("mouseover", () => window.clearTimeout(hideTimer));
      control2.addEventListener("mouseout", () => {
        if (pinned) return;
        hideTimer = window.setTimeout(hideButton, 300);
      });
    }
    async function redrawShowing() {
      const targets2 = [...showing.values()].filter((target) => target.element.isConnected);
      if (!targets2.length) return;
      for (const target of targets2) {
        undo(target.element);
        await translate(classify(target.element) ?? target);
      }
    }
    function showSettings() {
      hideToast();
      openSettings(onSaved);
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
        showSettings();
      },
      true
    );
    more.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isMenuOpen()) closeMenu();
        else openActions();
      },
      true
    );
    button.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (swallowClick) {
          swallowClick = false;
          return;
        }
        if (currentTarget) void translate(currentTarget);
      },
      true
    );
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!holding && !swallowClick) openActions();
    });
    document.addEventListener(
      "click",
      (event) => {
        const modifier = settings.hotkey;
        if (modifier === "none") return;
        const pressed = modifier === "alt" && event.altKey || modifier === "ctrl" && event.ctrlKey || modifier === "shift" && event.shiftKey;
        if (!pressed) return;
        if (site === "off") return;
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
      scheduleAuto();
      if (pinned) {
        emptyRetries = 0;
        updatePinned();
        return;
      }
      if (currentTarget?.element.isConnected) showButton(currentTarget);
      else if (currentTarget) hideButton();
    }
    function moved() {
      repositionTool();
      reposition();
    }
    window.addEventListener("resize", moved);
    window.addEventListener("scroll", moved, true);
    for (const type of ["fullscreenchange", "webkitfullscreenchange"]) {
      document.addEventListener(type, () => {
        emptyRetries = 0;
        if (watching) scheduleRefresh();
        moved();
      });
    }
    function subject() {
      const current = currentTarget?.element;
      if (current && results.has(current)) return current;
      const last = lastShown?.deref();
      if (last?.isConnected && results.has(last)) return last;
      return current ?? null;
    }
    async function copyFrom(kind, element = subject()) {
      const result = element ? results.get(element) : void 0;
      if (!result) {
        toast("Translate an image first, then its text can be copied");
        return;
      }
      const text2 = kind === "translation" ? translationText(result) : ocrText(result);
      const what = kind === "translation" ? "the translation" : "the original text";
      if (!text2) {
        toast(`There is no text to copy from ${what}`);
        return;
      }
      toast(
        await copyText(text2) ? `Copied ${what} (${plural(text2.length, "character")})` : "The browser would not let the script use the clipboard"
      );
    }
    const MAX_UPLOADS = 4;
    const uploads = /* @__PURE__ */ new Map();
    function stillShows(target) {
      if (!target.url) return target.element.isConnected;
      const now = classify(target.element);
      return Boolean(now?.url) && cacheKey(now?.url ?? "", settings) === cacheKey(target.url, settings);
    }
    const CHANGED = "The picture changed while it was open; try again on the new one";
    async function upload(target) {
      if (!stillShows(target)) throw new Error(CHANGED);
      const acquired = await acquireSource(target);
      try {
        const image = await encodeForUpload(acquired.source, settings);
        return await ImageSearch.upload(image, settings);
      } finally {
        acquired.release();
      }
    }
    function sessionFor(target) {
      if (!target.url) return upload(target);
      const key = cacheKey(target.url, settings);
      const held = uploads.get(key);
      if (held && (!held.search || held.search.fresh)) {
        uploads.delete(key);
        uploads.set(key, held);
        return held.promise;
      }
      const entry = { promise: upload(target) };
      uploads.set(key, entry);
      entry.promise.then(
        (search) => {
          entry.search = search;
        },
        () => {
          if (uploads.get(key) === entry) uploads.delete(key);
        }
      );
      for (const oldest of uploads.keys()) {
        if (uploads.size <= MAX_UPLOADS) break;
        uploads.delete(oldest);
      }
      return entry.promise;
    }
    const onTouch = () => window.matchMedia(TOUCH_QUERY).matches;
    const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
    const pageOptions = () => ({
      uiLanguage: settings.targetLang,
      dark: prefersDark()
    });
    function deliver(tab, url) {
      if (tab.go(url)) toast("Results opened in a new tab", 9e3, { href: url, label: "Open again" });
      else if (framed) toast("The results are ready", 0, { href: url, label: "Open", copy: true });
      else toast("The results are ready", 0, { href: url, label: "Open results" });
    }
    function searchPicture(target, pick, mode, text2, held) {
      if (!stillShows(target)) {
        closeTool();
        toast(CHANGED);
        return;
      }
      const tab = prepareTab(!onTouch());
      setWorking(1);
      button.classList.remove("lt-error");
      toast(mode === "ai" ? "Asking Lens..." : "Searching with Lens...", 12e4);
      void (async () => {
        const search = held ?? await sessionFor(target);
        let selection = pick;
        if (pick.kind === "region") {
          if (!stillShows(target)) throw new Error(CHANGED);
          const acquired = await acquireSource(target);
          try {
            const crop = await encodeRegion(
              { source: acquired.source, sourceWidth: acquired.width, sourceHeight: acquired.height },
              pick.box,
              settings
            );
            selection = { kind: "region", box: pick.box, crop };
          } finally {
            acquired.release();
          }
        }
        return search.search(selection, { mode, text: text2, ...pageOptions() });
      })().then(
        (url) => deliver(tab, url),
        (error) => {
          tab.cancel();
          lastFailure = error.message;
          button.classList.add("lt-error");
          toast(lensSaid(error), 5e3);
          window.setTimeout(() => button.classList.remove("lt-error"), 3e3);
        }
      ).finally(() => setWorking(-1));
    }
    function openNow(url) {
      deliver(prepareTab(true), url);
    }
    function naturalSize(target) {
      const element = target.element;
      if (target.kind === "img") {
        const { naturalWidth, naturalHeight } = element;
        return Promise.resolve(naturalWidth && naturalHeight ? { width: naturalWidth, height: naturalHeight } : null);
      }
      if (target.kind === "video") {
        const { videoWidth, videoHeight } = element;
        return Promise.resolve(videoWidth && videoHeight ? { width: videoWidth, height: videoHeight } : null);
      }
      if (target.kind === "canvas") {
        const { width, height } = element;
        return Promise.resolve(width && height ? { width, height } : null);
      }
      return new Promise((resolve2) => {
        const probe2 = new Image();
        probe2.onload = () => resolve2({ width: probe2.naturalWidth, height: probe2.naturalHeight });
        probe2.onerror = () => resolve2(null);
        probe2.src = target.url;
      });
    }
    const px2 = (value) => Number.parseFloat(value) || 0;
    function pictureRect(target, natural) {
      const element = target.element;
      if (!element.isConnected) return null;
      const bounds = element.getBoundingClientRect();
      if (!(bounds.width > 0 && bounds.height > 0)) return null;
      const style = getComputedStyle(element);
      const border = {
        top: px2(style.borderTopWidth),
        right: px2(style.borderRightWidth),
        bottom: px2(style.borderBottomWidth),
        left: px2(style.borderLeftWidth)
      };
      const outer = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
      if (target.kind === "background") {
        const spec = target.background;
        if (!spec) return outer;
        const padding = {
          top: px2(style.paddingTop),
          right: px2(style.paddingRight),
          bottom: px2(style.paddingBottom),
          left: px2(style.paddingLeft)
        };
        const area = spec.origin === "border-box" ? outer : spec.origin === "padding-box" ? insetRect(outer, border) : insetRect(insetRect(outer, border), padding);
        const painted = paintRect(spec, area, natural);
        return painted ? { left: area.left + painted.x, top: area.top + painted.y, width: painted.width, height: painted.height } : outer;
      }
      const content = insetRect(insetRect(outer, border), {
        top: px2(style.paddingTop),
        right: px2(style.paddingRight),
        bottom: px2(style.paddingBottom),
        left: px2(style.paddingLeft)
      });
      return fittedRect(content, natural, style.objectFit, style.objectPosition);
    }
    async function frameOf(target) {
      const natural = await naturalSize(target);
      if (!natural || !pictureRect(target, natural)) {
        toast("This picture cannot be measured yet");
        return null;
      }
      return () => pictureRect(target, natural);
    }
    function failed(error) {
      lastFailure = error.message;
      toast(lensSaid(error), 5e3);
      return null;
    }
    const lensSaid = (error) => error.message === CHANGED ? CHANGED : `Lens: ${error.message}`;
    async function selectArea(target) {
      const rect = await frameOf(target);
      if (!rect) return;
      openRegionTool({
        rect,
        onSearch: (box, mode, text2) => searchPicture(target, { kind: "region", box }, mode, text2)
      });
    }
    async function showObjects(target) {
      const rect = await frameOf(target);
      if (!rect) return;
      openObjectsTool({
        rect,
        load: () => sessionFor(target).then((search) => search, failed),
        onPick: (search, id) => searchPicture(target, { kind: "object", id }, "visual", "", search)
      });
    }
    function readText(target) {
      const held = results.get(target.element);
      if (held?.ocr.length) return Promise.resolve(held.ocr);
      return sessionFor(target).then((search) => search.result.ocr);
    }
    async function pickText(target) {
      const rect = await frameOf(target);
      if (!rect) return;
      openTextTool({
        rect,
        paragraphs: readText(target).then((paragraphs) => paragraphs, failed),
        onSearch: (text2) => openNow(textSearchUrl(text2, pageOptions())),
        onCopy: (text2) => void copied(text2, "the selected text")
      });
    }
    async function copied(text2, what) {
      toast(
        await copyText(text2) ? `Copied ${what} (${plural(text2.length, "character")})` : "The browser would not let the script use the clipboard"
      );
    }
    async function copyAny(target) {
      const result = results.get(target.element);
      const translated = result ? translationText(result) : "";
      if (translated) return copied(translated, "the translation");
      let text2 = result ? ocrText(result) : "";
      if (!text2) {
        toast("Reading the text...", 12e4);
        try {
          text2 = (await readText(target)).map((paragraph) => paragraph.lines.map((line) => line.text.trim()).filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
        } catch (error) {
          failed(error);
          return void 0;
        }
      }
      if (!text2) {
        toast("Lens found no text in this image");
        return void 0;
      }
      return copied(text2, "the text");
    }
    function openActions() {
      const target = currentTarget;
      if (!target) return;
      closeTool();
      hideToast();
      const translated = isTranslated(target.element);
      const words = results.has(target.element);
      const pro = settings.uiMode === "pro";
      const items = [
        {
          label: translated ? "Show the original" : "Translate this image",
          icon: translated ? "undo" : "translate",
          run: () => void translate(target)
        },
        {
          label: "Search this image",
          icon: "search",
          run: () => searchPicture(target, { kind: "image" }, "visual", "")
        },
        {
          label: "Ask AI about it",
          icon: "sparkles",
          run: () => {
          },
          field: {
            value: settings.aiPrompt,
            placeholder: "Ask about this picture (optional)",
            sendLabel: "Ask",
            submit: (text2) => searchPicture(target, { kind: "image" }, "ai", text2.trim())
          }
        }
      ];
      if (pro) {
        items.push(
          { label: "Select an area", icon: "area", divider: true, run: () => void selectArea(target) },
          { label: "Detected objects", icon: "objects", run: () => void showObjects(target) },
          { label: "Search selected text", icon: "text", run: () => void pickText(target) },
          {
            label: "Copy translation",
            icon: "copy",
            divider: true,
            run: () => void copyFrom("translation", target.element),
            disabled: !words
          },
          {
            label: "Copy original text",
            icon: "copy",
            run: () => void copyFrom("original", target.element),
            disabled: !words
          },
          { label: "Translate everything in view", icon: "images", run: () => void translateVisible() }
        );
      } else {
        items.push({
          label: translated ? "Copy translation" : "Copy text",
          icon: "copy",
          run: () => void copyAny(target)
        });
      }
      items.push({ label: "Settings", icon: "settings", divider: true, run: () => showSettings() });
      const rect = more.getBoundingClientRect();
      openMenu({ top: rect.bottom + 6, left: rect.right - 260 }, items, more);
    }
    const peek = (element, peeking) => peekCover(element, peeking) || peekOverlay(element, peeking);
    const HOLD_MS = 350;
    let holdTimer = 0;
    let holding = null;
    let swallowClick = false;
    function startHold(event) {
      if (event.button !== 0 || !currentTarget || !isTranslated(currentTarget.element)) return;
      const element = currentTarget.element;
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => {
        holding = element;
        swallowClick = true;
        peek(element, true);
        button.classList.add("lt-peeking");
      }, HOLD_MS);
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
      }
    }
    function endHold() {
      window.clearTimeout(holdTimer);
      if (holding) {
        peek(holding, false);
        holding = null;
        button.classList.remove("lt-peeking");
      }
      window.setTimeout(() => {
        swallowClick = false;
      }, 0);
    }
    button.addEventListener("pointerdown", startHold);
    for (const type of ["pointerup", "pointercancel"]) button.addEventListener(type, endHold);
    const PEEK_CODES = {
      backquote: ["Backquote"],
      shift: ["ShiftLeft", "ShiftRight"],
      control: ["ControlLeft", "ControlRight"]
    };
    let keyPeeking = false;
    function isTyping(event) {
      const node = event.composedPath()[0];
      if (!node?.tagName) return false;
      return node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
    }
    function endKeyPeek() {
      if (!keyPeeking) return;
      keyPeeking = false;
      peekAllCovers(false);
      peekAllOverlays(false);
    }
    document.addEventListener(
      "keydown",
      (event) => {
        if (isTyping(event)) return;
        if (settings.batchHotkey && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyT") {
          event.preventDefault();
          void translateVisible();
          return;
        }
        if (settings.peekKey === "off" || event.repeat || keyPeeking) return;
        if (!PEEK_CODES[settings.peekKey].includes(event.code)) return;
        keyPeeking = true;
        peekAllCovers(true);
        peekAllOverlays(true);
      },
      true
    );
    document.addEventListener(
      "keyup",
      (event) => {
        if (settings.peekKey !== "off" && PEEK_CODES[settings.peekKey].includes(event.code)) {
          endKeyPeek();
        }
      },
      true
    );
    window.addEventListener("blur", endKeyPeek);
    const addCommand = (command) => registerCommand(command, !framed);
    addCommand({
      menuLabel: "Lens Translate: settings",
      // The panel is where these are drawn, so it does not offer to open itself.
      label: null,
      run: () => showSettings()
    });
    addCommand({
      menuLabel: "Lens Translate: clear cache",
      label: "Clear cache",
      run: () => {
        const memory = cacheStats();
        clearCache();
        void storedStats().then(({ entries: entries2, bytes: bytes2 }) => {
          void clearStored();
          const total2 = memory.entries + entries2;
          toast(
            total2 ? `Cleared ${total2} cached result${total2 === 1 ? "" : "s"} (${((memory.bytes + bytes2) / 1048576).toFixed(1)} MB)` : "The cache was already empty"
          );
        });
      }
    });
    addCommand({
      menuLabel: "Lens Translate: undo all on this page",
      label: "Undo all on this page",
      essential: true,
      run: () => {
        showing.clear();
        const restored = uncoverAll() + clearAllOverlays();
        toast(restored ? `Restored ${restored} image${restored === 1 ? "" : "s"}` : "Nothing to restore");
      }
    });
    addCommand({
      menuLabel: "Lens Translate: translate all visible images",
      label: "Translate all in view",
      run: () => void translateVisible()
    });
    addCommand({
      menuLabel: "Lens Translate: copy translation",
      label: null,
      run: () => void copyFrom("translation")
    });
    addCommand({
      menuLabel: "Lens Translate: copy original text",
      label: null,
      run: () => void copyFrom("original")
    });
    function chooseSite(next) {
      site = next;
      setSiteMode(next);
      if (next === "off") {
        showing.clear();
        uncoverAll();
        clearAllOverlays();
        hideButton();
      }
      const started = syncWatchers();
      if (next === "auto" && !started) refresh();
      const host2 = hostOf();
      toast(
        next === "off" ? `Lens Translate is off on ${host2}` : next === "auto" ? `Images on ${host2} will be translated as they come into view` : `${host2} is back to the default`
      );
    }
    addCommand({
      menuLabel: "Lens Translate: toggle on/off for this site",
      label: "Toggle for this site",
      essential: true,
      run: () => chooseSite(site === "off" ? "default" : "off")
    });
    addCommand({
      menuLabel: "Lens Translate: toggle auto-translate for this site",
      label: "Toggle auto-translate here",
      run: () => chooseSite(site === "auto" ? "default" : "auto")
    });
    if (!framed) {
      addCommand({
        menuLabel: "Lens Translate: diagnostics",
        label: "Run diagnostics",
        essential: true,
        run: openDiagnostics
      });
    }
    addCommand({
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
    onReportSettings(() => showSettings());
    if (!framed) {
      window.addEventListener("hashchange", checkDebugHash);
      checkDebugHash();
    }
    applyButtonMode();
    if (hovered) showButton(hovered);
    void preloadStored([...SETTINGS_KEYS, SITES_KEY]).then((arrived) => {
      if (!arrived) return;
      settings = reloadSettings();
      reloadSites();
      site = siteMode();
      applyPopupOpacity(settings.popupOpacity);
      applyButtonMode();
    });
    window.matchMedia(TOUCH_QUERY).addEventListener("change", applyButtonMode);
  }
  const FRAME_MIN_WIDTH = 400;
  const FRAME_MIN_HEIGHT = 300;
  const RESIZE_SETTLE_MS = 200;
  function isFramed() {
    try {
      return window.top !== window;
    } catch {
      return true;
    }
  }
  const roomyFrame = (viewport) => viewport.width >= FRAME_MIN_WIDTH && viewport.height >= FRAME_MIN_HEIGHT;
  function shouldWake(viewport, pictures, minImageSize) {
    if (!roomyFrame(viewport)) return false;
    for (const picture of pictures) {
      if (picture.width >= minImageSize && picture.height >= minImageSize) return true;
    }
    return false;
  }
  function topHostname() {
    try {
      const origins = window.location.ancestorOrigins;
      const last = origins && origins.length ? origins.item(origins.length - 1) : null;
      if (last && last !== "null") return new URL(last).hostname;
    } catch {
    }
    try {
      if (window.parent === window.top && document.referrer) return new URL(document.referrer).hostname;
    } catch {
    }
    return null;
  }
  function shownSizes(targets2, minImageSize) {
    const sizes = [];
    for (const target of targets2) {
      if (!isBigEnough(target, minImageSize)) continue;
      const rect = target.element.getBoundingClientRect();
      sizes.push({ width: rect.width, height: rect.height });
    }
    return sizes;
  }
  function sleepUntilPicture(minImageSize, wake) {
    let awake = false;
    let timer = 0;
    const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
    const pointless = () => awake || !roomyFrame(viewport());
    const consider = (targets2, hovered) => {
      if (pointless()) return;
      const min = minImageSize();
      if (!shouldWake(viewport(), shownSizes(targets2, min), min)) return;
      awake = true;
      document.removeEventListener("load", onLoad, true);
      document.removeEventListener("pointerover", onPointer, true);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
      wake(hovered);
    };
    const scan = () => {
      timer = 0;
      if (pointless()) return;
      const found = [];
      for (const element of document.querySelectorAll("img, canvas, video")) {
        const target = classify(element);
        if (target) found.push(target);
      }
      consider(found, null);
    };
    function onLoad(event) {
      if (pointless()) return;
      const target = classify(event.target);
      if (target) consider([target], null);
    }
    function onPointer(event) {
      if (pointless()) return;
      const target = targetFromEvent(event, minImageSize(), () => false);
      if (target) consider([target], target);
    }
    function onResize() {
      if (!timer) timer = window.setTimeout(scan, RESIZE_SETTLE_MS);
    }
    document.addEventListener("load", onLoad, true);
    document.addEventListener("pointerover", onPointer, true);
    window.addEventListener("resize", onResize);
    scan();
  }
  if (!isFramed()) {
    start({ framed: false, hovered: null });
  } else {
    void (async () => {
      if (await preloadStored([...SETTINGS_KEYS, SITES_KEY])) {
        reloadSettings();
        reloadSites();
      }
      if (!getSettings().frames) return;
      if (siteMode() === "off") return;
      const top = topHostname();
      if (top && siteMode(hostOf(top)) === "off") return;
      sleepUntilPicture(
        () => getSettings().minImageSize,
        (hovered) => start({ framed: true, hovered })
      );
    })();
  }

})();