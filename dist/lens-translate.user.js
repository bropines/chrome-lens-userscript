// ==UserScript==
// @name         Lens Translate
// @namespace    https://github.com/bropines/chrome-lens-userscript
// @version      2.13.0
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
    preloaded = true;
    return true;
  }
  let preloaded = false;
  const storageReady = () => preloaded || !hasAsyncStorage();
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
    if (typeof _GM_openInTab === "function") return (url, background) => _GM_openInTab(url, background);
    if (typeof _GM?.openInTab === "function") return (url, background) => _GM.openInTab(url, background);
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
  function prepareTab(preopen, options = {}) {
    const viaHost = hostOpener();
    if (viaHost) {
      return {
        go(url) {
          try {
            const tab2 = viaHost(url, options.background === true);
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
        tab.document.body.textContent = options.waiting ?? "Searching with Lens...";
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
        out.push({
          id: command.id,
          label: command.label(),
          essential: command.essential === true,
          run: command.run
        });
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
  function ladder(hasBody, remember, allowFetch) {
    const latchedEncoding = remember ? workingEncoding : null;
    const encodings = !hasBody ? ["typed"] : latchedEncoding ? [latchedEncoding] : ["typed", "binary-string"];
    const rungs = encodings.map((encoding) => ({ transport: "gm", encoding }));
    if (allowFetch) rungs.push({ transport: "fetch", encoding: "typed" });
    const latchedTransport = remember ? workingTransport : null;
    return latchedTransport ? rungs.filter((rung) => rung.transport === latchedTransport) : rungs;
  }
  const BAD_REQUEST = 400;
  async function climb(attempt, remember, allowFetch = true) {
    const failures = [];
    for (const rung of ladder(attempt.body !== null, remember, allowFetch)) {
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
      if ((redirected || isWebPage(response)) && options.noFetchFallback === true) {
        throw new Error(`the host answered with a web page, not the file (HTTP ${response.status})`);
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
        // The same request the <img> would have made, cookies included - unless
        // the caller is fetching something public and said so.
        withCookies: options.anonymous !== true
      },
      false,
      options.noFetchFallback !== true
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
  function tilesVisibly(spec, rect2, area) {
    const coversX = rect2.x <= EPSILON && rect2.x + rect2.width >= area.width - EPSILON;
    const coversY = rect2.y <= EPSILON && rect2.y + rect2.height >= area.height - EPSILON;
    return spec.repeatX && !coversX || spec.repeatY && !coversY;
  }
  function mayBePicture(spec, area) {
    if (!spec.repeatX && !spec.repeatY) return true;
    if (spec.size.kind === "cover") return true;
    if (spec.size.kind === "contain") return false;
    const { width, height } = spec.size;
    const fills = (dimension, of) => {
      const length2 = resolve(dimension, of);
      return length2 !== null && length2 >= of - EPSILON;
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
    const rect2 = target.element.getBoundingClientRect();
    if (!(rect2.width >= minSize && rect2.height >= minSize)) return false;
    const painted = target.background && knownPaintedSize(target.background, { width: rect2.width, height: rect2.height });
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
  const VERSION = "2.13.0";
  const EN = {
    // --- the controls over a picture
    "act.translate": "Translate",
    "act.search": "Search image",
    "act.ask": "Ask AI",
    "act.area": "Select area",
    "act.objects": "Detected objects",
    "act.text": "Search text",
    "act.copy": "Copy",
    "act.edit": "Edit",
    "act.settings": "Settings",
    "act.menu": "Menu",
    "btn.translate": "Translate the text in this image (click again to undo)",
    "btn.settings": "Lens Translate settings",
    "btn.more": "Search, ask, copy and more",
    // --- the menu
    "menu.translate": "Translate this image",
    "menu.original": "Show the original",
    "menu.search": "Search this image",
    "menu.ask": "Ask AI about it",
    "menu.askPlaceholder": "Ask about this picture (optional)",
    "menu.askSend": "Ask",
    "menu.area": "Select an area",
    "menu.objects": "Detected objects",
    "menu.text": "Search selected text",
    "menu.copyTranslation": "Copy translation",
    "menu.copyOriginal": "Copy original text",
    "menu.copyText": "Copy text",
    "menu.edit": "Edit the translation",
    "menu.copyPicture": "Copy the picture",
    "menu.savePicture": "Save the picture",
    "menu.all": "Translate everything in view",
    "menu.settings": "Settings",
    // --- messages
    "toast.dismiss": "Dismiss",
    "toast.copy": "Copy",
    "toast.addressCopied": "Address copied",
    "toast.addressNotCopied": "Could not copy; select the address instead",
    "toast.off": "Translation is switched off in settings",
    "toast.siteOff": "Lens Translate is switched off on {host}",
    "toast.siteOffHint": "Lens Translate is switched off on {host} (settings: Sites)",
    "toast.noTranslation": "Lens read the text but returned no translation (same language?)",
    "toast.noText": "Lens found no text in this image",
    "toast.backgroundTiled": "This background is tiled or clipped in a way a translation cannot follow",
    "toast.cannotCover": "This image cannot be covered here",
    "toast.backgroundNeedsCanvas": "Backgrounds need the canvas renderer (Render as, in settings)",
    "toast.nothingPlaced": "Nothing could be placed on this image",
    "toast.lensError": "Lens: {message}",
    "toast.nothingLeft": "Nothing left to translate in view",
    "toast.batchStart": "Translating images: {count}...",
    "toast.batchDone": "Translated {shown} of {total}",
    "toast.batchEmpty": "no text: {count}",
    "toast.batchFailed": "failed: {count} ({reason})",
    "toast.autoFailed": "Auto-translate failed for images: {count} ({reason})",
    "toast.saved": "Settings saved",
    "toast.translateFirst": "Translate an image first, then its text can be copied",
    "toast.nothingToCopy": "There is no text to copy",
    "toast.copiedTranslation": "Translation copied (characters: {count})",
    "toast.copiedOriginal": "Original text copied (characters: {count})",
    "toast.copiedText": "Text copied (characters: {count})",
    "toast.clipboardDenied": "The browser would not let the script use the clipboard",
    "toast.copiedPicture": "Picture copied",
    "toast.pictureSavedInstead": "The browser would not copy a picture, so it was saved instead",
    "toast.pictureFirst": "Translate the picture first (with the canvas renderer)",
    "editor.title": "Edit the translation",
    "editor.hint": "Tap a paragraph to change it. Drag it to move its text.",
    "editor.paragraph": "Paragraph {n}",
    "editor.text": "Text",
    "editor.size": "Size",
    "editor.color": "Text",
    "editor.outline": "Outline",
    "editor.auto": "Auto",
    "editor.hide": "Hide text",
    "editor.original": "Show original",
    "editor.reset": "Reset",
    "editor.resetAll": "Reset all",
    "editor.copy": "Copy",
    "editor.save": "Save",
    "editor.cancel": "Cancel",
    "editor.apply": "Apply",
    "toast.changed": "The picture changed while it was open; try again on the new one",
    "toast.opened": "Results opened in a new tab",
    "toast.openAgain": "Open again",
    "toast.ready": "The results are ready",
    "toast.open": "Open",
    "toast.openResults": "Open results",
    "toast.asking": "Asking Lens...",
    "toast.searching": "Searching with Lens...",
    "toast.cannotMeasure": "This picture cannot be measured yet",
    "toast.reading": "Reading the text...",
    "toast.cleared": "Cache cleared: {count} results, {size} MB",
    "toast.cacheEmpty": "The cache was already empty",
    "toast.restored": "Images restored: {count}",
    "toast.nothingToRestore": "Nothing to restore",
    "toast.siteNowOff": "Lens Translate is off on {host}",
    "toast.siteNowAuto": "Images on {host} will be translated as they come into view",
    "toast.siteNowDefault": "{host} is back to the default",
    "toast.enabled": "Translation enabled",
    "toast.disabled": "Translation disabled",
    "toast.noPicture": "Point at a picture first",
    // --- commands, in the host menu and in the panel
    "cmd.settings": "Settings",
    "cmd.clearCache": "Clear cache",
    "cmd.undoAll": "Undo all on this page",
    "cmd.translateAll": "Translate all in view",
    "cmd.copyTranslation": "Copy translation",
    "cmd.copyOriginal": "Copy original text",
    "cmd.toggleSite": "Toggle for this site",
    "cmd.toggleAuto": "Toggle auto-translate here",
    "cmd.diagnostics": "Run diagnostics",
    "cmd.toggle": "Toggle on/off",
    // --- the tools drawn on a picture
    "tool.close": "Close",
    "tool.regionIdle": "Drag over the part of the picture to search",
    "tool.regionChosen": "Search this area",
    "tool.regionQuestion": "Add a question (optional)",
    "tool.search": "Search",
    "tool.askAi": "Ask AI",
    "tool.noObjects": "Lens found no separate objects in this picture",
    "tool.objectLabel": "Search object {n}",
    "tool.objectsAgain": "Looking for objects again...",
    "tool.objectsHint": "Tap a dot to search that object (found: {count})",
    "tool.objectsLooking": "Looking for objects...",
    "tool.reading": "Reading the text...",
    "tool.wordsHint": "Tap or drag across words to pick them",
    "tool.none": "None",
    "tool.all": "All",
    "tool.copy": "Copy",
    "tool.noText": "Lens found no text in this picture",
    // --- the diagnostics report
    "report.title": "Diagnostics",
    "report.aria": "Lens Translate diagnostics",
    "report.settings": "Settings",
    "report.copy": "Copy",
    "report.close": "Close",
    "report.copied": "Copied",
    "report.selected": "Selected - copy it",
    "report.probing": "Probing...",
    "report.failed": "Diagnostics failed: {message}",
    "diag.both": "Lens is reachable both ways. If translating still fails, the problem is past the transport - send this report with the exact error the message shows.",
    "diag.fetchOnly": "Lens is reachable, but this host's own transport is not. That is handled: the script falls back to fetch, which costs one failed attempt per page and sends an Origin header GM_xmlhttpRequest would not.",
    "diag.gmOnly": "Lens is reachable through the host's transport, which is the path the script prefers anyway.",
    "diag.blocked": 'Nothing reaches Lens, but the control host answers. Something on this device is blocking lensfrontend-pa.googleapis.com specifically - check the DNS filtering and the HTTPS filtering exclusions, and search the activity log for "googleapis".',
    "diag.offline": "Nothing reaches anything, the control host included. The device has no working connection from this page.",
    // --- the settings window
    "panel.title": "Lens Translate",
    "panel.aria": "Lens Translate settings",
    "panel.close": "Close",
    "panel.cancel": "Cancel",
    "panel.save": "Save",
    "panel.search": "Search settings",
    "panel.noMatches": 'No setting matches "{query}"',
    "panel.resetField": "Reset to default",
    "panel.resetTab": "Reset this tab",
    "panel.resetAll": "Reset all settings",
    "panel.unsaved": "You have unsaved changes.",
    "panel.discard": "Discard",
    "panel.keepEditing": "Keep editing",
    "panel.actionsNote": "These run at once, and discard anything unsaved.",
    "general.site": "On {host}",
    "general.site.off": "Off",
    "general.site.default": "When asked",
    "general.site.auto": "Automatic",
    "general.site.hint.off": "Nothing here: no button, no shortcuts. Takes effect at once.",
    "general.site.hint.default": "A button when you point at a picture. Takes effect at once.",
    "general.site.hint.defaultAuto": "Translated as you scroll, by the switch below. Takes effect at once.",
    "general.site.hint.auto": "Every picture here is translated as it comes into view, whatever the switch below says. Takes effect at once.",
    "general.simple.title": "Simple",
    "general.simple.desc": "Translate, search, ask and copy; the settings that matter.",
    "general.pro.title": "Pro",
    "general.pro.desc": "Areas, objects and text picking; every setting, in tabs.",
    "general.essentials": "Translation and buttons",
    "general.quick": "Quick actions",
    "general.cacheSize": "{size} MB",
    "tab.general": "General",
    "tab.translation": "Translation",
    "tab.search": "Search",
    "tab.appearance": "Appearance",
    "tab.buttons": "Buttons",
    "tab.behaviour": "Behaviour",
    "tab.sites": "Sites",
    "tab.advanced": "Advanced",
    "tab.about": "About",
    "buttons.pin": "Show {name} in the row",
    "buttons.up": "Move {name} up",
    "buttons.down": "Move {name} down",
    "buttons.drag": "Drag to reorder",
    "chord.record": "Press the keys...",
    "chord.none": "Not set",
    "chord.clear": "Clear",
    "color.auto": "From the picture",
    "color.pick": "Choose a colour",
    "preview.title": "Preview",
    "preview.note": "A sample picture, drawn with the values in this form. It follows them as they change; nothing is kept until you save.",
    "lang.auto": "Auto (browser language)",
    "lang.detect": "Detect automatically",
    "lang.followTarget": "Follow the target",
    "lang.sameAsTranslation": "Same as the translation language",
    "sites.current": "This site: {host}",
    "sites.default": "Default - translate when asked",
    "sites.off": "Off - no button, no shortcuts",
    "sites.auto": "Auto - translate images as they come into view",
    "sites.others": "Other sites with a rule",
    "sites.none": "No other site has a rule.",
    "sites.remove": "Remove the rule for {host}",
    "sites.note": "Site rules take effect at once; they are not part of Save.",
    "about.version": "Version {version}",
    "about.links": "Links",
    "about.repo": "Source code",
    "about.issues": "Report a problem",
    "about.docs": "What Lens can do",
    "about.host": "Userscript host",
    "about.tools": "Tools",
    "about.backup": "Backup",
    "about.export": "Export settings",
    "about.import": "Import settings",
    "about.importDone": "Settings imported: {count}. Check them and press Save.",
    "about.importIgnored": "Ignored: {keys}",
    "about.importInvalid": "This file does not hold Lens Translate settings.",
    "about.locale": "Interface translations are downloaded from GitHub once per version and language, then kept by the userscript host.",
    // --- settings: General
    "set.uiMode.label": "Interface",
    "set.uiMode.opt.simple": "simple - translate, search, ask, copy",
    "set.uiMode.opt.pro": "pro - areas, objects, text picking, every setting",
    "set.language.label": "Interface language",
    "set.language.hint": "the language of these menus; not what pictures are translated to",
    "set.enabled.label": "Translation enabled",
    "set.popupOpacity.label": "Popup opacity",
    "set.popupOpacity.hint": "the menu, settings and messages; below 100 the picture shows through, blurred",
    "set.uiTheme.label": "Theme",
    "set.uiTheme.hint": "menus, settings and messages; the buttons over a picture stay dark glass",
    "set.uiTheme.opt.auto": "System",
    "set.uiTheme.opt.light": "Light",
    "set.uiTheme.opt.dark": "Dark",
    "set.uiAccent.label": "Accent colour",
    "set.uiAccent.hint": "switches, main buttons and the translate button",
    "set.uiAccent.opt.zinc": "Neutral",
    "set.uiAccent.opt.blue": "Blue",
    "set.uiAccent.opt.violet": "Violet",
    "set.uiAccent.opt.green": "Green",
    "set.uiAccent.opt.orange": "Orange",
    "set.uiAccent.opt.rose": "Rose",
    // --- settings: Translation
    "set.targetLang.label": "Translate to",
    "set.sourceLang.label": "Translate from",
    "set.ocrLang.label": "OCR language hint",
    "set.ocrLang.hint": "helps Lens read a script it guesses wrong; a wrong hint reads worse than none",
    "set.renderMode.label": "Render as",
    "set.renderMode.opt.canvas": "canvas - a picture laid over the image (default)",
    "set.renderMode.opt.overlay": "overlay - crisp text, can drift on dynamic pages",
    "set.mangaMode.label": "Manga mode",
    "set.mangaMode.hint": "always reflow vertical text, widen the layout area, bigger minimum size",
    "set.concurrency.label": "Pictures translated at once",
    "set.concurrency.hint": "more finishes a page sooner; too many gets requests refused and floods a slow connection",
    // --- settings: Search
    "set.aiPrompt.label": "Default AI question",
    "set.aiPrompt.hint": 'what the "Ask AI" field starts with; blank sends the picture alone',
    "set.rememberQuestion.label": "Remember the last AI question",
    "set.rememberQuestion.hint": "the field starts from what you asked last instead of the default",
    "set.searchLang.label": "Results language",
    "set.searchLang.hint": "the language Google answers in",
    "set.searchTheme.label": "Results theme",
    "set.searchTheme.opt.auto": "auto - follow the system",
    "set.searchTheme.opt.light": "light",
    "set.searchTheme.opt.dark": "dark",
    "set.backgroundTabs.label": "Open results in a background tab",
    "set.backgroundTabs.hint": "keeps you on the page; only where the userscript host opens tabs itself",
    // --- settings: Appearance
    "set.fontFamily.label": "Font family",
    "set.fontFamily.hint": "any CSS font list; blank is the system font. A narrow face fits more text at a larger size",
    "set.fontWeight.label": "Font weight",
    "set.fontWeight.hint": "bolder reads better over a busy picture but is wider, so the text comes out smaller",
    "set.fontWeight.opt.300": "light",
    "set.fontWeight.opt.400": "regular (default)",
    "set.fontWeight.opt.500": "medium",
    "set.fontWeight.opt.600": "semibold",
    "set.fontWeight.opt.700": "bold",
    "set.fontWeight.opt.800": "extra bold",
    "set.textColor.label": "Text colour",
    "set.textColor.hint": "overrides the colour Lens sampled; one colour for every picture can vanish on a dark one",
    "set.outlineColor.label": "Outline colour",
    "set.outlineColor.hint": "overrides the sampled background colour used for the outline",
    "set.fillColor.label": "Fill colour",
    "set.fillColor.hint": "the flat colour behind text where no patch is used; a fixed one shows as boxes on tinted paper",
    "set.outlineScale.label": "Text outline",
    "set.outlineScale.hint": "thicker hides leftovers of the original; too thick closes up small letters. 0 removes it",
    "set.verticalText.label": "Vertical CJK text",
    "set.verticalText.opt.auto": "auto - vertical only for CJK targets",
    "set.verticalText.opt.keep": "keep - always vertical, like Chromium",
    "set.verticalText.opt.horizontal": "horizontal - always reflow",
    "set.textAlign.label": "Text alignment",
    "set.textAlign.opt.auto": "auto - follow the source, like Chromium",
    "set.textAlign.opt.left": "left",
    "set.textAlign.opt.center": "center",
    "set.textAlign.opt.right": "right",
    "set.reflowHorizontal.label": "Re-wrap horizontal text",
    "set.reflowHorizontal.hint": "treats a paragraph as one text area: better in bubbles, less faithful to the source lines",
    "set.reflowHorizontal.opt.off": "off - keep the source lines, like Chromium",
    "set.reflowHorizontal.opt.auto": "auto - only bubbles that would not fit",
    "set.reflowHorizontal.opt.on": "on - every paragraph",
    "set.bubbleShape.label": "Fit text to the bubble's shape",
    "set.bubbleShape.hint": "wraps re-set text to the bubble's outline, read from the picture; off, it gets a rectangle",
    "set.fitToBox.label": "Keep text out of the next bubble",
    "set.fitToBox.hint": "shrinks a paragraph that outgrows its room; off, text stays larger but may overlap",
    "set.lineSpacing.label": "Line spacing",
    "set.lineSpacing.hint": "re-wrapped text only; looser is easier to read but makes the font smaller",
    "set.minReadablePx.label": "Minimum text size (px)",
    "set.minReadablePx.hint": "enlarges text too small to read; higher values make lines overlap. 0 disables",
    "set.mangaBoxGrowth.label": "Bubble fill (manga mode)",
    "set.mangaBoxGrowth.hint": "how far past the detected box to lay text out; more room means bigger text",
    "set.mangaMinPx.label": "Minimum text size in manga mode (px)",
    "set.mangaMinPx.hint": "the floor manga mode raises the minimum size to",
    "set.drawBackground.label": "Erase the original text",
    "set.drawBackground.hint": "off, the translation is drawn straight over the source and both show",
    "set.eraseMode.label": "How to erase",
    "set.eraseMode.opt.patch": "patch - the server's inpainting, like Chromium",
    "set.eraseMode.opt.hull": "hull - cover the whole text area with its background colour",
    "set.hullPadding.label": "Cover margin",
    "set.hullPadding.hint": "how far past the text the cover extends; more hides residue but eats into the art",
    "set.patchPadding.label": "Patch padding",
    "set.patchPadding.hint": "scales the margin of the server's patch; 1 is Chromium's. More hides glyph edges, and blurs more",
    "set.supersample.label": "Render sharpness",
    "set.supersample.hint": "sharper when zoomed, at the cost of memory and time per picture",
    "set.supersample.opt.1": "1x - smallest images",
    "set.supersample.opt.2": "2x - sharper when zoomed (default)",
    "set.supersample.opt.3": "3x - sharpest, heaviest",
    "set.coverOpacity.label": "Translation opacity",
    "set.coverOpacity.hint": "below 100 the original shows through the translated picture",
    // --- settings: Buttons
    "set.showButton.label": "Show the buttons over images",
    "set.showButton.hint": "off, only the shortcuts and the userscript menu remain",
    "set.autoTranslate.label": "Translate as you scroll",
    "set.autoTranslate.hint": "pictures are translated once most of one is on screen; a site can be set apart either way",
    "set.autoVisible.label": "Translate as you scroll: how much must be visible",
    "set.autoVisible.hint": "of the picture, or of the screen for one taller than it; lower starts sooner and sends more",
    "set.autoMinPx.label": "Translate as you scroll: smallest picture (px)",
    "set.autoMinPx.hint": "its shorter side as shown; keeps avatars, icons and previews out of it",
    "set.autoTextCheck.label": "Translate as you scroll: skip pictures with no text",
    "set.autoTextCheck.hint": "looks at the pixels first; refuses only the plainly bare - skies, flat graphics - and never asks Google about them",
    "set.autoPerMinute.label": "Translate as you scroll: requests per minute",
    "set.autoPerMinute.hint": "the rest wait their turn; pictures answered before cost nothing and do not count",
    "set.videoButton.label": "Buttons over videos too",
    "set.videoButton.hint": "and over the poster or preview a player lays on top; the shortcuts work on a video either way",
    "set.buttonMode.label": "When to show them",
    "set.buttonMode.hint": "a touch screen has no hover, and tapping the image is how you turn the page",
    "set.buttonMode.opt.auto": "auto - pinned on a touch screen, on hover otherwise",
    "set.buttonMode.opt.hover": "on hover only",
    "set.buttonMode.opt.pinned": "always, over the image in view",
    "set.buttons.label": "Buttons and their order",
    "set.buttons.hint": "ticked buttons sit over the picture; the order here is also the order of the menu",
    "set.mainAction.label": "Main button",
    "set.mainAction.hint": "the button that appears first and shows progress",
    "set.mainAction.opt.translate": "translate",
    "set.mainAction.opt.search": "search the image",
    "set.mainAction.opt.ask": "ask AI",
    "set.mainAction.opt.area": "select an area",
    "set.mainAction.opt.menu": "open the menu",
    "set.longPressAction.label": "Holding the main button",
    "set.longPressAction.hint": "actions that open a tab may be offered as a link instead when started by a hold",
    "set.longPressAction.opt.peek": "show the original while held",
    "set.longPressAction.opt.translate": "translate",
    "set.longPressAction.opt.search": "search the image",
    "set.longPressAction.opt.ask": "ask AI",
    "set.longPressAction.opt.area": "select an area",
    "set.longPressAction.opt.menu": "open the menu",
    "set.longPressAction.opt.none": "nothing",
    "set.repeatLast.label": "Main button repeats the last action",
    "set.repeatLast.hint": "whatever you last chose from the menu becomes what the main button does",
    "set.buttonSize.label": "Button size",
    "set.buttonSize.hint": "never under 44px on a touch screen",
    "set.buttonSize.opt.s": "small",
    "set.buttonSize.opt.m": "medium",
    "set.buttonSize.opt.l": "large",
    "set.buttonCorner.label": "Corner",
    "set.buttonCorner.opt.tr": "top right",
    "set.buttonCorner.opt.tl": "top left",
    "set.buttonCorner.opt.br": "bottom right",
    "set.buttonCorner.opt.bl": "bottom left",
    "set.idleOpacity.label": "Opacity when not pointed at",
    "set.idleOpacity.hint": "lower keeps the buttons out of the picture until the cursor is on them",
    "set.buttonLabels.label": "Show labels next to icons",
    "set.buttonLabels.hint": "clearer, and covers more of the picture",
    "set.hideDelayMs.label": "Hide delay (ms)",
    "set.hideDelayMs.hint": "how long the buttons stay after the cursor leaves the picture",
    "set.extrasDelayMs.label": "Delay before the other buttons (ms)",
    "set.extrasDelayMs.hint": "so a passing cursor summons one button, not the whole row; 0 shows all at once",
    "set.holdMs.label": "Hold time (ms)",
    "set.holdMs.hint": "how long a press lasts before it counts as a hold; too short and clicks become holds",
    // --- settings: Behaviour
    "set.hotkey.label": "Modifier + click translates",
    "set.hotkey.opt.alt": "Alt + click",
    "set.hotkey.opt.ctrl": "Ctrl + click",
    "set.hotkey.opt.shift": "Shift + click",
    "set.hotkey.opt.none": "off",
    "set.peekKey.label": "Hold to see the original",
    "set.peekKey.hint": "while held, every translation steps aside; let go and it is back",
    "set.peekKey.opt.off": "off - holding the button down still works",
    "set.peekKey.opt.backquote": "` (backtick), held",
    "set.peekKey.opt.shift": "Shift, held",
    "set.peekKey.opt.control": "Ctrl, held",
    "set.keyTranslateAll.label": "Shortcut: translate all in view",
    "set.keyTranslate.label": "Shortcut: translate the picture",
    "set.keyTranslate.hint": "picture shortcuts act on the one under the cursor, or the largest in view",
    "set.keySearch.label": "Shortcut: search the picture",
    "set.keyAsk.label": "Shortcut: ask AI",
    "set.keyArea.label": "Shortcut: select an area",
    "set.keyCopy.label": "Shortcut: copy the text",
    "set.keyUndoAll.label": "Shortcut: undo all on the page",
    "set.minImageSize.label": "Ignore images under (px)",
    "set.minImageSize.hint": "lower reaches small pictures, and puts a button on icons and avatars",
    "set.frames.label": "Work inside frames",
    "set.frames.hint": "for readers and galleries that show pages in an iframe; small frames such as ads are always left alone",
    // --- settings: Advanced
    "set.jpegQuality.label": "Upload quality",
    "set.jpegQuality.hint": "higher can read fine print better and uploads more; 40% is what Chromium sends",
    "set.maxArea.label": "Upload size limit (pixels)",
    "set.maxArea.hint": "larger pictures are scaled down to this area before upload; 1500000 is Chromium's",
    "set.maxSide.label": "Upload longest side (px)",
    "set.maxSide.hint": "raising it helps tall pages with small text and makes every upload slower; 1600 is Chromium's",
    "set.tileLongImages.label": "Long pictures",
    "set.tileLongImages.hint": "a webtoon strip or a panorama is sent to Lens in overlapping parts, so its text stays readable; one translation is then several requests",
    "set.tileLongImages.opt.auto": "auto - in parts when one upload would be too small",
    "set.tileLongImages.opt.off": "off - always one upload, like Chromium",
    "set.timeoutMs.label": "Request timeout (ms)",
    "set.timeoutMs.hint": "how long to wait for Lens before giving up",
    "set.cacheBytes.label": "Cache in memory (MB)",
    "set.cacheBytes.hint": "remembers answers and renderings for this page, so repeating costs nothing; 0 disables",
    "set.persistCache.label": "Remember across reloads",
    "set.persistCache.hint": "recognises a picture by its pixels, so reopening a page asks Lens nothing",
    "set.storeBytes.label": "Kept across reloads (MB)",
    "set.storeBytes.hint": "stored per site in the browser's own database; oldest answers are dropped first",
    "set.maxCanvasSide.label": "Largest rendered side (px)",
    "set.maxCanvasSide.hint": "caps the sharpness multiple on big pictures; higher uses much more memory",
    "set.region.label": "Client region",
    "set.region.hint": "sent to Lens as the locale region",
    "set.timeZone.label": "Client time zone",
    "set.apiKey.label": "API key",
    "set.apiKey.hint": "only change if you have your own"
  };
  const LOCALES = ["ru", "uk", "de", "es", "fr", "pt-BR", "ja", "zh-CN", "ko", "tr"];
  function placeholdersOf(text2) {
    const names = /* @__PURE__ */ new Set();
    for (const match of text2.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
      if (match[1]) names.add(match[1]);
    }
    return [...names].sort();
  }
  function format(template, params) {
    if (!params) return template;
    return template.replace(
      /\{([A-Za-z][A-Za-z0-9]*)\}/g,
      (whole, name) => name in params ? String(params[name]) : whole
    );
  }
  function validateLocale(raw, english) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const report = { strings: {}, missing: [], unknown: [], invalid: [] };
    const given = raw;
    for (const [key, value] of Object.entries(given)) {
      const source = Object.hasOwn(english, key) ? english[key] : void 0;
      if (source === void 0) {
        report.unknown.push(key);
        continue;
      }
      if (typeof value !== "string" || !value.trim() || placeholdersOf(value).join() !== placeholdersOf(source).join()) {
        report.invalid.push(key);
        continue;
      }
      report.strings[key] = value;
    }
    for (const key of Object.keys(english)) {
      if (!Object.hasOwn(given, key)) report.missing.push(key);
    }
    return report;
  }
  function pickLocale(preferred, available = LOCALES) {
    const base = (tag) => tag.toLowerCase().split("-")[0] ?? "";
    for (const tag of preferred) {
      if (!tag) continue;
      if (base(tag) === "en") return "en";
      const exact = available.find((code2) => code2.toLowerCase() === tag.toLowerCase());
      if (exact) return exact;
      const sameLanguage = available.find((code2) => base(code2) === base(tag));
      if (sameLanguage) return sameLanguage;
    }
    return "en";
  }
  const RAW = "https://raw.githubusercontent.com/bropines/chrome-lens-userscript";
  function localeUrls(version, code2) {
    const file = `locales/${encodeURIComponent(code2)}.json`;
    return [`${RAW}/v${encodeURIComponent(version)}/${file}`, `${RAW}/main/${file}`];
  }
  async function fetchLocale(urls, get, english, outcome = { answered: false }) {
    for (const url of urls) {
      try {
        const response = await get(url);
        outcome.answered = true;
        if (response.status !== 200) continue;
        const parsed = JSON.parse(new TextDecoder().decode(response.bytes));
        const report = validateLocale(parsed, english);
        if (report) return report.strings;
      } catch (error) {
        if (/\bHTTP \d{3}\b/.test(error?.message ?? "")) outcome.answered = true;
      }
    }
    return null;
  }
  function storedLocale(raw, version, code2, english) {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== "object") return null;
      const entry = parsed;
      if (entry.version !== version || entry.code !== code2) return null;
      return validateLocale(entry.strings, english)?.strings ?? null;
    } catch {
      return null;
    }
  }
  function ownName(code2) {
    try {
      const name = new Intl.DisplayNames([code2], { type: "language" }).of(code2);
      if (name && name !== code2) return name.charAt(0).toLocaleUpperCase(code2) + name.slice(1);
    } catch {
    }
    return code2;
  }
  const MISS_TTL_MS = 6 * 60 * 60 * 1e3;
  const UNREACHABLE_TTL_MS = 15 * 60 * 1e3;
  function recentMiss(raw, version, code2, now, ttl = MISS_TTL_MS) {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== "object") return false;
      const miss = parsed;
      if (miss.version !== version || miss.code !== code2 || typeof miss.at !== "number") return false;
      const window2 = typeof miss.ttl === "number" && miss.ttl > 0 && miss.ttl <= ttl ? miss.ttl : ttl;
      const age = now - miss.at;
      return age >= 0 && age < window2;
    } catch {
      return false;
    }
  }
  const LOCALE_KEY = "lens-translate:locale";
  const MISS_KEY = "lens-translate:locale-miss";
  const LOCALE_KEYS = [LOCALE_KEY, MISS_KEY];
  const FETCH_TIMEOUT_MS = 15e3;
  let code = "en";
  let strings = {};
  let generation = 0;
  let requested = "en";
  const listeners = /* @__PURE__ */ new Set();
  function t(key, params) {
    return format(strings[key] ?? EN[key], params);
  }
  function tMaybe(key) {
    if (!Object.hasOwn(EN, key)) return void 0;
    return t(key);
  }
  const currentLocale = () => code;
  function onLocaleChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  function adopt(next, dictionary) {
    code = next;
    strings = dictionary;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
      }
    }
  }
  function resolveLanguage(setting) {
    if (setting && setting !== "auto") {
      return LOCALES.includes(setting) ? setting : "en";
    }
    const preferred = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
    return pickLocale(preferred);
  }
  const cached = (wanted) => storedLocale(readStored(LOCALE_KEY), VERSION, wanted, EN);
  async function download(wanted) {
    const outcome = { answered: false };
    const strings2 = await fetchLocale(
      localeUrls(VERSION, wanted),
      (url) => gmTransport.get(url, FETCH_TIMEOUT_MS, { anonymous: true, noFetchFallback: true }),
      EN,
      outcome
    );
    return { strings: strings2, answered: outcome.answered };
  }
  function useLanguage(setting) {
    const wanted = resolveLanguage(setting);
    if (wanted === requested) return;
    requested = wanted;
    generation += 1;
    const mine = generation;
    if (wanted === code) return;
    if (wanted === "en") {
      adopt("en", {});
      return;
    }
    const held = cached(wanted);
    if (held) {
      adopt(wanted, held);
      return;
    }
    if (recentMiss(readStored(MISS_KEY), VERSION, wanted, Date.now())) {
      requested = code;
      return;
    }
    void download(wanted).then(({ strings: fetched, answered: answered2 }) => {
      if (!fetched) {
        const miss = {
          version: VERSION,
          code: wanted,
          at: Date.now(),
          ttl: answered2 ? MISS_TTL_MS : UNREACHABLE_TTL_MS
        };
        writeStored(MISS_KEY, miss);
      } else {
        const entry = { version: VERSION, code: wanted, strings: fetched };
        writeStored(LOCALE_KEY, entry);
      }
      if (mine !== generation) return;
      if (fetched) adopt(wanted, fetched);
      else requested = code;
    });
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
  let namedIn = "";
  function labeller() {
    const locale = currentLocale();
    if (displayNames && namedIn === locale) return displayNames;
    namedIn = locale;
    try {
      const wanted = locale === "en" ? [navigator.language, "en"] : [locale, navigator.language, "en"];
      displayNames = new Intl.DisplayNames(wanted, { type: "language" });
    } catch {
      displayNames = null;
    }
    return displayNames;
  }
  function languageLabel(code2) {
    const name = labeller()?.of(code2);
    return name && name !== code2 ? `${name} (${code2})` : code2;
  }
  function languageOptions(blankLabel) {
    const options = LANGUAGES.map((code2) => [code2, languageLabel(code2)]).sort(
      (a, b) => a[1].localeCompare(b[1])
    );
    return blankLabel ? [["", blankLabel], ...options] : [...options];
  }
  const BUTTON_IDS = [
    "translate",
    "search",
    "ask",
    "area",
    "objects",
    "text",
    "copy",
    "edit",
    "settings",
    "menu"
  ];
  const DEFAULT_BUTTONS = "translate*,search,ask,area,objects,text,copy,edit,settings*,menu*";
  const isButtonId = (value) => BUTTON_IDS.includes(value);
  function parseButtons(raw) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const part of typeof raw === "string" ? raw.split(",") : []) {
      const token = part.trim();
      const pinned = token.endsWith("*");
      const id = pinned ? token.slice(0, -1) : token;
      if (!isButtonId(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, pinned });
    }
    for (const id of BUTTON_IDS) {
      if (!seen.has(id)) out.push({ id, pinned: false });
    }
    return out;
  }
  function serializeButtons(list) {
    return list.map((entry) => entry.pinned ? `${entry.id}*` : entry.id).join(",");
  }
  function moveButton(list, id, delta) {
    const from = list.findIndex((entry) => entry.id === id);
    if (from < 0) return [...list];
    return placeButton(list, id, from + delta);
  }
  function placeButton(list, id, index) {
    const moving = list.find((entry) => entry.id === id);
    if (!moving) return [...list];
    const rest = list.filter((entry) => entry.id !== id);
    const at = Math.max(0, Math.min(rest.length, index));
    return [...rest.slice(0, at), moving, ...rest.slice(at)];
  }
  function togglePinned(list, id) {
    return list.map((entry) => entry.id === id ? { ...entry, pinned: !entry.pinned } : entry);
  }
  function rowOf(list, main) {
    return [main, ...list.filter((entry) => entry.pinned && entry.id !== main).map((entry) => entry.id)];
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
  const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;
  const MODIFIER_NAMES = ["Ctrl", "Alt", "Shift", "Meta"];
  function parseChord(raw) {
    if (typeof raw !== "string") return null;
    const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
    const code2 = parts.pop();
    if (!code2 || !/^[A-Z][A-Za-z0-9]*$/.test(code2) || MODIFIER_CODES.test(code2)) return null;
    if (MODIFIER_NAMES.includes(code2)) return null;
    const chord = { ctrl: false, alt: false, shift: false, meta: false, code: code2 };
    for (const part of parts) {
      const name = part.toLowerCase();
      if (name === "ctrl" || name === "control") chord.ctrl = true;
      else if (name === "alt" || name === "option") chord.alt = true;
      else if (name === "shift") chord.shift = true;
      else if (name === "meta" || name === "cmd" || name === "win") chord.meta = true;
      else return null;
    }
    return isBare(chord) ? null : chord;
  }
  function isBare(chord) {
    return !chord.ctrl && !chord.alt && !chord.meta && !/^F\d{1,2}$/.test(chord.code);
  }
  function serializeChord(chord) {
    const parts = [];
    if (chord.ctrl) parts.push("Ctrl");
    if (chord.alt) parts.push("Alt");
    if (chord.shift) parts.push("Shift");
    if (chord.meta) parts.push("Meta");
    parts.push(chord.code);
    return parts.join("+");
  }
  function normalizeChord(raw) {
    const chord = parseChord(raw);
    return chord ? serializeChord(chord) : "";
  }
  function chordFromEvent(event) {
    if (!event.code || MODIFIER_CODES.test(event.code)) return null;
    const chord = {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      code: event.code
    };
    return isBare(chord) ? null : chord;
  }
  function matchesChord(chord, event) {
    return chord !== null && event.code === chord.code && event.ctrlKey === chord.ctrl && event.altKey === chord.alt && event.shiftKey === chord.shift && event.metaKey === chord.meta;
  }
  function formatChord(raw) {
    const chord = parseChord(raw);
    if (!chord) return "";
    const key = chord.code.replace(/^Key(?=[A-Z]$)/, "").replace(/^Digit(?=\d$)/, "");
    return [...serializeChord(chord).split("+").slice(0, -1), key].join(" + ");
  }
  const STORAGE_KEY = "lens-translate:settings";
  const SETTINGS_KEYS = [STORAGE_KEY];
  const MB = 1024 * 1024;
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
    tileLongImages: "auto",
    jpegQuality: 0.4,
    showButton: true,
    videoButton: false,
    autoTranslate: false,
    autoVisible: 0.5,
    autoMinPx: 200,
    autoTextCheck: true,
    autoPerMinute: 20,
    buttonMode: "auto",
    hotkey: "alt",
    keyTranslateAll: "Alt+Shift+KeyT",
    keyTranslate: "",
    keySearch: "",
    keyAsk: "",
    keyArea: "",
    keyCopy: "",
    keyUndoAll: "",
    peekKey: "off",
    fontFamily: "",
    fontWeight: 400,
    textColor: "",
    outlineColor: "",
    fillColor: "",
    drawBackground: true,
    patchPadding: 1,
    verticalText: "auto",
    renderMode: "canvas",
    enabled: true,
    minReadablePx: 12,
    supersample: 2,
    maxCanvasSide: 8e3,
    mangaMinPx: 14,
    cacheBytes: 32 * MB,
    storeBytes: 32 * MB,
    persistCache: true,
    mangaMode: false,
    mangaBoxGrowth: 1.45,
    outlineScale: 1,
    eraseMode: "patch",
    hullPadding: 0.45,
    reflowHorizontal: "auto",
    bubbleShape: true,
    fitToBox: true,
    lineSpacing: 1.25,
    textAlign: "auto",
    uiMode: "simple",
    aiPrompt: "What is in this picture?",
    frames: true,
    popupOpacity: MAX_OPACITY,
    uiTheme: "auto",
    uiAccent: "zinc",
    language: "auto",
    coverOpacity: 100,
    buttons: DEFAULT_BUTTONS,
    mainAction: "translate",
    longPressAction: "peek",
    repeatLast: false,
    buttonSize: "m",
    buttonCorner: "tr",
    idleOpacity: 100,
    hideDelayMs: 300,
    extrasDelayMs: 550,
    buttonLabels: false,
    holdMs: 350,
    concurrency: 2,
    rememberQuestion: false,
    searchLang: "",
    searchTheme: "auto",
    backgroundTabs: false
  };
  const TABS = [
    "general",
    "translation",
    "search",
    "appearance",
    "buttons",
    "behaviour",
    "sites",
    "advanced",
    "about"
  ];
  const interfaceLanguages = () => [
    ["auto", t("lang.auto")],
    ["en", ownName("en")],
    ...LOCALES.map((code2) => [code2, ownName(code2)])
  ];
  const FIELDS = [
    // General
    { key: "uiMode", tab: "general", essential: true, type: "select", options: ["simple", "pro"] },
    { key: "language", tab: "general", essential: true, type: "select", choices: interfaceLanguages },
    { key: "enabled", tab: "general", essential: true, type: "checkbox" },
    { key: "autoTranslate", tab: "general", essential: true, type: "checkbox" },
    {
      key: "popupOpacity",
      tab: "general",
      essential: true,
      type: "range",
      min: MIN_OPACITY,
      max: MAX_OPACITY,
      step: OPACITY_STEP,
      unit: "pct"
    },
    { key: "uiTheme", tab: "general", essential: true, type: "select", options: ["auto", "light", "dark"] },
    {
      key: "uiAccent",
      tab: "general",
      essential: true,
      type: "select",
      options: ["zinc", "blue", "violet", "green", "orange", "rose"]
    },
    // Translation
    { key: "targetLang", tab: "translation", essential: true, type: "select", choices: () => languageOptions() },
    {
      key: "sourceLang",
      tab: "translation",
      essential: true,
      type: "select",
      choices: () => languageOptions(t("lang.detect"))
    },
    { key: "ocrLang", tab: "translation", type: "select", choices: () => languageOptions(t("lang.followTarget")) },
    { key: "mangaMode", tab: "translation", essential: true, type: "checkbox" },
    { key: "renderMode", tab: "translation", type: "select", options: ["canvas", "overlay"] },
    { key: "concurrency", tab: "translation", type: "number", min: 1, max: 6, step: 1 },
    // Search
    { key: "aiPrompt", tab: "search", type: "text", wide: true },
    { key: "rememberQuestion", tab: "search", type: "checkbox" },
    { key: "backgroundTabs", tab: "search", type: "checkbox" },
    {
      key: "searchLang",
      tab: "search",
      type: "select",
      choices: () => languageOptions(t("lang.sameAsTranslation"))
    },
    { key: "searchTheme", tab: "search", type: "select", options: ["auto", "light", "dark"] },
    // Appearance
    { key: "fontFamily", tab: "appearance", type: "text", wide: true },
    { key: "fontWeight", tab: "appearance", type: "select", options: ["300", "400", "500", "600", "700", "800"] },
    { key: "textAlign", tab: "appearance", type: "select", options: ["auto", "left", "center", "right"] },
    { key: "textColor", tab: "appearance", type: "color" },
    { key: "outlineColor", tab: "appearance", type: "color" },
    { key: "outlineScale", tab: "appearance", type: "range", min: 0, max: 8, step: 0.1, unit: "x", wide: true },
    { key: "minReadablePx", tab: "appearance", type: "number", min: 0, max: 64, step: 1 },
    { key: "verticalText", tab: "appearance", type: "select", options: ["auto", "keep", "horizontal"] },
    { key: "reflowHorizontal", tab: "appearance", type: "select", options: ["off", "auto", "on"] },
    { key: "bubbleShape", tab: "appearance", type: "checkbox" },
    { key: "fitToBox", tab: "appearance", type: "checkbox" },
    { key: "lineSpacing", tab: "appearance", type: "range", min: 0.8, max: 2, step: 0.05, unit: "x" },
    { key: "mangaBoxGrowth", tab: "appearance", type: "number", min: 1, max: 3, step: 0.05 },
    { key: "mangaMinPx", tab: "appearance", type: "number", min: 0, max: 64, step: 1 },
    { key: "drawBackground", tab: "appearance", type: "checkbox" },
    { key: "eraseMode", tab: "appearance", type: "select", options: ["patch", "hull"] },
    { key: "fillColor", tab: "appearance", type: "color" },
    { key: "hullPadding", tab: "appearance", type: "range", min: 0, max: 2, step: 0.05, unit: "%" },
    { key: "patchPadding", tab: "appearance", type: "range", min: 0, max: 3, step: 0.05, unit: "x" },
    { key: "supersample", tab: "appearance", type: "select", options: ["1", "2", "3"] },
    { key: "coverOpacity", tab: "appearance", type: "range", min: 20, max: 100, step: 5, unit: "pct" },
    // Buttons
    { key: "showButton", tab: "buttons", type: "checkbox" },
    { key: "videoButton", tab: "buttons", type: "checkbox" },
    { key: "buttonMode", tab: "buttons", essential: true, type: "select", options: ["auto", "hover", "pinned"] },
    { key: "buttons", tab: "buttons", type: "buttons", wide: true },
    { key: "mainAction", tab: "buttons", type: "select", options: ["translate", "search", "ask", "area", "menu"] },
    {
      key: "longPressAction",
      tab: "buttons",
      type: "select",
      options: ["peek", "translate", "search", "ask", "area", "menu", "none"]
    },
    { key: "repeatLast", tab: "buttons", type: "checkbox" },
    { key: "buttonLabels", tab: "buttons", type: "checkbox" },
    { key: "buttonSize", tab: "buttons", type: "select", options: ["s", "m", "l"] },
    { key: "buttonCorner", tab: "buttons", type: "select", options: ["tr", "tl", "br", "bl"] },
    { key: "idleOpacity", tab: "buttons", type: "range", min: 20, max: 100, step: 5, unit: "pct" },
    { key: "hideDelayMs", tab: "buttons", type: "number", min: 0, max: 5e3, step: 50 },
    { key: "extrasDelayMs", tab: "buttons", type: "number", min: 0, max: 5e3, step: 50 },
    { key: "holdMs", tab: "buttons", type: "number", min: 150, max: 2e3, step: 50 },
    // Behaviour
    { key: "hotkey", tab: "behaviour", type: "select", options: ["alt", "ctrl", "shift", "none"] },
    { key: "peekKey", tab: "behaviour", type: "select", options: ["off", "backquote", "shift", "control"] },
    { key: "keyTranslateAll", tab: "behaviour", type: "chord" },
    { key: "keyTranslate", tab: "behaviour", type: "chord" },
    { key: "keySearch", tab: "behaviour", type: "chord" },
    { key: "keyAsk", tab: "behaviour", type: "chord" },
    { key: "keyArea", tab: "behaviour", type: "chord" },
    { key: "keyCopy", tab: "behaviour", type: "chord" },
    { key: "keyUndoAll", tab: "behaviour", type: "chord" },
    { key: "minImageSize", tab: "behaviour", type: "number", min: 10, max: 2e3, step: 10 },
    { key: "autoVisible", tab: "behaviour", type: "range", min: 0.2, max: 1, step: 0.05, unit: "%" },
    { key: "autoMinPx", tab: "behaviour", type: "number", min: 50, max: 2e3, step: 10 },
    { key: "autoTextCheck", tab: "behaviour", type: "checkbox" },
    { key: "autoPerMinute", tab: "behaviour", type: "number", min: 1, max: 120, step: 1 },
    { key: "frames", tab: "behaviour", type: "checkbox" },
    // Advanced
    { key: "jpegQuality", tab: "advanced", type: "range", min: 0.1, max: 1, step: 0.05, unit: "%" },
    { key: "maxArea", tab: "advanced", type: "number", min: 1e5, max: 16e6, step: 1e5 },
    { key: "maxSide", tab: "advanced", type: "number", min: 400, max: 8e3, step: 100 },
    { key: "tileLongImages", tab: "advanced", type: "select", options: ["auto", "off"] },
    { key: "timeoutMs", tab: "advanced", type: "number", min: 5e3, max: 3e5, step: 1e3 },
    { key: "cacheBytes", tab: "advanced", type: "number", min: 0, max: 1024, step: 4, scale: MB },
    { key: "persistCache", tab: "advanced", type: "checkbox" },
    { key: "storeBytes", tab: "advanced", type: "number", min: 0, max: 1024, step: 4, scale: MB },
    { key: "maxCanvasSide", tab: "advanced", type: "number", min: 2e3, max: 16e3, step: 500 },
    { key: "region", tab: "advanced", type: "text" },
    { key: "timeZone", tab: "advanced", type: "text" },
    { key: "apiKey", tab: "advanced", type: "text", wide: true }
  ];
  const fieldLabel = (field) => t(`set.${field.key}.label`);
  const fieldHint = (field) => tMaybe(`set.${field.key}.hint`);
  function fieldChoices(field) {
    if (field.choices) return field.choices();
    return (field.options ?? []).map(
      (value) => [value, tMaybe(`set.${field.key}.opt.${value}`) ?? value]
    );
  }
  function fieldMatches(field, query) {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [fieldLabel(field), fieldHint(field) ?? "", field.key].some(
      (text2) => text2.toLowerCase().includes(needle)
    );
  }
  let cache$1 = null;
  function merge(stored2) {
    const merged = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (Object.hasOwn(stored2, key) && stored2[key] !== void 0) merged[key] = stored2[key];
    }
    if (stored2["batchHotkey"] === false && !Object.hasOwn(stored2, "keyTranslateAll")) {
      merged["keyTranslateAll"] = "";
    }
    merged["fontFamily"] = typeof merged["fontFamily"] === "string" ? cleanFontFamily(merged["fontFamily"]) : DEFAULTS.fontFamily;
    if (typeof merged["reflowHorizontal"] === "boolean") {
      merged["reflowHorizontal"] = merged["reflowHorizontal"] ? "on" : "auto";
    }
    return merged;
  }
  function getSettings() {
    if (!cache$1) {
      let stored2 = {};
      try {
        const raw = readStored(STORAGE_KEY);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === "object") stored2 = parsed;
      } catch {
        stored2 = {};
      }
      cache$1 = merge(stored2);
    }
    return cache$1;
  }
  function reloadSettings() {
    cache$1 = null;
    return getSettings();
  }
  function saveSettings(patch) {
    cache$1 = { ...getSettings(), ...patch };
    writeStored(STORAGE_KEY, cache$1);
    return cache$1;
  }
  const COLOUR = /^#[0-9a-f]{6}$/i;
  function clampTo(field, value) {
    const scale = field.scale ?? 1;
    let out = value;
    if (field.min !== void 0) out = Math.max(field.min * scale, out);
    if (field.max !== void 0) out = Math.min(field.max * scale, out);
    return out;
  }
  function sanitize(field, raw) {
    const fallback = DEFAULTS[field.key];
    switch (field.type) {
      case "checkbox":
        return typeof raw === "boolean" ? raw : void 0;
      case "number":
      case "range": {
        if (typeof raw !== "number" || !Number.isFinite(raw)) return void 0;
        if (field.key === "popupOpacity") return clampOpacity(raw);
        return clampTo(field, raw);
      }
      case "select": {
        if (field.key === "reflowHorizontal" && typeof raw === "boolean") return raw ? "on" : "auto";
        const text2 = String(raw);
        if (typeof raw !== "string" && typeof raw !== "number") return void 0;
        if (!fieldChoices(field).some(([value]) => value === text2)) return void 0;
        return typeof fallback === "number" ? Number(text2) : text2;
      }
      case "color":
        if (typeof raw !== "string") return void 0;
        return raw === "" || COLOUR.test(raw) ? raw.toLowerCase() : void 0;
      case "chord":
        return typeof raw === "string" ? normalizeChord(raw) : void 0;
      case "buttons":
        return typeof raw === "string" ? serializeButtons(parseButtons(raw)) : void 0;
      case "text":
        if (typeof raw !== "string") return void 0;
        return field.key === "fontFamily" ? cleanFontFamily(raw) : raw.trim();
    }
  }
  const FONT_FAMILY_MAX = 200;
  function cleanFontFamily(raw) {
    return raw.replace(/[;{}<>\\\r\n\t\f\v]/g, "").trim().slice(0, FONT_FAMILY_MAX).trim();
  }
  function formPatch(entries2) {
    const patch = {};
    for (const [field, now, initial] of entries2) {
      if (now === initial) continue;
      patch[field.key] = coerce(field, now);
    }
    return patch;
  }
  function settingsDiffer(a, b) {
    return FIELDS.some((field) => a[field.key] !== b[field.key]);
  }
  function coerce(field, raw) {
    let candidate2 = raw;
    if (field.type === "checkbox") candidate2 = Boolean(raw);
    else if (field.type === "number" || field.type === "range") {
      candidate2 = String(raw).trim() === "" ? Number.NaN : Number(raw) * (field.scale ?? 1);
      if (field.scale && Number.isFinite(candidate2)) candidate2 = Math.round(candidate2);
    }
    return sanitize(field, candidate2) ?? DEFAULTS[field.key];
  }
  function shown(field, value) {
    if (field.scale && typeof value === "number") return String(Math.round(value / field.scale * 10) / 10);
    return String(value);
  }
  const EXPORT_MARK = "lens-translate";
  function exportSettings(settings, version) {
    const ordered = {};
    for (const key of Object.keys(DEFAULTS).sort()) ordered[key] = settings[key];
    return `${JSON.stringify({ [EXPORT_MARK]: version, settings: ordered }, null, 2)}
`;
  }
  function importSettings(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const outer = raw;
    const inner = Object.hasOwn(outer, EXPORT_MARK) ? outer["settings"] : outer;
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) return null;
    const report = { patch: {}, applied: [], unknown: [], invalid: [] };
    const patch = {};
    for (const [key, value] of Object.entries(inner)) {
      const field = FIELDS.find((candidate2) => candidate2.key === key);
      if (!field) {
        report.unknown.push(key);
        continue;
      }
      const clean = sanitize(field, value);
      if (clean === void 0) {
        report.invalid.push(key);
        continue;
      }
      patch[key] = clean;
      report.applied.push(key);
    }
    report.patch = patch;
    return report.applied.length || report.unknown.length || report.invalid.length ? report : null;
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
        let length2 = 0;
        for (const part of parts) length2 += part.length;
        const out = new Uint8Array(length2);
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
          const length2 = Number(readVarint());
          need(length2, "length-delimited field");
          value = buf.subarray(p, p + length2);
          p += length2;
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
          (t2) => t2.str(F.AppliedFilter_Translate.targetLanguage, settings.targetLang).str(F.AppliedFilter_Translate.sourceLanguage, settings.sourceLang)
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
      lines: subs(paragraph, F.TextLayout_Paragraph.lines).map((line2) => {
        const words = subs(line2, F.TextLayout_Line.words).map(parseWord);
        return {
          text: words.map((w) => w.text + w.separator).join("").trim(),
          words,
          geometry: parseGeometry(sub(line2, F.TextLayout_Line.geometry))
        };
      })
    }));
  }
  function parseBackground(line2) {
    const data = sub(line2, F.TranslationData_Line.backgroundImageData);
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
      const lines = translatedLines.map((line2, i) => {
        const style = sub(line2, F.TranslationData_Line.style);
        const source = sourceLines[i];
        return {
          words: subs(line2, F.TranslationData_Line.word).map(
            (word) => [num(word, F.TranslationData_Line_Word.start), num(word, F.TranslationData_Line_Word.end)]
          ),
          textColor: num(style, F.TranslationData_TextStyle.textColor),
          bgColor: num(style, F.TranslationData_TextStyle.backgroundPrimaryColor),
          geometry: source ? parseGeometry(sub(source, F.TextLayout_Line.geometry)) : null,
          background: parseBackground(line2)
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
      return t("diag.both");
    }
    if (fetchLens) {
      return t("diag.fetchOnly");
    }
    if (gmLens) {
      return t("diag.gmOnly");
    }
    if (anyControl) {
      return t("diag.blocked");
    }
    return t("diag.offline");
  }
  function pageFacts(context) {
    const minSize = getSettings().minImageSize;
    const found = collect$1(minSize);
    const counts = /* @__PURE__ */ new Map();
    let biggest = "";
    let biggestArea = 0;
    for (const target of found) {
      counts.set(target.kind, (counts.get(target.kind) ?? 0) + 1);
      const rect2 = target.element.getBoundingClientRect();
      const area = rect2.width * rect2.height;
      if (area > biggestArea) {
        biggestArea = area;
        biggest = `${target.kind} ${Math.round(rect2.width)}x${Math.round(rect2.height)}`;
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
  const FACE_SIZE = 64;
  function faceOf(rgba, side, width, height, size = FACE_SIZE) {
    if (side % size !== 0 || rgba.length < side * side * 4 || !(width > 0) || !(height > 0)) return null;
    const block = side / size;
    const sums = new Float64Array(size * size);
    for (let y = 0; y < side; y += 1) {
      const row2 = Math.floor(y / block) * size;
      for (let x = 0; x < side; x += 1) {
        const i = (y * side + x) * 4;
        sums[row2 + Math.floor(x / block)] += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      }
    }
    const gray = new Uint8Array(size * size);
    const area = block * block;
    for (let i = 0; i < gray.length; i += 1) gray[i] = Math.round(sums[i] / area);
    return { gray, coarse: coarseHash(gray, size), aspect: width / height };
  }
  function coarseHash(gray, size) {
    const cell = size / 8;
    const means = [];
    for (let by = 0; by < 8; by += 1) {
      for (let bx = 0; bx < 8; bx += 1) {
        let sum = 0;
        for (let y = 0; y < cell; y += 1) {
          for (let x = 0; x < cell; x += 1) sum += gray[(by * cell + y) * size + bx * cell + x];
        }
        means.push(sum);
      }
    }
    const mean = means.reduce((a, b) => a + b, 0) / means.length;
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < 64; i += 1) {
      if (means[i] <= mean) continue;
      if (i < 32) lo |= 1 << i;
      else hi |= 1 << i - 32;
    }
    return [lo >>> 0, hi >>> 0];
  }
  const bits = (n) => {
    let v = n >>> 0;
    let count = 0;
    while (v) {
      v &= v - 1;
      count += 1;
    }
    return count;
  };
  const coarseDistance = (a, b) => bits(a[0] ^ b[0]) + bits(a[1] ^ b[1]);
  const ASPECT_TOLERANCE = 0.02;
  const COARSE_MAX = 10;
  const CELL_DIFFERENCE = 24;
  const CELLS_MAX = 0.01;
  const MEAN_MAX = 5;
  function similarAspect(a, b) {
    return Math.abs(a - b) <= ASPECT_TOLERANCE * Math.max(a, b);
  }
  function candidate(a, b) {
    return similarAspect(a.aspect, b.aspect) && coarseDistance(a.coarse, b.coarse) <= COARSE_MAX;
  }
  function difference(a, b) {
    if (a.length !== b.length || !a.length) return { cells: 1, mean: 255 };
    let off = 0;
    let total2 = 0;
    for (let i = 0; i < a.length; i += 1) {
      const d = Math.abs(a[i] - b[i]);
      total2 += d;
      if (d > CELL_DIFFERENCE) off += 1;
    }
    return { cells: off / a.length, mean: total2 / a.length };
  }
  function sameFrame(a, b) {
    if (!candidate(a, b)) return false;
    const { cells, mean } = difference(a.gray, b.gray);
    return cells <= CELLS_MAX && mean <= MEAN_MAX;
  }
  const REUSE_DOWN_TO = 0.5;
  const reusable = (storedSize, wantedSize) => storedSize >= REUSE_DOWN_TO * wantedSize;
  const MARK_SHORT = 12;
  const MARK_LONG_MAX = MARK_SHORT * 16;
  const MARK_MIN_PX = 10;
  const MARK_AGREE = 0.94;
  const MARK_LINES = 24;
  function markShape(pixelW, pixelH) {
    const along = (long, short) => Math.max(MARK_SHORT, Math.min(MARK_LONG_MAX, Math.round(MARK_SHORT * long / Math.max(short, 1e-9))));
    return pixelW >= pixelH ? { w: along(pixelW, pixelH), h: MARK_SHORT } : { w: MARK_SHORT, h: along(pixelH, pixelW) };
  }
  function markBoxes(paragraphs) {
    const boxes = [];
    for (const paragraph of paragraphs) {
      for (const line2 of paragraph.lines) {
        const g = line2.geometry;
        if (!g || !(g.w > 0) || !(g.h > 0)) continue;
        const x = Math.max(0, g.cx - g.w / 2);
        const y = Math.max(0, g.cy - g.h / 2);
        const w = Math.min(1, g.cx + g.w / 2) - x;
        const h = Math.min(1, g.cy + g.h / 2) - y;
        if (w > 0 && h > 0) boxes.push({ x, y, w, h });
      }
    }
    return boxes.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MARK_LINES);
  }
  function correlation(a, b) {
    if (a.length !== b.length || !a.length) return -1;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < a.length; i += 1) {
      ma += a[i];
      mb += b[i];
    }
    ma /= a.length;
    mb /= b.length;
    let num2 = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < a.length; i += 1) {
      const x = a[i] - ma;
      const y = b[i] - mb;
      num2 += x * y;
      da += x * x;
      db += y * y;
    }
    const flat = 16 * a.length;
    if (da < flat && db < flat) return Number.NaN;
    if (da < flat || db < flat) return 0;
    return num2 / Math.sqrt(da * db);
  }
  function linesAgree(stored2, current, smaller) {
    let compared = 0;
    for (const [i, mark] of stored2.entries()) {
      const strip = current[i];
      if (!strip) return false;
      const short = Math.min(mark.box.w * smaller.width, mark.box.h * smaller.height);
      if (short < MARK_MIN_PX) continue;
      const r = correlation(mark.gray, strip);
      if (Number.isNaN(r)) continue;
      if (r < MARK_AGREE) return false;
      compared += 1;
    }
    return compared > 0;
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
  function identify(source, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = FINGERPRINT_SIZE;
    canvas.height = FINGERPRINT_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { hash: "", face: null };
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
      return {
        hash: `${lane(a)}.${lane(b)}.${width}x${height}`,
        face: faceOf(data, FINGERPRINT_SIZE, width, height)
      };
    } catch {
      return { hash: "", face: null };
    }
  }
  function markStrips(source, width, height, boxes) {
    const strips = [];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return strips;
    try {
      for (const box of boxes) {
        const pw = box.w * width;
        const ph = box.h * height;
        const shape = markShape(pw, ph);
        canvas.width = shape.w;
        canvas.height = shape.h;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(source, box.x * width, box.y * height, pw, ph, 0, 0, shape.w, shape.h);
        const { data } = ctx.getImageData(0, 0, shape.w, shape.h);
        const gray = new Uint8Array(shape.w * shape.h);
        for (let i = 0; i < gray.length; i += 1) {
          gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
        }
        strips.push(gray);
      }
    } catch {
      return [];
    }
    return strips;
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
    return encodeRect(image.source, { x: sx, y: sy, width: sw, height: sh }, settings);
  }
  async function encodeRect(source, rect2, settings) {
    const { width, height } = targetSize(rect2.width, rect2.height, settings);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2d canvas context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, rect2.x, rect2.y, rect2.width, rect2.height, 0, 0, width, height);
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
    const readable = (candidate2) => {
      try {
        const ctx = probe2.getContext("2d");
        if (!ctx) return false;
        ctx.drawImage(candidate2, 0, 0, 1, 1);
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
  const TILE_BELOW = 0.7;
  const TILE_ASPECT = 1.5;
  const TILE_MAX_ASPECT = 4;
  const TILE_OVERLAP = 0.25;
  const MAX_TILES = 12;
  function planTiles(width, height, budget) {
    if (budget.tileLongImages === "off") return null;
    if (!(width > 0 && height > 0)) return null;
    const { maxArea, maxSide } = budget;
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    if (width * height <= maxArea || long <= maxSide) return null;
    const single = maxSide / long;
    const byArea = Math.min(1, Math.sqrt(maxArea / (width * height)));
    if (single >= TILE_BELOW * byArea) return null;
    const unscaled = Math.min(maxSide, Math.floor(maxArea / short));
    let length2 = Math.round(
      Math.min(short * TILE_MAX_ASPECT, Math.max(short * TILE_ASPECT, unscaled))
    );
    if (length2 >= long) return null;
    let count = Math.ceil((long - length2 * TILE_OVERLAP) / (length2 * (1 - TILE_OVERLAP)));
    if (count > MAX_TILES) {
      count = MAX_TILES;
      length2 = Math.ceil(long / (count - (count - 1) * TILE_OVERLAP));
    }
    if (count < 2) return null;
    const starts = Array.from(
      { length: count },
      (_, i) => Math.round(i * (long - length2) / (count - 1))
    );
    const vertical = height >= width;
    const tiles = starts.map((start2, i) => {
      const previous = starts[i - 1];
      const next = starts[i + 1];
      const bandStart = previous === void 0 ? 0 : (start2 + previous + length2) / 2;
      const bandEnd = next === void 0 ? long : (next + start2 + length2) / 2;
      return vertical ? { x: 0, y: start2, width, height: length2, bandStart, bandEnd } : { x: start2, y: 0, width: length2, height, bandStart, bandEnd };
    });
    return { width, height, vertical, tiles };
  }
  function tilingTag(width, height, budget) {
    return planTiles(width, height, budget) ? ".tiled" : "";
  }
  function toPicture(box, tile, plan) {
    return {
      cx: (tile.x + box.cx * tile.width) / plan.width,
      cy: (tile.y + box.cy * tile.height) / plan.height,
      w: box.w * tile.width / plan.width,
      h: box.h * tile.height / plan.height,
      angle: box.angle
    };
  }
  const move = (box, tile, plan) => box ? toPicture(box, tile, plan) : null;
  function resultToPicture(result, tile, plan) {
    return {
      contentLanguage: result.contentLanguage,
      ocr: result.ocr.map((paragraph) => ({
        ...paragraph,
        geometry: move(paragraph.geometry, tile, plan),
        lines: paragraph.lines.map((line2) => ({
          ...line2,
          geometry: move(line2.geometry, tile, plan),
          words: line2.words.map((word) => ({ ...word, geometry: move(word.geometry, tile, plan) }))
        }))
      })),
      blocks: result.blocks.map((block) => ({
        ...block,
        geometry: move(block.geometry, tile, plan),
        lines: block.lines.map((line2) => ({ ...line2, geometry: move(line2.geometry, tile, plan) }))
      }))
    };
  }
  const DEG$2 = Math.PI / 180;
  function extentOf(box, plan) {
    const w = box.w * plan.width;
    const h = box.h * plan.height;
    const cos = Math.abs(Math.cos(box.angle * DEG$2));
    const sin = Math.abs(Math.sin(box.angle * DEG$2));
    const halfX = (w * cos + h * sin) / 2;
    const halfY = (w * sin + h * cos) / 2;
    const x = box.cx * plan.width;
    const y = box.cy * plan.height;
    return plan.vertical ? { a0: y - halfY, a1: y + halfY, c0: x - halfX, c1: x + halfX } : { a0: x - halfX, a1: x + halfX, c0: y - halfY, c1: y + halfY };
  }
  function union(extents) {
    const first = extents[0];
    if (!first) return null;
    const all2 = { ...first };
    for (const e of extents) {
      all2.a0 = Math.min(all2.a0, e.a0);
      all2.a1 = Math.max(all2.a1, e.a1);
      all2.c0 = Math.min(all2.c0, e.c0);
      all2.c1 = Math.max(all2.c1, e.c1);
    }
    return all2;
  }
  function paragraphExtent(para, plan) {
    const boxes = [para.geometry, ...para.lines.map((line2) => line2.geometry)];
    return union(boxes.flatMap((box) => box ? [extentOf(box, plan)] : []));
  }
  function edgeMargin(para, plan) {
    const thick = para.lines.flatMap(
      (line2) => line2.geometry ? [Math.min(line2.geometry.w * plan.width, line2.geometry.h * plan.height)] : []
    ).sort((a, b) => a - b);
    const median2 = thick[Math.floor(thick.length / 2)] ?? 0;
    return Math.max(4, median2 * 1.5);
  }
  const length = (from, to) => Math.max(0, to - from);
  function relation(a, b) {
    if (!a.extent || !b.extent) return null;
    const along = length(Math.max(a.extent.a0, b.extent.a0), Math.min(a.extent.a1, b.extent.a1));
    const across = length(Math.max(a.extent.c0, b.extent.c0), Math.min(a.extent.c1, b.extent.c1));
    if (along <= 0 || across <= 0) return null;
    if (along * across >= 0.5 * Math.min(a.area, b.area)) return "same";
    const [first, second] = a.tile < b.tile ? [a, b] : [b, a];
    const facing = first.cutEnd && second.cutStart;
    const narrower = Math.min(a.extent.c1 - a.extent.c0, b.extent.c1 - b.extent.c0);
    return facing && across >= 0.5 * narrower ? "pieces" : null;
  }
  function dedupe(perTile, plan, trim) {
    const candidates = [];
    perTile.forEach((items, t2) => {
      const tile = plan.tiles[t2];
      if (!tile) return;
      const start2 = plan.vertical ? tile.y : tile.x;
      const end = start2 + (plan.vertical ? tile.height : tile.width);
      items.forEach((item, index) => {
        const extent = paragraphExtent(item, plan);
        const margin = edgeMargin(item, plan);
        const cutStart = Boolean(extent) && t2 > 0 && extent.a0 - start2 <= margin;
        const cutEnd = Boolean(extent) && t2 < plan.tiles.length - 1 && end - extent.a1 <= margin;
        const centre = extent ? (extent.a0 + extent.a1) / 2 : 0;
        const owned = !extent || centre >= tile.bandStart && centre < tile.bandEnd;
        candidates.push({
          item,
          tile: t2,
          index,
          extent,
          cutStart,
          cutEnd,
          rank: cutStart || cutEnd ? 1 : owned ? 3 : 2,
          area: extent ? (extent.a1 - extent.a0) * (extent.c1 - extent.c0) : 0
        });
      });
    });
    const order = [...candidates].sort(
      (a, b) => b.rank - a.rank || b.area - a.area || a.tile - b.tile || a.index - b.index
    );
    const kept = [];
    for (const candidate2 of order) {
      let current = candidate2;
      for (const other of kept) {
        if (!current) break;
        if (other.tile === current.tile) continue;
        const how = relation(current, other);
        if (!how) continue;
        const bothCut = current.rank === 1 && other.rank === 1;
        if (how === "same" && !bothCut) {
          current = null;
          break;
        }
        const covered = other.extent;
        const keep = [];
        current.item.lines.forEach((line2, i) => {
          if (!line2.geometry) return;
          const e = extentOf(line2.geometry, plan);
          const centre = (e.a0 + e.a1) / 2;
          if (centre < covered.a0 || centre > covered.a1) keep.push(i);
        });
        const trimmed = keep.length ? trim(current.item, keep) : null;
        if (!trimmed) {
          current = null;
          break;
        }
        const extent = paragraphExtent(trimmed, plan);
        current = {
          ...current,
          item: trimmed,
          extent,
          area: extent ? (extent.a1 - extent.a0) * (extent.c1 - extent.c0) : 0
        };
      }
      if (current) kept.push(current);
    }
    return kept.sort((a, b) => a.tile - b.tile || a.index - b.index).map((c) => c.item);
  }
  function boxAround(item, lines, plan) {
    const old = item.geometry;
    if (!old || Math.abs(old.angle) > 1) return old;
    const all2 = union(lines.flatMap((line2) => line2.geometry ? [extentOf(line2.geometry, plan)] : []));
    if (!all2) return old;
    const [x0, x1, y0, y1] = plan.vertical ? [all2.c0, all2.c1, all2.a0, all2.a1] : [all2.a0, all2.a1, all2.c0, all2.c1];
    return {
      cx: (x0 + x1) / 2 / plan.width,
      cy: (y0 + y1) / 2 / plan.height,
      w: (x1 - x0) / plan.width,
      h: (y1 - y0) / plan.height,
      angle: 0
    };
  }
  function trimOcr(paragraph, keep, plan) {
    const lines = keep.flatMap((i) => paragraph.lines[i] ?? []);
    return { ...paragraph, lines, geometry: boxAround(paragraph, lines, plan) };
  }
  function trimBlock(block, keep, plan) {
    const lines = keep.flatMap((i) => block.lines[i] ?? []);
    const ranges = lines.flatMap((line2) => line2.words);
    if (!ranges.length) return null;
    const from = Math.min(...ranges.map(([start2]) => start2));
    const to = Math.max(...ranges.map(([, end]) => end));
    return {
      ...block,
      translation: block.translation.slice(from, to),
      geometry: boxAround(block, lines, plan),
      lines: lines.map((line2) => ({
        ...line2,
        words: line2.words.map(([start2, end]) => [start2 - from, end - from])
      }))
    };
  }
  function mergeTiles(plan, results) {
    const moved = results.map((result, i) => {
      const tile = plan.tiles[i];
      return tile ? resultToPicture(result, tile, plan) : { contentLanguage: "", ocr: [], blocks: [] };
    });
    return {
      contentLanguage: moved.find((result) => result.contentLanguage)?.contentLanguage ?? "",
      ocr: dedupe(
        moved.map((result) => result.ocr),
        plan,
        (paragraph, keep) => trimOcr(paragraph, keep, plan)
      ),
      blocks: dedupe(
        moved.map((result) => result.blocks),
        plan,
        (block, keep) => trimBlock(block, keep, plan)
      )
    };
  }
  const TILE_PARALLEL = 2;
  function looksTransient(error) {
    if (error?.name === "TimeoutError") return false;
    const status = /\bHTTP (\d{3})\b/.exec(String(error?.message ?? ""))?.[1];
    if (!status) return true;
    return status === "408" || status === "429" || !status.startsWith("4");
  }
  async function askLens(source, options) {
    const { width, height } = sourceSize(source);
    const plan = planTiles(width, height, options);
    if (!plan) return callLens(await encodeForUpload(source, options), options);
    const total2 = plan.tiles.length;
    const results = new Array(total2);
    const ask = async (index) => {
      const tile = plan.tiles[index];
      if (!tile) return;
      const once = async () => {
        const encoded = await encodeRect(source, tile, options);
        return callLens(
          { imageBytes: encoded.bytes, width: encoded.width, height: encoded.height },
          options
        );
      };
      try {
        try {
          results[index] = await once();
        } catch (error) {
          if (!looksTransient(error)) throw error;
          results[index] = await once();
        }
      } catch (error) {
        throw new Error(`part ${index + 1} of ${total2} of a long picture: ${error.message}`);
      }
    };
    await ask(0);
    let next = 1;
    let failure = null;
    const worker = async () => {
      while (!failure && next < total2) {
        const index = next;
        next += 1;
        try {
          await ask(index);
        } catch (error) {
          failure ??= error;
        }
      }
    };
    await Promise.all(Array.from({ length: TILE_PARALLEL }, worker));
    if (failure) throw failure;
    return mergeTiles(plan, results);
  }
  const TUNING = {
    side: 1024,
    cell: 8,
    edge: 40,
    edgesX: 6,
    edgesY: 3,
    range: 70,
    cells: 16
  };
  function looksLikeText(gray, width, height, tuning = TUNING) {
    const { cell: CELL, edge: EDGE, edgesX: MIN_EDGES_X, edgesY: MIN_EDGES_Y, range: MIN_RANGE } = tuning;
    const cols = Math.floor(width / CELL);
    const rows = Math.floor(height / CELL);
    if (cols < 2 || rows < 1) return false;
    const lettered = new Uint8Array(cols * rows);
    for (let cy = 0; cy < rows; cy += 1) {
      for (let cx = 0; cx < cols; cx += 1) {
        let ex = 0;
        let ey = 0;
        let lo = 255;
        let hi = 0;
        for (let y = cy * CELL; y < (cy + 1) * CELL; y += 1) {
          for (let x = cx * CELL; x < (cx + 1) * CELL; x += 1) {
            const v = gray[y * width + x];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
            if (x + 1 < width && Math.abs(v - gray[y * width + x + 1]) > EDGE) ex += 1;
            if (y + 1 < height && Math.abs(v - gray[(y + 1) * width + x]) > EDGE) ey += 1;
          }
        }
        if (hi - lo >= MIN_RANGE && ex >= MIN_EDGES_X && ey >= MIN_EDGES_Y) lettered[cy * cols + cx] = 1;
      }
    }
    let joined = 0;
    for (let cy = 0; cy < rows; cy += 1) {
      for (let cx = 0; cx < cols; cx += 1) {
        if (!lettered[cy * cols + cx]) continue;
        const beside = cx > 0 && lettered[cy * cols + cx - 1] || cx + 1 < cols && lettered[cy * cols + cx + 1] || cy > 0 && lettered[(cy - 1) * cols + cx] || cy + 1 < rows && lettered[(cy + 1) * cols + cx];
        if (beside) joined += 1;
      }
    }
    return joined >= tuning.cells;
  }
  let native;
  function nativeDetector() {
    if (native !== void 0) return native;
    native = null;
    try {
      const Ctor = globalThis.TextDetector;
      if (typeof Ctor === "function") native = new Ctor();
    } catch {
    }
    return native;
  }
  async function mayHaveText(source, width, height, tuning = TUNING) {
    const detector = tuning === TUNING ? nativeDetector() : null;
    if (detector) {
      try {
        return (await detector.detect(source)).length > 0;
      } catch {
        native = null;
      }
    }
    const scale = Math.min(1, tuning.side / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const gray = new Uint8Array(w * h);
      for (let i = 0; i < gray.length; i += 1) {
        gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
      }
      return looksLikeText(gray, w, h, tuning);
    } catch {
      return true;
    }
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
                (t2) => t2.str(F.TextQuery.query, query)
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
      (paragraph) => paragraph.lines.map((line2) => line2.text.trim()).filter(Boolean).join("\n")
    ).filter(Boolean).join("\n\n");
  }
  const SCALE_MIN = 0.3;
  const SCALE_MAX = 3;
  const OFFSET_MAX = 1;
  const HEX = /^#[0-9a-f]{6}$/i;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  function cleanEdit(edit) {
    if (!edit) return null;
    if (edit.original) return { original: true };
    const out = {};
    if (typeof edit.text === "string") out.text = edit.text.slice(0, 2e3);
    if (typeof edit.scale === "number" && Number.isFinite(edit.scale)) {
      const scale = clamp(edit.scale, SCALE_MIN, SCALE_MAX);
      if (Math.abs(scale - 1) > 5e-3) out.scale = Math.round(scale * 100) / 100;
    }
    if (typeof edit.color === "string" && HEX.test(edit.color)) out.color = edit.color.toLowerCase();
    if (typeof edit.outline === "string" && HEX.test(edit.outline)) out.outline = edit.outline.toLowerCase();
    for (const axis of ["dx", "dy"]) {
      const value = edit[axis];
      if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) > 5e-4) {
        out[axis] = Math.round(clamp(value, -OFFSET_MAX, OFFSET_MAX) * 1e4) / 1e4;
      }
    }
    if (edit.hidden) out.hidden = true;
    return Object.keys(out).length ? out : null;
  }
  function cleanEdits(edits, blocks) {
    if (!edits || typeof edits !== "object") return void 0;
    const out = {};
    for (const [key, value] of Object.entries(edits)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= blocks) continue;
      const edit = cleanEdit(value);
      if (edit) out[index] = edit;
    }
    return Object.keys(out).length ? out : void 0;
  }
  const resets = (edit) => Boolean(edit && (edit.text !== void 0 || edit.scale !== void 0 || edit.dx || edit.dy));
  function editsTag(edits) {
    if (!edits) return "";
    const keys = Object.keys(edits).sort((a, b) => Number(a) - Number(b));
    if (!keys.length) return "";
    return `|e=${JSON.stringify(keys.map((key) => [key, edits[Number(key)]]))}`;
  }
  const argbToHex = (value) => `#${(value & 16777215).toString(16).padStart(6, "0")}`;
  const DB_NAME = "lens-translate";
  const DB_VERSION = 3;
  const RESPONSES = "responses";
  const META = "meta";
  const FACES = "faces";
  const faceBytes = (record) => record.gray.byteLength + record.marks.reduce((sum, mark) => sum + mark.gray.byteLength + 32, 0);
  let open$1 = null;
  function database() {
    if (open$1) return open$1;
    open$1 = new Promise((resolve2) => {
      let request2;
      try {
        request2 = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve2(null);
        return;
      }
      request2.onupgradeneeded = (event) => {
        const oldVersion = event.oldVersion;
        const db = request2.result;
        if (oldVersion < 2) {
          if (db.objectStoreNames.contains(RESPONSES)) db.deleteObjectStore(RESPONSES);
          if (db.objectStoreNames.contains(META)) db.deleteObjectStore(META);
        }
        if (!db.objectStoreNames.contains(RESPONSES)) db.createObjectStore(RESPONSES, { keyPath: "key" });
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: "key" }).createIndex("used", "used");
        }
        if (!db.objectStoreNames.contains(FACES)) db.createObjectStore(FACES, { keyPath: "key" });
      };
      request2.onsuccess = () => {
        const db = request2.result;
        db.onversionchange = () => {
          db.close();
          open$1 = null;
        };
        resolve2(db);
      };
      request2.onerror = () => resolve2(null);
      request2.onblocked = () => resolve2(null);
    });
    return open$1;
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
      for (const line2 of block.lines) bytes2 += line2.background?.bytes.byteLength ?? 0;
    }
    return bytes2;
  }
  const TOUCH_INTERVAL_MS = 6e4;
  const lastTouched = /* @__PURE__ */ new Map();
  async function readEntry(key) {
    let entry;
    await transact("readonly", [RESPONSES], (tx) => {
      const request2 = tx.objectStore(RESPONSES).get(key);
      request2.onsuccess = () => {
        entry = request2.result;
      };
    });
    return entry;
  }
  const keyOfResult = /* @__PURE__ */ new WeakMap();
  const askOf = (settings, tag) => `${languagesOf(settings)}\0${tag}`;
  let nearIndex = null;
  let nearRead = 0;
  const NEAR_TTL_MS = 6e4;
  async function nearCandidates() {
    if (!nearIndex || Date.now() - nearRead > NEAR_TTL_MS) {
      nearIndex = (await stored()).filter((meta) => meta.near);
      nearRead = Date.now();
    }
    return nearIndex;
  }
  const NEAR_READS = 4;
  async function findNear(near, settings) {
    const ask = askOf(settings, near.tag);
    const found = (await nearCandidates()).filter(
      (meta) => meta.near.ask === ask && reusable(meta.near.size, near.size) && candidate(near.face, meta.near)
    ).sort((a, b) => b.near.size - a.near.size).slice(0, NEAR_READS);
    for (const meta of found) {
      let record;
      await transact("readonly", [FACES], (tx) => {
        const request2 = tx.objectStore(FACES).get(meta.key);
        request2.onsuccess = () => {
          record = request2.result;
        };
      });
      if (!record?.gray || !record.marks?.length) continue;
      if (!sameFrame(near.face, { gray: record.gray, coarse: meta.near.coarse, aspect: meta.near.aspect })) continue;
      const strips = near.sample(record.marks.map((mark) => mark.box));
      const smaller = record.width * record.height < near.width * near.height ? { width: record.width, height: record.height } : { width: near.width, height: near.height };
      if (linesAgree(record.marks, strips, smaller)) return meta.key;
    }
    return null;
  }
  async function getStored(hash, settings, near) {
    if (!hash || !settings.persistCache) return null;
    let key = entryKey(hash, settings);
    let entry = await readEntry(key);
    if (!entry && near) {
      const other = await findNear(near, settings);
      if (other) {
        key = other;
        entry = await readEntry(key);
      }
    }
    if (!entry) return null;
    const edits = cleanEdits(entry.result.edits, entry.result.blocks?.length ?? 0);
    if (edits) entry.result.edits = edits;
    else delete entry.result.edits;
    keyOfResult.set(entry.result, key);
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
  const budgetOf = (settings) => settings.storeBytes ?? settings.cacheBytes;
  async function putStored(hash, result, settings, near) {
    const budget = budgetOf(settings);
    if (!hash || !settings.persistCache || budget <= 0) return;
    let face = null;
    if (near) {
      const boxes = markBoxes(result.ocr);
      const strips = boxes.length ? near.sample(boxes) : [];
      if (strips.length === boxes.length && boxes.length) {
        face = {
          key: "",
          gray: near.face.gray,
          width: near.width,
          height: near.height,
          marks: boxes.map((box, i) => ({ box, gray: strips[i] }))
        };
      }
    }
    const bytes2 = weigh$1(result) + (face ? faceBytes(face) : 0);
    if (bytes2 > budget) return;
    const key = entryKey(hash, settings);
    const now = Date.now();
    const entry = { key, hash, languages: languagesOf(settings), result, bytes: bytes2 };
    let delta = bytes2;
    const meta = { key, used: now, bytes: bytes2 };
    if (near && face) {
      meta.near = {
        ask: askOf(settings, near.tag),
        aspect: near.face.aspect,
        coarse: near.face.coarse,
        size: near.size
      };
    }
    const written = await transact("readwrite", [RESPONSES, META, FACES], (tx) => {
      const metas = tx.objectStore(META);
      const previous = metas.get(key);
      previous.onsuccess = () => {
        delta = bytes2 - (previous.result?.bytes ?? 0);
        tx.objectStore(RESPONSES).put(entry);
        metas.put(meta);
        if (face) tx.objectStore(FACES).put({ ...face, key });
        else tx.objectStore(FACES).delete(key);
      };
    });
    if (!written) return;
    keyOfResult.set(result, key);
    if (nearIndex) nearIndex = [...nearIndex.filter((m) => m.key !== key), ...meta.near ? [meta] : []];
    lastTouched.set(key, now);
    writesSinceCount += 1;
    if (writesSinceCount >= RECOUNT_EVERY) total = null;
    if (total !== null) total += delta;
    await evict$1(budget);
  }
  async function evict$1(budget) {
    if (total === null) {
      total = (await stored()).reduce((sum, meta) => sum + meta.bytes, 0);
      writesSinceCount = 0;
    }
    if (total <= budget) return;
    let remaining = total;
    const done = await transact("readwrite", [RESPONSES, META, FACES], (tx) => {
      const metas = tx.objectStore(META);
      const responses = tx.objectStore(RESPONSES);
      const faces = tx.objectStore(FACES);
      const cursor = metas.index("used").openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at || remaining <= budget) return;
        const meta = at.value;
        remaining -= meta.bytes;
        responses.delete(meta.key);
        faces.delete(meta.key);
        lastTouched.delete(meta.key);
        at.delete();
        at.continue();
      };
    });
    total = done ? remaining : null;
    nearIndex = null;
  }
  async function putEdits(result) {
    const key = keyOfResult.get(result);
    if (!key) return false;
    const entry = await readEntry(key);
    if (!entry) return false;
    if (result.edits) entry.result.edits = result.edits;
    else delete entry.result.edits;
    return transact("readwrite", [RESPONSES], (tx) => {
      tx.objectStore(RESPONSES).put(entry);
    });
  }
  async function clearStored() {
    await transact("readwrite", [RESPONSES, META, FACES], (tx) => {
      tx.objectStore(RESPONSES).clear();
      tx.objectStore(META).clear();
      tx.objectStore(FACES).clear();
    });
    lastTouched.clear();
    nearIndex = null;
    total = 0;
    writesSinceCount = 0;
  }
  async function storedStats() {
    const all2 = await stored();
    return { entries: all2.length, bytes: all2.reduce((sum, meta) => sum + meta.bytes, 0) };
  }
  const WritingDirection = {
    LeftToRight: 0,
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
  function fontOf(px2, family, weight = 400) {
    return weight === 400 ? `${px2}px ${family}` : `${weight} ${px2}px ${family}`;
  }
  const baseLang = (tag) => tag.split("-")[0]?.toLowerCase() ?? "";
  function fitFontSize(str, boxWidth, boxHeight, fontFamily, maxSize = MAX_FONT_SIZE, fontWeight = 400) {
    const ctx = measurer();
    if (!ctx) return MIN_FONT_SIZE;
    let low = MIN_FONT_SIZE;
    let high = maxSize;
    while (low <= high) {
      const mid = low + high >> 1;
      ctx.font = fontOf(mid, fontFamily, fontWeight);
      const metrics = ctx.measureText(str);
      const height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
      if (metrics.width >= boxWidth || height >= boxHeight) high = mid - 1;
      else low = mid + 1;
    }
    return Math.max(MIN_FONT_SIZE, Math.min(low - 1, maxSize));
  }
  function buildLineText(translation, line2, nextLine) {
    let out = "";
    line2.words.forEach(([start2, end], i) => {
      out += translation.slice(start2, end);
      const next = line2.words[i + 1];
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
        const candidate2 = current ? `${current}${joiner}${token}` : token;
        if (measure(candidate2) <= maxWidth || !current) current = candidate2;
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
      const widest = lines.reduce((max, line2) => Math.max(max, measure(line2)), 0);
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
    const code2 = char.codePointAt(0) ?? 0;
    return UPRIGHT_RANGES.some(([low, high]) => code2 >= low && code2 <= high);
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
      for (const line2 of block.lines) bytes2 += line2.background?.bytes.byteLength ?? 0;
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
    const key = [normalizeUrl(url), settings.targetLang, settings.sourceLang, settings.ocrLang];
    if (settings.tileLongImages === "off") key.push("untiled");
    return key.join("\0");
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
  const DRAWN$1 = Object.keys({
    fontFamily: 0,
    fontWeight: 0,
    textColor: 0,
    outlineColor: 0,
    fillColor: 0,
    drawBackground: 0,
    patchPadding: 0,
    maxCanvasSide: 0,
    mangaMinPx: 0,
    verticalText: 0,
    minReadablePx: 0,
    supersample: 0,
    mangaMode: 0,
    mangaBoxGrowth: 0,
    outlineScale: 0,
    eraseMode: 0,
    hullPadding: 0,
    reflowHorizontal: 0,
    bubbleShape: 0,
    fitToBox: 0,
    lineSpacing: 0,
    textAlign: 0
  }).sort();
  function renderKey(key, settings, displayedWidth, edits) {
    const parts = [key];
    for (const name of DRAWN$1) parts.push(`${name}=${String(settings[name])}`);
    parts.push(`w=${Math.round(displayedWidth / 50)}`);
    return parts.join(SEPARATOR) + editsTag(edits);
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
    const rect2 = img.getBoundingClientRect();
    layer.style.top = `${rect2.top}px`;
    layer.style.left = `${rect2.left}px`;
    layer.style.width = `${rect2.width}px`;
    layer.style.height = `${rect2.height}px`;
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
  function renderBackground(layer, line2, geometry, aspect, objectUrls) {
    if (!line2.background) return;
    const padW = line2.background.hPad * geometry.h / aspect;
    const padH = line2.background.vPad * geometry.h;
    const url = URL.createObjectURL(new Blob([line2.background.bytes], { type: "image/webp" }));
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
    const rect2 = img.getBoundingClientRect();
    const aspect = natural.width / natural.height;
    const fontFamily = settings.fontFamily || getComputedStyle(img).fontFamily || "system-ui, sans-serif";
    const layer = document.createElement("div");
    layer.className = "lt-layer";
    placeLayer(layer, img);
    if (options.opacity !== void 0 && options.opacity < 1) layer.style.opacity = String(options.opacity);
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
      block.lines.forEach((line2, index) => {
        const geometry = line2.geometry;
        if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;
        const patch = Boolean(settings.drawBackground && line2.background);
        if (patch) renderBackground(layer, line2, geometry, aspect, objectUrls);
        const str = buildLineText(block.translation, line2, block.lines[index + 1]);
        if (!str.trim()) return;
        const boxW = geometry.w * rect2.width;
        const boxH = geometry.h * rect2.height;
        const size = fitFontSize(
          str,
          vertical ? boxH : boxW,
          vertical ? boxW : boxH,
          fontFamily,
          void 0,
          settings.fontWeight
        );
        const bgColor = settings.fillColor || argbToCss(line2.bgColor);
        const outlineColor = settings.outlineColor || argbToCss(line2.bgColor);
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
          `color:${settings.textColor || argbToCss(line2.textColor)}`,
          settings.fontWeight === 400 ? "" : `font-weight:${settings.fontWeight}`,
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
          patch ? `text-shadow:${textShadow(outline, outlineColor)}` : ""
        ].filter(Boolean).join(";");
        layer.appendChild(element);
        rendered += 1;
      });
    }
    return rendered;
  }
  function reflowMode(value) {
    if (value === true || value === "on") return "on";
    if (value === false || value === "off") return "off";
    return "auto";
  }
  const COLUMN_MIN_LINES = 3;
  const COLUMN_MAX_LINE_ASPECT = 12;
  const COLUMN_MAX_ASPECT = 2.5;
  const COLUMN_MAX_ASPECT_TALL = 3.2;
  const COLUMN_TALL_LINES = 4;
  const COLUMN_MAX_OFF_CENTRE = 0.15;
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[sorted.length >> 1] ?? 0;
  };
  function isBubbleColumn(lines, paragraph, minLines = COLUMN_MIN_LINES) {
    if (lines.length < Math.max(2, minLines)) return false;
    const paraW = paragraph.right - paragraph.left;
    const paraH = paragraph.bottom - paragraph.top;
    const maxAspect = lines.length >= COLUMN_TALL_LINES ? COLUMN_MAX_ASPECT_TALL : COLUMN_MAX_ASPECT;
    if (!(paraW > 0) || !(paraH > 0) || paraW > maxAspect * paraH) return false;
    const sorted = [...lines].sort((a, b) => a.top + a.bottom - (b.top + b.bottom));
    for (let i = 1; i < sorted.length; i += 1) {
      const above = sorted[i - 1];
      if (sorted[i].top < (above.top + above.bottom) / 2) return false;
    }
    const aspects = sorted.map((line2) => (line2.right - line2.left) / Math.max(1, line2.bottom - line2.top));
    if (median(aspects) > COLUMN_MAX_LINE_ASPECT) return false;
    const centres = sorted.map((line2) => (line2.left + line2.right) / 2);
    const axis = median(centres);
    return centres.every((centre) => Math.abs(centre - axis) <= COLUMN_MAX_OFF_CENTRE * paraW);
  }
  function crowdsAtFloor(fitted, floor) {
    return floor > 0 && fitted.some((size) => size < floor);
  }
  function collidesAtFloor(lines, fitted, floor) {
    if (lines.length < 2 || lines.length !== fitted.length || !crowdsAtFloor(fitted, floor)) return false;
    const order = lines.map((line2, index) => ({ cy: (line2.top + line2.bottom) / 2, size: Math.max(fitted[index] ?? 0, floor) })).sort((a, b) => a.cy - b.cy);
    for (let i = 1; i < order.length; i += 1) {
      const above = order[i - 1];
      const below = order[i];
      if (below.cy - above.cy < (above.size + below.size) / 2) return true;
    }
    return false;
  }
  const BG_TOLERANCE = 32;
  const MIN_BG_SHARE = 0.4;
  const TAIL_SHARE = 0.3;
  const gridBox = (rect2, width, height) => ({
    x0: Math.max(0, Math.min(width, Math.floor(rect2.left))),
    y0: Math.max(0, Math.min(height, Math.floor(rect2.top))),
    x1: Math.max(0, Math.min(width, Math.ceil(rect2.right))),
    y1: Math.max(0, Math.min(height, Math.ceil(rect2.bottom)))
  });
  function bubbleMask(pixels, lines, blocked, open2, maxArea = Infinity) {
    const { data, width, height } = pixels;
    if (width < 1 || height < 1) return null;
    const boxes = lines.map((line2) => gridBox(line2, width, height)).filter((box) => box.x1 > box.x0 && box.y1 > box.y0);
    if (!boxes.length) return null;
    const bins = new Uint32Array(4096);
    const binOf = (i) => data[i] >> 4 << 8 | data[i + 1] >> 4 << 4 | data[i + 2] >> 4;
    let total2 = 0;
    for (const box of boxes) {
      for (let y = box.y0; y < box.y1; y += 1) {
        for (let x = box.x0; x < box.x1; x += 1) {
          const bin = binOf((y * width + x) * 4);
          bins[bin] = bins[bin] + 1;
          total2 += 1;
        }
      }
    }
    let top = 0;
    for (let bin = 1; bin < bins.length; bin += 1) {
      if (bins[bin] > bins[top]) top = bin;
    }
    let red = 0;
    let green = 0;
    let blue = 0;
    let members = 0;
    for (const box of boxes) {
      for (let y = box.y0; y < box.y1; y += 1) {
        for (let x = box.x0; x < box.x1; x += 1) {
          const i = (y * width + x) * 4;
          if (binOf(i) !== top) continue;
          red += data[i];
          green += data[i + 1];
          blue += data[i + 2];
          members += 1;
        }
      }
    }
    if (!members) return null;
    red /= members;
    green /= members;
    blue /= members;
    const state = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < state.length; p += 1, i += 4) {
      const off = Math.max(
        Math.abs(data[i] - red),
        Math.abs(data[i + 1] - green),
        Math.abs(data[i + 2] - blue)
      );
      if (off <= BG_TOLERANCE) state[p] = 1;
    }
    for (const rect2 of blocked) {
      const box = gridBox(rect2, width, height);
      for (let y = box.y0; y < box.y1; y += 1) state.fill(3, y * width + box.x0, y * width + box.x1);
    }
    const stack = new Int32Array(width * height);
    let depth = 0;
    let seeds = 0;
    for (const box of boxes) {
      for (let y = box.y0; y < box.y1; y += 1) {
        for (let p = y * width + box.x0; p < y * width + box.x1; p += 1) {
          if (state[p] !== 1) continue;
          state[p] = 2;
          stack[depth] = p;
          depth += 1;
          seeds += 1;
        }
      }
    }
    if (seeds < total2 * MIN_BG_SHARE) return null;
    while (depth > 0) {
      depth -= 1;
      const p = stack[depth];
      const x = p % width;
      if (x > 0 && state[p - 1] === 1) {
        state[p - 1] = 2;
        stack[depth] = p - 1;
        depth += 1;
      }
      if (x < width - 1 && state[p + 1] === 1) {
        state[p + 1] = 2;
        stack[depth] = p + 1;
        depth += 1;
      }
      if (p >= width && state[p - width] === 1) {
        state[p - width] = 2;
        stack[depth] = p - width;
        depth += 1;
      }
      if (p + width < state.length && state[p + width] === 1) {
        state[p + width] = 2;
        stack[depth] = p + width;
        depth += 1;
      }
    }
    for (let y = 0; y < height; y += 1) {
      if (open2.left && state[y * width] === 2) return null;
      if (open2.right && state[y * width + width - 1] === 2) return null;
    }
    for (let x = 0; x < width; x += 1) {
      if (open2.top && state[x] === 2) return null;
      if (open2.bottom && state[(height - 1) * width + x] === 2) return null;
    }
    let linesTop = height;
    let linesBottom = 0;
    const thickness = [];
    for (const box of boxes) {
      for (let y = box.y0; y < box.y1; y += 1) state.fill(2, y * width + box.x0, y * width + box.x1);
      linesTop = Math.min(linesTop, box.y0);
      linesBottom = Math.max(linesBottom, box.y1);
      thickness.push(Math.min(box.x1 - box.x0, box.y1 - box.y0));
    }
    const stroke2 = median(thickness);
    for (let y = linesTop; y < linesBottom; y += 1) {
      let reached = -1;
      for (let x = 0; x < width; x += 1) {
        if (state[y * width + x] !== 2) continue;
        if (reached >= 0 && x - reached > 1 && x - reached - 1 <= stroke2) {
          let clear = true;
          for (let between = reached + 1; between < x; between += 1) {
            if (state[y * width + between] === 3) clear = false;
          }
          if (clear) state.fill(2, y * width + reached + 1, y * width + x);
        }
        reached = x;
      }
    }
    const left = new Int32Array(height).fill(-1);
    const right = new Int32Array(height).fill(-1);
    const anchor = [...boxes].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1))[boxes.length >> 1];
    const row2 = Math.min(height - 1, anchor.y0 + anchor.y1 >> 1);
    const column2 = Math.min(width - 1, anchor.x0 + anchor.x1 >> 1);
    let from = column2;
    let to = column2 + 1;
    while (from > 0 && state[row2 * width + from - 1] === 2) from -= 1;
    while (to < width && state[row2 * width + to] === 2) to += 1;
    left[row2] = from;
    right[row2] = to;
    const follow = (y, lo, hi) => {
      let best = 0;
      let x = lo;
      while (x > 0 && state[y * width + x] === 2 && state[y * width + x - 1] === 2) x -= 1;
      while (x < hi) {
        if (state[y * width + x] !== 2) {
          x += 1;
          continue;
        }
        let end = x;
        while (end < width && state[y * width + end] === 2) end += 1;
        const shared = Math.min(end, hi) - Math.max(x, lo);
        if (shared > best) {
          best = shared;
          left[y] = x;
          right[y] = end;
        }
        x = end;
      }
      return best > 0;
    };
    let first = row2;
    let last = row2 + 1;
    for (let y = row2 - 1; y >= 0; y -= 1) {
      if (!follow(y, left[y + 1], right[y + 1])) break;
      first = y;
    }
    for (let y = row2 + 1; y < height; y += 1) {
      if (!follow(y, left[y - 1], right[y - 1])) break;
      last = y + 1;
    }
    let widest = 0;
    for (let y = first; y < last; y += 1) widest = Math.max(widest, right[y] - left[y]);
    const narrow = (y) => right[y] - left[y] < widest * TAIL_SHARE;
    while (first < linesTop && narrow(first)) first += 1;
    while (last > linesBottom && narrow(last - 1)) last -= 1;
    let area = 0;
    for (let y = first; y < last; y += 1) area += right[y] - left[y];
    if (area > maxArea) return null;
    return { width, height, top: first, bottom: last, left, right };
  }
  function maskShape(mask, originX, originY, scaleX, scaleY) {
    return {
      top: originY + mask.top * scaleY,
      bottom: originY + mask.bottom * scaleY,
      span(y0, y1) {
        const from = Math.floor((y0 - originY) / scaleY);
        const to = Math.ceil((y1 - originY) / scaleY);
        if (from < mask.top || to > mask.bottom || to <= from) return null;
        let lo = -Infinity;
        let hi = Infinity;
        for (let y = from; y < to; y += 1) {
          lo = Math.max(lo, mask.left[y]);
          hi = Math.min(hi, mask.right[y]);
        }
        return hi > lo ? [originX + lo * scaleX, originX + hi * scaleX] : null;
      }
    };
  }
  function ellipseShape(cx, cy, rx, ry) {
    return {
      top: cy - ry,
      bottom: cy + ry,
      span(y0, y1) {
        const reach = Math.max(Math.abs(y0 - cy), Math.abs(y1 - cy)) / ry;
        if (!(reach < 1) || !(rx > 0)) return null;
        const half = rx * Math.sqrt(1 - reach * reach);
        return [cx - half, cx + half];
      }
    };
  }
  const SHAPE_MARGIN = 0.25;
  function arrange(widths, gap, shape, size, spacing) {
    const pitch = size * spacing;
    const margin = size * SHAPE_MARGIN;
    const middle = (shape.top + shape.bottom) / 2;
    const height = shape.bottom - shape.top;
    for (let count = 1; count * pitch <= height && count <= widths.length; count += 1) {
      const slots = [];
      let next = 0;
      const blockTop = middle - count * pitch / 2;
      for (let i = 0; i < count && next < widths.length; i += 1) {
        const y = blockTop + i * pitch + (pitch - size) / 2;
        const span = shape.span(y - margin, y + size + margin);
        if (!span) break;
        const left = span[0] + margin;
        const right = span[1] - margin;
        const from = next;
        let used = 0;
        while (next < widths.length) {
          const wider = used + (next > from ? gap : 0) + widths[next];
          if (wider > right - left) break;
          used = wider;
          next += 1;
        }
        if (next === from) break;
        slots.push({ from, to: next, left, right, y });
      }
      if (next >= widths.length) return slots;
    }
    return null;
  }
  function layoutShaped(measure, tokens, joiner, shape, size, spacing) {
    const slots = arrange(tokens.map(measure), joiner ? measure(joiner) : 0, shape, size, spacing);
    if (!slots) return null;
    const lines = [];
    for (const slot of slots) {
      const text2 = tokens.slice(slot.from, slot.to).join(joiner);
      if (measure(text2) > slot.right - slot.left) return null;
      lines.push({ text: text2, left: slot.left, right: slot.right, y: slot.y });
    }
    return lines;
  }
  function fitShaped(setFont, measure, text2, shape, spacing, perCharacter = false, maxSize = MAX_FONT_SIZE) {
    const flat = text2.trim().replace(/\s+/g, " ");
    if (!flat) return null;
    const tokens = perCharacter ? [...flat] : flat.split(" ");
    const joiner = perCharacter ? "" : " ";
    const high = Math.max(MIN_FONT_SIZE, Math.floor(maxSize));
    setFont(high);
    const widths = tokens.map(measure);
    const gap = joiner ? measure(joiner) : 0;
    for (let size = high; size >= MIN_FONT_SIZE; size -= 1) {
      const ratio = size / high;
      if (!arrange(widths.map((width) => width * ratio), gap * ratio, shape, size, spacing)) continue;
      setFont(size);
      const lines = layoutShaped(measure, tokens, joiner, shape, size, spacing);
      if (lines) return { size, lines };
    }
    return null;
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
    const { ctx, width, height, fontFamily, fontWeight } = draw;
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
    const measure = (candidate2) => ctx.measureText(candidate2).width;
    const setFont = (px2) => {
      ctx.font = fontOf(px2, fontFamily, fontWeight);
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
    const widest = lines.reduce((max, line2) => Math.max(max, measure(line2)), 0);
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
    const fill = settings.textColor || argbToCss(style.textColor);
    const outline = Math.max(
      0,
      Math.round(fontSize * OUTLINE_RATIO * 2 * settings.outlineScale)
    );
    const outlineColor = settings.outlineColor || argbToCss(style.bgColor);
    const justify = justification(block.alignment, isRtl(block), settings.textAlign);
    let y = -Math.min(boxH, lines.length * lineHeight) / 2;
    for (const line2 of lines) {
      const advance = ctx.measureText(line2).width;
      const x = justify === "flex-start" ? -boxW / 2 : justify === "flex-end" ? boxW / 2 - advance : -advance / 2;
      strokeThenFill(ctx, line2, x, y, outline, outlineColor);
      ctx.fillStyle = fill;
      ctx.fillText(line2, x, y);
      y += lineHeight;
    }
    ctx.restore();
  }
  const WINDOW_PAD = 1.5;
  const MASK_PIXELS = 12e4;
  const MAX_COVER = 0.5;
  const UPRIGHT = 1;
  const MAX_UPSCALE = 1.6;
  function findBubble(source, canvasScale, width, height, own, lines, others) {
    const pad = Math.max(own.right - own.left, own.bottom - own.top) * WINDOW_PAD;
    if (!(pad > 0)) return null;
    const room = roomFor(own, others, 1e6, width, height);
    const open2 = {
      left: own.left - pad > room.left,
      top: own.top - pad > room.top,
      right: own.right + pad < room.right,
      bottom: own.bottom + pad < room.bottom
    };
    const sx = Math.floor(Math.max(room.left, own.left - pad) / canvasScale);
    const sy = Math.floor(Math.max(room.top, own.top - pad) / canvasScale);
    const sw = Math.ceil(Math.min(room.right, own.right + pad) / canvasScale) - sx;
    const sh = Math.ceil(Math.min(room.bottom, own.bottom + pad) / canvasScale) - sy;
    if (sw < 2 || sh < 2) return null;
    const shrink = Math.min(1, Math.sqrt(MASK_PIXELS / (sw * sh)));
    const gw = Math.max(1, Math.round(sw * shrink));
    const gh = Math.max(1, Math.round(sh * shrink));
    const scaleX = sw / gw * canvasScale;
    const scaleY = sh / gh * canvasScale;
    const x = sx * canvasScale;
    const y = sy * canvasScale;
    let pixels;
    try {
      const scratch = document.createElement("canvas");
      scratch.width = gw;
      scratch.height = gh;
      const ctx = scratch.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, gw, gh);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, gw, gh);
      pixels = ctx.getImageData(0, 0, gw, gh);
    } catch {
      return null;
    }
    const toGrid = (rect2, grow = 0) => ({
      left: (rect2.left - grow - x) / scaleX,
      right: (rect2.right + grow - x) / scaleX,
      top: (rect2.top - grow - y) / scaleY,
      bottom: (rect2.bottom + grow - y) / scaleY
    });
    const mask = bubbleMask(
      pixels,
      lines.map((line2) => toGrid(line2)),
      // The same daylight roomFor keeps between two paragraphs.
      others.map((other) => toGrid(other, 2)),
      open2,
      MAX_COVER * width * height / (scaleX * scaleY)
    );
    return mask ? { mask, x, y, scaleX, scaleY } : null;
  }
  function drawShapedParagraph(draw, block, settings, shape, frame2) {
    const style = block.lines[0];
    const text2 = block.translation.trim();
    if (!style || !text2) return false;
    const { ctx, fontFamily, fontWeight } = draw;
    const spacing = settings.lineSpacing > 0 ? settings.lineSpacing : 1.25;
    const measure = (candidate2) => ctx.measureText(candidate2).width;
    const setFont = (px2) => {
      ctx.font = fontOf(px2, fontFamily, fontWeight);
    };
    const heights = block.lines.flatMap(
      (line2) => line2.geometry ? [Math.min(line2.geometry.w * draw.width, line2.geometry.h * draw.height)] : []
    ).sort((a, b) => a - b);
    const sourceSize2 = heights[heights.length >> 1] ?? 0;
    const ceiling = sourceSize2 > 0 ? Math.min(draw.maxFontPx, Math.max(sourceSize2 * MAX_UPSCALE, draw.minFontPx)) : draw.maxFontPx;
    ctx.save();
    ctx.translate(frame2.x, frame2.y);
    ctx.rotate(frame2.angle * DEG);
    ctx.direction = isRtl(block) ? "rtl" : "ltr";
    const fit = fitShaped(setFont, measure, text2, shape, spacing, wrapsPerCharacter(block), ceiling);
    if (!fit || fit.size < draw.minFontPx && !settings.fitToBox) {
      ctx.restore();
      return false;
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const fill = settings.textColor || argbToCss(style.textColor);
    const outline = Math.max(0, Math.round(fit.size * OUTLINE_RATIO * 2 * settings.outlineScale));
    const outlineColor = settings.outlineColor || argbToCss(style.bgColor);
    for (const line2 of fit.lines) {
      const advance = measure(line2.text);
      const x = settings.textAlign === "left" ? line2.left : settings.textAlign === "right" ? line2.right - advance : (line2.left + line2.right - advance) / 2;
      strokeThenFill(ctx, line2.text, x, line2.y, outline, outlineColor);
      ctx.fillStyle = fill;
      ctx.fillText(line2.text, x, line2.y);
    }
    ctx.restore();
    return true;
  }
  function eraseTextArea(draw, block, settings) {
    const { ctx, width, height } = draw;
    const points = [];
    let thinnest = Infinity;
    for (const line2 of block.lines) {
      if (!line2.geometry) continue;
      points.push(...boxCorners(line2.geometry, width, height));
      thinnest = Math.min(thinnest, line2.geometry.w * width, line2.geometry.h * height);
    }
    if (points.length < 3) return;
    const style = block.lines.find((line2) => line2.geometry) ?? block.lines[0];
    if (!style) return;
    const pad = Number.isFinite(thinnest) ? thinnest * settings.hullPadding : 0;
    fillHull(ctx, convexHull(points), settings.fillColor || argbToCss(style.bgColor), pad);
  }
  function nudgeInside(draw, box, line2) {
    const radians = line2.angle * DEG;
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
    const dx = shift(line2.cx, halfW, draw.width, line2.rtl);
    const dy = shift(line2.cy, halfH, draw.height, false);
    if (dx === 0 && dy === 0) return;
    const c = Math.cos(radians);
    const sn = Math.sin(radians);
    draw.ctx.translate(dx * c + dy * sn, dy * c - dx * sn);
  }
  async function drawLine(draw, block, line2, nextLine, settings, backgroundOnly = false, skipBackground = false) {
    const geometry = line2.geometry;
    if (!geometry || geometry.w <= 0 || geometry.h <= 0) return;
    const { ctx, width, height, fontFamily, fontWeight } = draw;
    const flat = settings.fillColor || argbToCss(line2.bgColor);
    const boxW = geometry.w * width;
    const boxH = geometry.h * height;
    const cx = geometry.cx * width;
    const cy = geometry.cy * height;
    const patch = settings.drawBackground && !skipBackground ? line2.background : null;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(geometry.angle * DEG);
    if (patch) {
      const padW = patch.hPad * boxH * settings.patchPadding;
      const padH = patch.vPad * boxH * settings.patchPadding;
      try {
        const bitmap = await createImageBitmap(new Blob([patch.bytes], { type: "image/webp" }));
        ctx.drawImage(bitmap, -(boxW + padW) / 2, -(boxH + padH) / 2, boxW + padW, boxH + padH);
        bitmap.close();
      } catch {
        ctx.fillStyle = flat;
        ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
      }
    } else if (settings.drawBackground && !skipBackground) {
      ctx.fillStyle = flat;
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
    }
    const text2 = backgroundOnly ? "" : buildLineText(block.translation, line2, nextLine);
    if (text2.trim()) {
      const vertical = shouldStayVertical(block, settings.verticalText);
      const fitted = fitFontSize(
        text2,
        vertical ? boxH : boxW,
        vertical ? boxW : boxH,
        fontFamily,
        draw.maxFontPx,
        fontWeight
      );
      const size = Math.max(fitted, draw.minFontPx);
      ctx.font = fontOf(size, fontFamily, fontWeight);
      ctx.direction = isRtl(block) ? "rtl" : "ltr";
      const fill = settings.textColor || argbToCss(line2.textColor);
      const outline = patch ? Math.max(1, Math.round(size * OUTLINE_RATIO * settings.outlineScale)) : 0;
      const outlineColor = patch ? settings.outlineColor || argbToCss(line2.bgColor) : null;
      const enlarged = size > fitted;
      const advance = ctx.measureText(text2).width;
      const drawW = enlarged ? Math.min(Math.max(boxW, advance + size * 0.4), width) : boxW;
      const drawH = enlarged ? Math.min(Math.max(boxH, size * 1.35), height) : boxH;
      nudgeInside(draw, { w: drawW, h: drawH }, { cx, cy, angle: geometry.angle, rtl: isRtl(block) });
      if (enlarged && settings.drawBackground && !skipBackground) {
        ctx.fillStyle = flat;
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
  async function renderToBlob(source, naturalWidth, naturalHeight, blocks, settings, displayedWidth = naturalWidth, edits) {
    const scale = Math.min(
      Math.max(1, Math.round(settings.supersample)),
      Math.max(1, Math.floor(settings.maxCanvasSide / Math.max(naturalWidth, naturalHeight)))
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
    const floorCssPx = settings.mangaMode ? Math.max(settings.minReadablePx, settings.mangaMinPx) : settings.minReadablePx;
    const draw = {
      ctx,
      width,
      height,
      fontFamily,
      fontWeight: settings.fontWeight,
      minFontPx: floorCssPx > 0 ? floorCssPx * canvasPerCssPx : 0,
      maxFontPx: MAX_FONT_SIZE * scale
    };
    const boxes = blocks.map(
      (block) => block.geometry ? rectOf(block.geometry, width, height) : null
    );
    const growth = settings.mangaMode ? Math.max(1, settings.mangaBoxGrowth) : 1;
    const mode = reflowMode(settings.reflowHorizontal);
    const base = settings;
    for (const [index, answered2] of blocks.entries()) {
      const edit = edits?.[index];
      if (edit?.original) continue;
      const block = edit?.text !== void 0 ? { ...answered2, translation: edit.text } : answered2;
      const settings2 = edit?.color || edit?.outline ? { ...base, textColor: edit.color || base.textColor, outlineColor: edit.outline || base.outlineColor } : base;
      const reset = resets(edit) && Boolean(block.geometry);
      const vertical = block.writingDirection === 2;
      const stayVertical = !settings2.mangaMode && shouldStayVertical(block, settings2.verticalText);
      const hull = settings2.drawBackground && (settings2.eraseMode === "hull" || settings2.mangaMode);
      if (hull) eraseTextArea(draw, block, settings2);
      if (edit?.hidden) {
        if (!hull) {
          for (const line2 of block.lines) await drawLine(draw, block, line2, void 0, settings2, true);
        }
        continue;
      }
      let reflow = reset || Boolean(block.geometry) && !stayVertical && (vertical || mode === "on");
      let bubble = settings2.mangaMode;
      const own = boxes[index];
      const lineRects = block.lines.flatMap(
        (line2) => line2.geometry ? [rectOf(line2.geometry, width, height)] : []
      );
      if (!reflow && !vertical && mode === "auto" && own && lineRects.length >= 2 && draw.minFontPx > 0) {
        const fitted = [];
        const rects = [];
        for (const [i, line2] of block.lines.entries()) {
          if (!line2.geometry) continue;
          const text2 = buildLineText(block.translation, line2, block.lines[i + 1]);
          rects.push(rectOf(line2.geometry, width, height));
          fitted.push(
            text2.trim() ? fitFontSize(
              text2,
              line2.geometry.w * width,
              line2.geometry.h * height,
              fontFamily,
              draw.maxFontPx,
              settings2.fontWeight
            ) : draw.minFontPx
          );
        }
        if (isBubbleColumn(lineRects, own, settings2.mangaMode ? 2 : void 0)) {
          reflow = bubble = crowdsAtFloor(fitted, draw.minFontPx);
        } else if (collidesAtFloor(rects, fitted, draw.minFontPx)) {
          reflow = true;
        }
      }
      for (let i = 0; i < block.lines.length; i += 1) {
        const line2 = block.lines[i];
        if (!line2) continue;
        if (reflow) {
          if (!hull) await drawLine(draw, block, line2, block.lines[i + 1], settings2, true);
        } else await drawLine(draw, block, line2, block.lines[i + 1], settings2, false, hull);
      }
      const shifted = reset && own && (edit?.scale !== void 0 || edit?.dx || edit?.dy);
      if (shifted && own) {
        const cx = (own.left + own.right) / 2;
        const cy = (own.top + own.bottom) / 2;
        const scaleBy = edit?.scale ?? 1;
        ctx.save();
        ctx.translate(cx + (edit?.dx ?? 0) * width, cy + (edit?.dy ?? 0) * height);
        ctx.scale(scaleBy, scaleBy);
        ctx.translate(-cx, -cy);
      }
      if (reflow && own && block.geometry) {
        const others = boxes.filter((rect2, at) => rect2 !== null && at !== index);
        let shaped = false;
        if (settings2.bubbleShape) {
          const angle = block.geometry.angle;
          const found = Math.abs(angle) <= UPRIGHT ? findBubble(source, scale, width, height, own, lineRects, others) : null;
          if (found) {
            const shape = maskShape(found.mask, found.x, found.y, found.scaleX, found.scaleY);
            shaped = drawShapedParagraph(draw, block, settings2, shape, { x: 0, y: 0, angle: 0 });
          } else if (bubble) {
            const room = roomFor(own, others, Math.max(growth, Math.SQRT2), width, height);
            const box = fitInside(
              {
                cx: (room.left + room.right) / 2,
                cy: (room.top + room.bottom) / 2,
                w: room.right - room.left,
                h: room.bottom - room.top,
                angle
              },
              width,
              height
            );
            shaped = drawShapedParagraph(
              draw,
              block,
              settings2,
              ellipseShape(0, 0, box.w / 2, box.h / 2),
              { x: box.cx, y: box.cy, angle }
            );
          }
        }
        if (!shaped) {
          drawReflowedParagraph(draw, block, settings2, roomFor(own, others, growth, width, height));
        }
      }
      if (shifted) ctx.restore();
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
    const rect2 = paintRect(spec, area, natural);
    if (!rect2 || tilesVisibly(spec, rect2, area)) return false;
    const x = origin.left + rect2.x;
    const y = origin.top + rect2.y;
    const clip = inset(style, spec.clip);
    const cut = {
      top: Math.max(0, clip.top - y),
      right: Math.max(0, x + rect2.width - (width - clip.right)),
      bottom: Math.max(0, y + rect2.height - (height - clip.bottom)),
      left: Math.max(0, clip.left - x)
    };
    if (cut.left + cut.right >= rect2.width || cut.top + cut.bottom >= rect2.height) return false;
    target.style.left = `${img.offsetLeft + x}px`;
    target.style.top = `${img.offsetTop + y}px`;
    target.style.width = `${rect2.width}px`;
    target.style.height = `${rect2.height}px`;
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
        ...options.opacity !== void 0 && options.opacity < 1 ? [`opacity: ${options.opacity}`] : [],
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
  const STATE_KEY = "lens-translate:state";
  const EMPTY = { lastAction: "", lastQuestion: "" };
  let cache = null;
  function getState() {
    if (cache) return cache;
    cache = { ...EMPTY };
    try {
      const raw = readStored(STATE_KEY);
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object") {
        const held = parsed;
        if (typeof held["lastAction"] === "string") cache.lastAction = held["lastAction"];
        if (typeof held["lastQuestion"] === "string") cache.lastQuestion = held["lastQuestion"];
      }
    } catch {
    }
    return cache;
  }
  function reloadState() {
    cache = null;
  }
  function setState(patch) {
    const next = { ...getState(), ...patch };
    if (next.lastAction === cache?.lastAction && next.lastQuestion === cache?.lastQuestion) return;
    cache = next;
    writeStored(STATE_KEY, next);
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
  const siteRules = () => ({ ...load() });
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
    edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
    pulse: "M22 12h-4l-3 9L9 3l-3 9H2",
    layers: "m12 2 10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5",
    close: "M18 6 6 18M6 6l12 12",
    send: "m5 12 7-7 7 7M12 19V5",
    external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
    images: "M18 22H4a2 2 0 0 1-2-2V6M8 2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM22 13l-3-3-7 7",
    loader: "M21 12a9 9 0 1 1-6.2-8.6",
    up: "m18 15-6-6-6 6",
    down: "m6 9 6 6 6-6",
    grip: "M9 5.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM15 5.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM9 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM15 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM9 17.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zM15 17.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z"
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
  function insetRect(rect2, edges) {
    return {
      left: rect2.left + edges.left,
      top: rect2.top + edges.top,
      width: Math.max(0, rect2.width - edges.left - edges.right),
      height: Math.max(0, rect2.height - edges.top - edges.bottom)
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
      for (const line2 of paragraph.lines) {
        const words = line2.words.filter((word) => word.text);
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
        } else if (line2.geometry && line2.text) {
          out.push({ text: line2.text, separator: " ", geometry: line2.geometry });
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
  function wrapWidth(widths, gap, max) {
    let widest = 0;
    let line2 = 0;
    for (const width of widths) {
      if (!(width > 0)) continue;
      const next = line2 === 0 ? width : line2 + gap + width;
      if (line2 > 0 && next > max) {
        widest = Math.max(widest, line2);
        line2 = width;
      } else line2 = next;
    }
    return Math.max(widest, line2);
  }
  function placeRow(corner, anchor, row2, view, margin, inset2) {
    const onLeft = corner === "tl" || corner === "bl";
    const onBottom = corner === "br" || corner === "bl";
    const x = onLeft ? anchor.left + inset2 : anchor.left + anchor.width - inset2 - row2.width;
    const y = onBottom ? anchor.top + anchor.height - inset2 - row2.height : anchor.top + inset2;
    const clamp2 = (value, start2, room, size, keepEnd) => {
      const low = start2 + margin;
      const high = start2 + room - margin - size;
      if (high < low) return keepEnd ? high : low;
      return Math.min(high, Math.max(low, value));
    };
    return {
      x: clamp2(x, view.left, view.width, row2.width, !onLeft),
      y: clamp2(y, view.top, view.height, row2.height, onBottom)
    };
  }
  const styles = "/* Lives inside a shadow root, so these selectors compete with nothing. The\n   :host is a fixed, click-through, full-viewport layer; everything here is\n   positioned in viewport coordinates.\n\n   The look is shadcn/ui's: zinc neutrals named by role, one radius, hairline\n   borders, a ring on focus. Only the look - there is no framework behind it,\n   because this stylesheet is parsed on every page the script runs on. */\n\n:host {\n  --background: #ffffff;\n  --foreground: #09090b;\n  --muted: #f4f4f5;\n  --muted-foreground: #71717a;\n  --accent: #f4f4f5;\n  --border: #e4e4e7;\n  --input: #d4d4d8;\n  --ring: #a1a1aa;\n  --primary: #18181b;\n  --primary-foreground: #fafafa;\n  --destructive: #dc2626;\n  --success: #059669;\n  --shadow: 0 10px 30px -8px rgba(9, 9, 11, 0.28), 0 2px 6px -2px rgba(9, 9, 11, 0.12);\n  /* 0.5rem, written in pixels: inside a shadow root `rem` is still the page's\n     root font size, and a site that sets that to 10px would shrink every\n     corner and control here with it. */\n  --radius: 8px;\n  /* What the keyboard covers; ui/root.ts keeps it current where it can. */\n  --lt-kb: 0px;\n  /* A hundredth of the viewport, by the best unit this browser has. `svh` is\n     the height with the address bar showing, so a sheet sized by it does not\n     jump when the bar slides away; `dvh` follows the bar. */\n  --lt-svh: 1vh;\n  --lt-dvh: 1vh;\n  /* The backgrounds of our popups, and only those: the menu, the panels, the\n     messages and a tool's bar. ui/root.ts sets --lt-opacity on the host from\n     the \"Popup opacity\" setting. Text and icons are drawn in --foreground and\n     friends, which are never touched, so the words stay solid while what is\n     behind them shows through. Without color-mix the surfaces simply stay\n     opaque: a custom property that fails to compute does not fall back to an\n     earlier declaration, it makes the background transparent, so the mix is\n     only declared where it is known to parse - and only while the setting is\n     below 100, so a fully opaque popup is the plain colour it always was. */\n  --lt-opacity: 100%;\n  --surface: var(--background);\n  --surface-muted: var(--muted);\n\n  font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;\n  color: var(--foreground);\n}\n@supports (background: color-mix(in srgb, red 50%, transparent)) {\n  :host([data-translucent]) {\n    --surface: color-mix(in srgb, var(--background) var(--lt-opacity), transparent);\n    --surface-muted: color-mix(in srgb, var(--muted) var(--lt-opacity), transparent);\n  }\n}\n/* A see-through popup over a photograph is a popup over noise, and the blur is\n   what turns the noise back into a tint. Only while it is see-through: a\n   backdrop filter costs a compositing pass under every surface that has one. */\n:host([data-translucent]) .lt-menu,\n:host([data-translucent]) .lt-panel,\n:host([data-translucent]) #lt-toast,\n:host([data-translucent]) .lt-bar {\n  -webkit-backdrop-filter: blur(14px) saturate(1.3);\n  backdrop-filter: blur(14px) saturate(1.3);\n}\n@supports (height: 1dvh) {\n  :host {\n    --lt-svh: 1svh;\n    --lt-dvh: 1dvh;\n  }\n}\n/* Dark by the system unless the setting says light, or dark by the setting:\n   ui/root.ts writes data-theme only for a choice that is not 'auto'. */\n@media (prefers-color-scheme: dark) {\n  :host(:not([data-theme='light'])) {\n    --background: #09090b;\n    --foreground: #fafafa;\n    --muted: #27272a;\n    --muted-foreground: #a1a1aa;\n    --accent: #27272a;\n    --border: #27272a;\n    --input: #3f3f46;\n    --ring: #71717a;\n    --primary: #fafafa;\n    --primary-foreground: #18181b;\n    --destructive: #ef4444;\n    --success: #10b981;\n    --shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.7), 0 2px 6px -2px rgba(0, 0, 0, 0.5);\n  }\n}\n:host([data-theme='dark']) {\n  --background: #09090b;\n  --foreground: #fafafa;\n  --muted: #27272a;\n  --muted-foreground: #a1a1aa;\n  --accent: #27272a;\n  --border: #27272a;\n  --input: #3f3f46;\n  --ring: #71717a;\n  --primary: #fafafa;\n  --primary-foreground: #18181b;\n  --destructive: #ef4444;\n  --success: #10b981;\n  --shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.7), 0 2px 6px -2px rgba(0, 0, 0, 0.5);\n}\n/* A tint replaces only the primary colour and the focus ring, so it reads the\n   same on either theme. After the theme rules, which have the same\n   specificity. The main button over a picture takes it too: that is where a\n   colour is most often looked for. */\n:host([data-accent='blue']) {\n  --primary: #2563eb;\n  --primary-foreground: #ffffff;\n  --ring: #60a5fa;\n}\n:host([data-accent='violet']) {\n  --primary: #7c3aed;\n  --primary-foreground: #ffffff;\n  --ring: #a78bfa;\n}\n:host([data-accent='green']) {\n  --primary: #15803d;\n  --primary-foreground: #ffffff;\n  --ring: #4ade80;\n}\n:host([data-accent='orange']) {\n  --primary: #c2410c;\n  --primary-foreground: #ffffff;\n  --ring: #fb923c;\n}\n:host([data-accent='rose']) {\n  --primary: #e11d48;\n  --primary-foreground: #ffffff;\n  --ring: #fb7185;\n}\n\n*,\n*::before,\n*::after {\n  box-sizing: border-box;\n}\n\n.lt-icon {\n  display: block;\n  flex: none;\n  width: 18px;\n}\n.lt-icon-loader {\n  animation: lt-spin 0.9s linear infinite;\n}\n@keyframes lt-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n/* ------------------------------------------------------------- controls */\n\n/* Hung from a corner of the picture by its own matching corner, so the row\n   can be any size: main.ts measures it, sets its width and puts its top-left\n   where that corner lands - moved back onto the screen if it would leave it.\n   The controls are listed corner-first; a right-hand corner reverses them, so\n   the first - the main one - is the one in the corner whichever side that is.\n   A row wider than the screen wraps, and for a bottom corner the lines stack\n   upwards so the main control's line is still the one at the corner. */\n#lt-controls {\n  --lt-ctl: 32px;\n  --lt-idle: 1;\n  position: absolute;\n  z-index: 1;\n  display: flex;\n  flex-direction: row-reverse;\n  flex-wrap: wrap;\n  gap: 4px;\n  pointer-events: none;\n}\n#lt-controls[data-corner='br'] {\n  flex-wrap: wrap-reverse;\n}\n#lt-controls[data-corner='tl'] {\n  flex-direction: row;\n}\n#lt-controls[data-corner='bl'] {\n  flex-direction: row;\n  flex-wrap: wrap-reverse;\n}\n#lt-controls[data-size='s'] {\n  --lt-ctl: 28px;\n}\n#lt-controls[data-size='l'] {\n  --lt-ctl: 40px;\n}\n.lt-ctl {\n  flex: none;\n  width: var(--lt-ctl);\n  height: var(--lt-ctl);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  /* These sit on somebody's photograph, not on a surface of ours, so they do\n     not follow the theme: dark glass reads on any picture. */\n  background: rgba(9, 9, 11, 0.72);\n  color: #fafafa;\n  border: 1px solid rgba(255, 255, 255, 0.18);\n  border-radius: var(--radius);\n  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);\n  -webkit-backdrop-filter: blur(6px);\n  backdrop-filter: blur(6px);\n  opacity: 0;\n  transform: scale(0.92);\n  pointer-events: none;\n  cursor: pointer;\n  transition: opacity 0.15s, transform 0.15s, background 0.15s;\n  -webkit-tap-highlight-color: transparent;\n}\n/* With its name beside the icon a control is as wide as the name. */\n.lt-ctl.lt-labelled {\n  width: auto;\n  padding: 0 10px 0 8px;\n  font-size: 13px;\n  font-weight: 500;\n  white-space: nowrap;\n}\n#lt-controls.lt-on .lt-main,\n/* A beat after the main button, so a passing cursor does not summon the row. */\n#lt-controls.lt-on.lt-extras .lt-ctl {\n  opacity: var(--lt-idle);\n  transform: none;\n  pointer-events: auto;\n}\n/* Dimmed until pointed at, when that was asked for; solid under the cursor. */\n#lt-controls.lt-on:hover .lt-main,\n#lt-controls.lt-on.lt-extras:hover .lt-ctl {\n  opacity: 1;\n}\n.lt-ctl:hover {\n  background: rgba(9, 9, 11, 0.92);\n}\n/* Held down, and on a touch screen a long press: the browser must not take\n   either for a scroll or a text selection. */\n.lt-main {\n  touch-action: none;\n  -webkit-user-select: none;\n  user-select: none;\n  -webkit-touch-callout: none;\n}\n/* Held down to look at the original: the button says so with a ring. */\n.lt-main.lt-peeking {\n  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.6);\n}\n.lt-main .lt-icon-loader,\n.lt-main.lt-busy .lt-icon:not(.lt-icon-loader) {\n  display: none;\n}\n.lt-main.lt-busy .lt-icon-loader {\n  display: block;\n}\n.lt-ctl.lt-active {\n  background: var(--success);\n  border-color: transparent;\n}\n.lt-main.lt-error {\n  background: var(--destructive);\n  border-color: transparent;\n}\n\n/* -------------------------------------------------------- buttons, fields */\n\n.lt-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  height: 36px;\n  padding: 0 14px;\n  font: inherit;\n  font-weight: 500;\n  white-space: nowrap;\n  text-decoration: none;\n  color: var(--foreground);\n  background: var(--background);\n  border: 1px solid var(--border);\n  border-radius: calc(var(--radius) - 2px);\n  box-shadow: 0 1px 2px rgba(9, 9, 11, 0.05);\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n.lt-btn:hover {\n  background: var(--accent);\n}\n.lt-btn.lt-primary {\n  color: var(--primary-foreground);\n  background: var(--primary);\n  border-color: transparent;\n}\n.lt-btn.lt-primary:hover {\n  opacity: 0.9;\n}\n.lt-btn.lt-ghost {\n  border-color: transparent;\n  box-shadow: none;\n  background: transparent;\n}\n.lt-btn.lt-ghost:hover {\n  background: var(--accent);\n}\n.lt-btn.lt-square {\n  width: 36px;\n  padding: 0;\n  flex: none;\n}\n.lt-btn:disabled {\n  opacity: 0.5;\n  pointer-events: none;\n}\n.lt-btn.lt-small {\n  height: 28px;\n  padding: 0 10px;\n  font-size: 12px;\n}\n.lt-btn[hidden],\n.lt-reset[hidden] {\n  display: none;\n}\n.lt-btn:focus-visible,\n.lt-x:focus-visible,\n.lt-tab:focus-visible,\n.lt-reset:focus-visible,\n.lt-dot:focus-visible {\n  outline: 2px solid var(--ring);\n  outline-offset: 2px;\n}\n\n.lt-input {\n  height: 36px;\n  min-width: 0;\n  width: 100%;\n  padding: 0 12px;\n  font: inherit;\n  color: var(--foreground);\n  background: var(--background);\n  border: 1px solid var(--input);\n  border-radius: calc(var(--radius) - 2px);\n  box-shadow: 0 1px 2px rgba(9, 9, 11, 0.05);\n}\n.lt-input::placeholder {\n  color: var(--muted-foreground);\n}\n.lt-input:focus-visible {\n  outline: 2px solid var(--ring);\n  outline-offset: 1px;\n}\n/* A checkbox is a switch. The knob is a gradient, not a pseudo-element: an\n   input has no ::before in every engine, and a background it always has. */\n.lt-input[type='checkbox'] {\n  -webkit-appearance: none;\n  appearance: none;\n  flex: none;\n  justify-self: end;\n  width: 36px;\n  height: 20px;\n  margin: 0;\n  padding: 0;\n  border: 0;\n  border-radius: 999px;\n  box-shadow: none;\n  cursor: pointer;\n  background-color: var(--input);\n  background-image: radial-gradient(circle at 10px 50%, #fff 0 7px, transparent 7.5px);\n  transition: background-color 0.15s;\n}\n.lt-input[type='checkbox']:checked {\n  background-color: var(--primary);\n  background-image: radial-gradient(circle at calc(100% - 10px) 50%, var(--primary-foreground) 0 7px, transparent 7.5px);\n}\n.lt-input[type='checkbox']:focus-visible {\n  outline: 2px solid var(--ring);\n  outline-offset: 2px;\n}\n\n/* ----------------------------------------------------------------- menu */\n\n.lt-menu {\n  position: absolute;\n  z-index: 4;\n  width: 260px;\n  padding: 4px;\n  display: flex;\n  flex-direction: column;\n  color: var(--foreground);\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  box-shadow: var(--shadow);\n  pointer-events: auto;\n}\n.lt-menu-item {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  width: 100%;\n  min-height: 36px;\n  padding: 6px 10px;\n  font: inherit;\n  text-align: left;\n  color: inherit;\n  background: transparent;\n  border: 0;\n  border-radius: calc(var(--radius) - 4px);\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n.lt-menu-item .lt-icon {\n  color: var(--muted-foreground);\n}\n/* The item the keyboard is on is highlighted like the one the cursor is on,\n   not ringed: the first item is focused when the menu opens, and a ring there\n   reads as a selection nobody made. */\n.lt-menu-item:hover:not(:disabled),\n.lt-menu-item:focus-visible {\n  background: var(--accent);\n  outline: none;\n}\n.lt-menu-item:disabled {\n  color: var(--muted-foreground);\n  opacity: 0.6;\n  cursor: default;\n}\n.lt-menu-rule {\n  height: 1px;\n  margin: 4px -4px;\n  background: var(--border);\n}\n/* The item and the field under it are one thing to ask. */\n.lt-field-row {\n  display: flex;\n  gap: 6px;\n  padding: 2px 6px 6px 38px;\n}\n\n/* A sheet has to sit on something that takes the press meant to dismiss it. */\n.lt-scrim {\n  position: absolute;\n  inset: 0;\n  z-index: 4;\n  background: rgba(9, 9, 11, 0.5);\n  pointer-events: auto;\n}\n.lt-menu.lt-sheet {\n  left: 0;\n  right: 0;\n  bottom: var(--lt-kb);\n  width: auto;\n  max-width: 560px;\n  margin: 0 auto;\n  max-height: calc(var(--lt-svh) * 100 - var(--lt-kb) - 24px);\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  padding: 8px max(8px, env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px))\n    max(8px, env(safe-area-inset-left, 0px));\n  border-width: 1px 0 0;\n  border-radius: 14px 14px 0 0;\n}\n/* The handle a sheet is expected to have; it says \"this slides\", nothing more. */\n.lt-menu.lt-sheet::before {\n  content: '';\n  flex: none;\n  align-self: center;\n  width: 40px;\n  height: 4px;\n  margin: 0 0 6px;\n  border-radius: 2px;\n  background: var(--input);\n}\n.lt-sheet .lt-menu-item {\n  min-height: 48px;\n  padding: 8px 12px;\n  gap: 14px;\n  font-size: 16px;\n}\n.lt-sheet .lt-menu-item .lt-icon {\n  width: 20px;\n  height: 20px;\n}\n.lt-sheet .lt-field-row {\n  padding: 2px 8px 8px 46px;\n}\n.lt-sheet .lt-menu-rule {\n  margin: 4px 0;\n}\n\n/* ---------------------------------------------------------------- toast */\n\n#lt-toast {\n  position: absolute;\n  z-index: 6;\n  left: 50%;\n  bottom: calc(16px + var(--lt-kb) + env(safe-area-inset-bottom, 0px));\n  transform: translateX(-50%);\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  max-width: min(520px, calc(100% - 24px));\n  padding: 10px 14px;\n  font-size: 13px;\n  color: var(--foreground);\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  box-shadow: var(--shadow);\n  pointer-events: none;\n  opacity: 0;\n  visibility: hidden;\n  transition: opacity 0.2s, visibility 0.2s;\n}\n#lt-toast.lt-show {\n  opacity: 1;\n  visibility: visible;\n}\n/* A message with a link in it is something to press. */\n#lt-toast.lt-show.lt-has-link {\n  pointer-events: auto;\n  padding: 8px 8px 8px 14px;\n}\n#lt-toast > span {\n  flex: 1;\n  min-width: 0;\n}\n/* An address shown because it could not be opened: one line, cut short, and\n   selectable for a host where copying is out of reach too. */\n.lt-url {\n  display: block;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  color: var(--muted-foreground);\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 11px;\n  user-select: text;\n  -webkit-user-select: text;\n}\n/* While a tool's bar has the bottom of the screen, messages go to the top. */\n:host([data-tool]) #lt-toast {\n  bottom: auto;\n  top: calc(12px + env(safe-area-inset-top, 0px));\n}\n\n/* --------------------------------------------------------------- panels */\n\n.lt-panel-backdrop {\n  position: absolute;\n  inset: 0;\n  z-index: 5;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(9, 9, 11, 0.5);\n  pointer-events: auto;\n}\n.lt-panel {\n  width: min(560px, 92vw);\n  max-height: calc(var(--lt-dvh) * 86);\n  display: flex;\n  flex-direction: column;\n  color: var(--foreground);\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: calc(var(--radius) + 4px);\n  box-shadow: var(--shadow);\n  overflow: hidden;\n}\n.lt-panel-head,\n.lt-panel-foot {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 12px 18px;\n  flex: none;\n}\n.lt-panel-head {\n  border-bottom: 1px solid var(--border);\n  justify-content: space-between;\n  font-size: 15px;\n  font-weight: 600;\n  padding-right: 10px;\n}\n.lt-panel-foot {\n  border-top: 1px solid var(--border);\n}\n.lt-spacer {\n  flex: 1;\n}\n.lt-panel-body {\n  padding: 8px 18px 16px;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n}\n.lt-x {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 32px;\n  height: 32px;\n  padding: 0;\n  color: var(--muted-foreground);\n  background: transparent;\n  border: 0;\n  border-radius: calc(var(--radius) - 2px);\n  cursor: pointer;\n}\n.lt-x:hover {\n  color: var(--foreground);\n  background: var(--accent);\n}\n\n/* ------------------------------------------------------ settings window */\n\n/* A header, the tabs, the fields and a footer. The tabs are a strip along the\n   top by default - which is what a phone and a narrow window get - and become\n   a rail down the left side where there is room for one (see below). */\n.lt-settings-main {\n  flex: 1;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n}\n.lt-settings .lt-panel-head {\n  gap: 12px;\n}\n.lt-settings .lt-panel-head strong {\n  flex: none;\n}\n.lt-search {\n  flex: 1;\n  max-width: 320px;\n  margin-left: auto;\n}\n.lt-search[hidden] {\n  display: none;\n}\n.lt-tabs {\n  flex: none;\n  display: flex;\n  gap: 4px;\n  padding: 8px 14px;\n  overflow-x: auto;\n  overscroll-behavior: contain;\n  border-bottom: 1px solid var(--border);\n  /* The strip scrolls under a finger; a bar across it would only be noise. */\n  scrollbar-width: none;\n}\n.lt-tabs::-webkit-scrollbar {\n  display: none;\n}\n.lt-tab {\n  flex: none;\n  display: flex;\n  align-items: center;\n  height: 32px;\n  padding: 0 12px;\n  font: inherit;\n  font-weight: 500;\n  white-space: nowrap;\n  color: var(--muted-foreground);\n  background: transparent;\n  border: 0;\n  border-radius: calc(var(--radius) - 2px);\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n.lt-tab:hover {\n  color: var(--foreground);\n  background: var(--accent);\n}\n.lt-tab[aria-selected='true'] {\n  color: var(--foreground);\n  background: var(--surface-muted);\n}\n.lt-settings .lt-panel-body {\n  flex: 1;\n  min-height: 0;\n  padding-top: 4px;\n}\n.lt-pane[hidden],\n.lt-row[hidden],\n.lt-extra[hidden],\n.lt-note[hidden],\n.lt-guard[hidden] {\n  display: none;\n}\n.lt-pane-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  min-height: 28px;\n  margin: 10px 0 2px;\n}\n.lt-pane-head h3 {\n  margin: 0;\n  font-size: 15px;\n  font-weight: 600;\n}\n/* One tab at a time needs no heading over it: the tab says where you are.\n   Search results come from several, and each group says which. */\n.lt-settings:not(.lt-searching) .lt-pane-head h3 {\n  visibility: hidden;\n}\n/* ...and with nothing to reset there is nothing in it at all. */\n.lt-settings:not(.lt-searching) .lt-pane-head:not(:has(.lt-btn:not([hidden]))) {\n  min-height: 0;\n  height: 0;\n  margin: 0;\n  overflow: hidden;\n}\n.lt-grid {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  column-gap: 28px;\n}\n\n/* A field: its name, the control, and a line about what it does. Stacked, so\n   the control gets the full width of its column whatever the name's length. */\n.lt-row {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  align-content: start;\n  gap: 6px;\n  padding: 9px 0;\n}\n.lt-row.lt-row-check {\n  grid-template-columns: minmax(0, 1fr) auto;\n  align-items: center;\n}\n.lt-label {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-height: 20px;\n  font-weight: 500;\n}\n/* The name is a <label for> its control: pressing it focuses or toggles. */\n.lt-label-text {\n  cursor: pointer;\n}\n.lt-hint {\n  grid-column: 1 / -1;\n  color: var(--muted-foreground);\n  font-size: 12px;\n}\n/* Back to the default; only there when the value is not the default. */\n.lt-reset {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 20px;\n  height: 20px;\n  padding: 0;\n  color: var(--muted-foreground);\n  background: transparent;\n  border: 0;\n  border-radius: 4px;\n  cursor: pointer;\n}\n.lt-reset:hover {\n  color: var(--foreground);\n  background: var(--accent);\n}\n.lt-reset .lt-icon {\n  width: 14px;\n}\n.lt-guard {\n  font-size: 13px;\n  font-weight: 500;\n}\n\n.lt-color,\n.lt-chord-row {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n}\n.lt-swatch {\n  flex: none;\n  width: 36px;\n  height: 36px;\n  padding: 2px;\n  background: var(--background);\n  border: 1px solid var(--input);\n  border-radius: calc(var(--radius) - 2px);\n  cursor: pointer;\n}\n.lt-swatch.lt-unset {\n  opacity: 0.35;\n}\n.lt-chord {\n  flex: 1;\n  min-width: 0;\n  justify-content: flex-start;\n  font-variant-numeric: tabular-nums;\n}\n.lt-chord.lt-recording {\n  outline: 2px solid var(--ring);\n  outline-offset: 1px;\n  color: var(--muted-foreground);\n}\n\n/* The buttons over a picture, as a list to tick and to drag into order. */\n.lt-order,\n.lt-site-list {\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n.lt-order {\n  border: 1px solid var(--border);\n  border-radius: calc(var(--radius) - 2px);\n  overflow: hidden;\n}\n.lt-order-item,\n.lt-site {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-height: 40px;\n  padding: 2px 6px 2px 4px;\n  background: var(--background);\n}\n.lt-order-item + .lt-order-item,\n.lt-site + .lt-site {\n  border-top: 1px solid var(--border);\n}\n.lt-order-item.lt-dragging {\n  background: var(--accent);\n}\n/* The handle is the only part that drags, so the rest of the row still\n   scrolls the sheet under a finger. */\n.lt-grip {\n  flex: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 28px;\n  height: 36px;\n  color: var(--muted-foreground);\n  cursor: grab;\n  touch-action: none;\n}\n.lt-order-name {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.lt-order-name .lt-icon {\n  color: var(--muted-foreground);\n}\n.lt-order-moves {\n  display: flex;\n  flex: none;\n}\n.lt-order-moves .lt-btn {\n  width: 32px;\n  height: 32px;\n}\n.lt-site {\n  padding-left: 10px;\n}\n.lt-site-host {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  font-weight: 500;\n}\n.lt-site-rule {\n  color: var(--muted-foreground);\n  font-size: 12px;\n}\n\n.lt-version {\n  padding-top: 4px;\n  font-weight: 600;\n}\n.lt-link {\n  display: inline-flex;\n  align-items: center;\n  height: 32px;\n  color: var(--foreground);\n  text-underline-offset: 3px;\n}\n.lt-facts {\n  border-radius: calc(var(--radius) - 2px);\n  padding: 10px 12px;\n}\n\n/* Room for a rail: the tabs go down the left and short fields sit two to a\n   row. Only for a pointer that can aim - a wide tablet keeps the strip. */\n@media (min-width: 900px) and (pointer: fine) {\n  .lt-settings.lt-pro {\n    width: min(960px, 94vw);\n    height: min(720px, calc(var(--lt-dvh) * 88));\n    max-height: none;\n  }\n  .lt-pro .lt-settings-main {\n    flex-direction: row;\n  }\n  .lt-pro .lt-tabs {\n    flex-direction: column;\n    width: 196px;\n    padding: 12px 8px;\n    overflow-x: hidden;\n    overflow-y: auto;\n    border-bottom: 0;\n    border-right: 1px solid var(--border);\n  }\n  .lt-pro .lt-tab {\n    width: 100%;\n    height: 34px;\n  }\n  .lt-pro .lt-panel-body {\n    padding: 4px 24px 20px;\n  }\n  .lt-pro .lt-grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n  .lt-pro .lt-row-wide {\n    grid-column: 1 / -1;\n  }\n}\n\n/* Outline slider with its live sample. */\n.lt-slider {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-width: 0;\n}\n.lt-slider input[type='range'] {\n  flex: 1;\n  width: auto;\n  height: 24px;\n  padding: 0;\n  border: 0;\n  box-shadow: none;\n  background: transparent;\n  accent-color: var(--primary);\n}\n.lt-readout {\n  min-width: 42px;\n  text-align: right;\n  font-variant-numeric: tabular-nums;\n  color: var(--muted-foreground);\n}\n.lt-preview {\n  grid-column: 1 / -1;\n  width: 100%;\n  height: auto;\n  border-radius: calc(var(--radius) - 2px);\n  border: 1px solid var(--border);\n  margin-top: 6px;\n}\n\n/* The sample translation on the Appearance tab (ui/preview.ts). Stuck to the\n   top of the scrolling body so it is in view from whichever field is being\n   changed, and opaque whatever the popup opacity is: fields scroll under it. */\n.lt-live {\n  position: sticky;\n  top: 0;\n  z-index: 1;\n  margin: 2px 0 6px;\n  background: var(--background);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  /* The body's own padding is above it, and fields would show in that strip. */\n  box-shadow: 0 -6px 0 var(--background);\n}\n.lt-live[hidden] {\n  display: none;\n}\n.lt-live-head {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-height: 32px;\n  padding: 0 10px;\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--muted-foreground);\n  cursor: pointer;\n  list-style: none;\n  user-select: none;\n  -webkit-tap-highlight-color: transparent;\n}\n.lt-live-head::-webkit-details-marker {\n  display: none;\n}\n.lt-live-head:hover {\n  color: var(--foreground);\n}\n.lt-live-chevron {\n  display: flex;\n  transition: transform 0.15s ease;\n}\n.lt-live:not([open]) .lt-live-chevron {\n  transform: rotate(-90deg);\n}\n.lt-live-body {\n  display: flex;\n  align-items: center;\n  gap: 14px;\n  padding: 0 10px 10px;\n}\n/* Sized here and not by its bitmap, which changes with the render sharpness.\n   The height gives way as the window does - a phone with its keyboard up has\n   a body a few fields tall, and the sample may not be most of it. 210px is\n   roughly what the header, the tabs and the footer take. */\n.lt-live-canvas {\n  flex: none;\n  display: block;\n  height: clamp(56px, calc((var(--lt-svh) * 100 - var(--lt-kb) - 210px) * 0.3), 176px);\n  width: auto;\n  max-width: 100%;\n  aspect-ratio: 20 / 11;\n  border-radius: calc(var(--radius) - 2px);\n  border: 1px solid var(--border);\n}\n.lt-live-note {\n  min-width: 0;\n  color: var(--muted-foreground);\n  font-size: 12px;\n}\n\n/* A choice that is about where something goes, with a picture of the chosen\n   value (ui/schematics.ts). Tones are classes so the theme colours them. */\n.lt-pick {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n}\n.lt-pick .lt-input {\n  flex: 1;\n}\n.lt-sch {\n  flex: none;\n  width: 54px;\n  height: 36px;\n  color: var(--foreground);\n  background: var(--background);\n  border: 1px solid var(--border);\n  border-radius: calc(var(--radius) - 2px);\n  fill: none;\n  stroke: none;\n  stroke-width: 1.5;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n}\n.lt-sch-dim {\n  stroke: var(--muted-foreground);\n  stroke-width: 1.25;\n}\n.lt-sch-ink {\n  stroke: currentColor;\n}\n.lt-sch-solid {\n  fill: currentColor;\n}\n.lt-sch-soft {\n  fill: var(--input);\n  stroke: var(--input);\n}\n.lt-sch text {\n  font: 600 11px system-ui, -apple-system, 'Segoe UI', sans-serif;\n  text-anchor: middle;\n}\n\n/* The General tab: what is true now, in a card; the interface as two cards. */\n.lt-card {\n  margin: 6px 0 8px;\n  padding: 2px 16px;\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n}\n.lt-card > * + * {\n  border-top: 1px solid var(--border);\n}\n.lt-card > .lt-row {\n  padding: 12px 0;\n}\n.lt-status > .lt-row:first-child .lt-label {\n  font-size: 15px;\n  font-weight: 600;\n}\n.lt-searching .lt-card {\n  padding: 0;\n  border: 0;\n}\n.lt-segmented {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: 3px;\n  padding: 3px;\n  background: var(--surface-muted);\n  border-radius: var(--radius);\n}\n.lt-seg {\n  height: 32px;\n  min-width: 0;\n  padding: 0 8px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font: inherit;\n  font-weight: 500;\n  color: var(--muted-foreground);\n  background: transparent;\n  border: 0;\n  border-radius: calc(var(--radius) - 2px);\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n.lt-seg:hover {\n  color: var(--foreground);\n}\n.lt-seg[aria-checked='true'] {\n  color: var(--foreground);\n  background: var(--background);\n  box-shadow: 0 1px 3px rgba(9, 9, 11, 0.12), 0 0 0 1px var(--border);\n}\n.lt-seg:focus-visible,\n.lt-mode:focus-visible {\n  outline: 2px solid var(--ring);\n  outline-offset: 2px;\n}\n.lt-modes {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 10px;\n}\n.lt-mode {\n  display: grid;\n  align-content: start;\n  gap: 6px;\n  min-width: 0;\n  padding: 12px 14px;\n  font: inherit;\n  text-align: start;\n  color: var(--foreground);\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n.lt-mode:hover {\n  background: var(--accent);\n}\n.lt-mode[aria-checked='true'] {\n  border-color: var(--primary);\n  box-shadow: 0 0 0 1px var(--primary);\n}\n.lt-mode-title {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-weight: 600;\n}\n.lt-mode-desc {\n  color: var(--muted-foreground);\n  font-size: 12px;\n  line-height: 1.4;\n}\n.lt-quick {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));\n  gap: 8px;\n  padding-top: 6px;\n}\n.lt-quick-btn {\n  justify-content: flex-start;\n  gap: 10px;\n  min-width: 0;\n}\n.lt-quick-btn > span:not(.lt-quick-meta) {\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.lt-quick-meta {\n  margin-inline-start: auto;\n  padding-inline-start: 8px;\n  color: var(--muted-foreground);\n  font-size: 12px;\n  font-weight: 400;\n}\n\n/* Section headings. */\n.lt-group {\n  margin: 18px 0 4px;\n  padding-bottom: 6px;\n  border-bottom: 1px solid var(--border);\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--muted-foreground);\n}\n.lt-group:first-child {\n  margin-top: 6px;\n}\n\n/* Menu commands, for a host that has no menu of its own. */\n.lt-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  padding: 6px 0 0;\n}\n.lt-note {\n  color: var(--muted-foreground);\n  font-size: 12px;\n  padding-top: 10px;\n}\n\n/* The diagnostics report: fixed width, so columns line up as written. */\n.lt-report {\n  margin: 0;\n  padding: 14px 18px;\n  overflow: auto;\n  white-space: pre-wrap;\n  word-break: break-word;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  font-size: 12px;\n  line-height: 1.5;\n  color: var(--foreground);\n  background: var(--surface-muted);\n  user-select: text;\n  -webkit-user-select: text;\n}\n\n/* ---------------------------------------------------------------- tools */\n\n/* The layer over a picture while an area, an object or words are being\n   chosen. It scrolls by default: a webtoon page is taller than the screen,\n   and a layer that swallowed every pan would strand the reader halfway down\n   it with only the close button for a way out. Only a gesture that has to be\n   a drag locks the page - see the region layer and the words. */\n.lt-tool {\n  position: absolute;\n  z-index: 2;\n  overflow: hidden;\n  background: rgba(9, 9, 11, 0.2);\n  outline: 2px solid rgba(255, 255, 255, 0.85);\n  outline-offset: -2px;\n  pointer-events: auto;\n  touch-action: pan-x pan-y;\n  -webkit-user-select: none;\n  user-select: none;\n  -webkit-touch-callout: none;\n}\n/* Dragging out a rectangle is the whole of this tool; without `none` the\n   finger scrolls the page instead. */\n.lt-tool-region {\n  cursor: crosshair;\n  touch-action: none;\n}\n/* The chosen area is the one part left undimmed; the shadow is the dimming,\n   clipped by the layer so it stops at the picture's edge. */\n.lt-sel {\n  position: absolute;\n  border: 2px solid #fff;\n  border-radius: 4px;\n  box-shadow: 0 0 0 9999px rgba(9, 9, 11, 0.45);\n  pointer-events: none;\n}\n.lt-sel[hidden] {\n  display: none;\n}\n\n/* A dot is 16px to look at and 44px to hit. */\n.lt-dot {\n  position: absolute;\n  width: 44px;\n  height: 44px;\n  margin: -22px 0 0 -22px;\n  padding: 0;\n  background: transparent;\n  border: 0;\n  border-radius: 50%;\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n.lt-dot::after {\n  content: '';\n  position: absolute;\n  inset: 14px;\n  border-radius: 50%;\n  background: #fff;\n  box-shadow: 0 0 0 3px rgba(9, 9, 11, 0.55), 0 1px 5px rgba(0, 0, 0, 0.6);\n  transition: transform 0.12s;\n}\n.lt-dot:hover::after,\n.lt-dot:focus-visible::after,\n.lt-dot:active::after {\n  transform: scale(1.3);\n}\n.lt-objbox {\n  position: absolute;\n  border: 2px solid #fff;\n  border-radius: 6px;\n  box-shadow: 0 0 0 1px rgba(9, 9, 11, 0.5);\n  opacity: 0;\n  pointer-events: none;\n  transition: opacity 0.12s;\n}\n.lt-dot:hover + .lt-objbox,\n.lt-dot:focus-visible + .lt-objbox,\n.lt-dot:active + .lt-objbox {\n  opacity: 1;\n}\n\n/* A stroke that starts on a word is a drag across words and must not pan; one\n   that starts between them scrolls. touch-action is read from where the touch\n   lands, intersected up the tree, and settled before any pointer event - so it\n   has to be on the word itself; setting it from a handler is too late. */\n.lt-word {\n  position: absolute;\n  border-radius: 3px;\n  background: rgba(255, 255, 255, 0.28);\n  box-shadow: 0 0 0 1px rgba(9, 9, 11, 0.45);\n  cursor: pointer;\n  touch-action: none;\n}\n.lt-word.lt-on {\n  background: rgba(56, 189, 248, 0.5);\n  box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgba(9, 9, 11, 0.6);\n}\n\n.lt-bar {\n  position: absolute;\n  z-index: 3;\n  left: 50%;\n  bottom: calc(16px + var(--lt-kb) + env(safe-area-inset-bottom, 0px));\n  transform: translateX(-50%);\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  width: max-content;\n  max-width: min(720px, calc(100% - 24px));\n  padding: 8px 8px 8px 14px;\n  color: var(--foreground);\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: calc(var(--radius) + 4px);\n  box-shadow: var(--shadow);\n  pointer-events: auto;\n}\n.lt-bar-text {\n  flex: 1 1 180px;\n  min-width: 0;\n  max-height: 2.9em;\n  overflow: hidden;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.lt-bar .lt-input {\n  flex: 1 1 200px;\n  width: auto;\n}\n.lt-bar-buttons {\n  display: flex;\n  gap: 6px;\n  margin-left: auto;\n}\n\n/* ------------------------------------------------ a thumb, not a cursor */\n\n/* The same question ui/menu.ts asks. Narrow, or touched: either way the\n   targets are 44px, the fields are 16px so iOS does not zoom into them, and\n   whatever opens does so from the bottom edge, where the thumb already is. */\n@media (max-width: 640px), (pointer: coarse) {\n  /* Never under 44px here, whatever size was chosen: small is a mouse's size. */\n  #lt-controls,\n  #lt-controls[data-size='s'] {\n    --lt-ctl: 44px;\n    gap: 6px;\n  }\n  #lt-controls[data-size='l'] {\n    --lt-ctl: 52px;\n  }\n  .lt-btn,\n  .lt-input {\n    height: 44px;\n  }\n  .lt-btn.lt-square,\n  .lt-x {\n    width: 44px;\n    height: 44px;\n  }\n  .lt-input {\n    font-size: 16px;\n  }\n  .lt-input[type='checkbox'] {\n    width: 44px;\n    height: 26px;\n    background-image: radial-gradient(circle at 13px 50%, #fff 0 10px, transparent 10.5px);\n  }\n  .lt-input[type='checkbox']:checked {\n    background-image: radial-gradient(circle at calc(100% - 13px) 50%, var(--primary-foreground) 0 10px, transparent 10.5px);\n  }\n  .lt-seg {\n    height: 40px;\n  }\n  .lt-slider input[type='range'] {\n    height: 44px;\n  }\n\n  .lt-panel-backdrop {\n    align-items: flex-end;\n  }\n  .lt-panel {\n    width: 100%;\n    max-width: 640px;\n    margin-bottom: var(--lt-kb);\n    max-height: calc(var(--lt-svh) * 100 - var(--lt-kb) - 24px);\n    border-width: 1px 0 0;\n    border-radius: 14px 14px 0 0;\n  }\n  .lt-panel-head,\n  .lt-panel-foot {\n    padding-left: max(14px, env(safe-area-inset-left, 0px));\n    padding-right: max(14px, env(safe-area-inset-right, 0px));\n  }\n  .lt-panel-head {\n    padding-right: max(6px, env(safe-area-inset-right, 0px));\n  }\n  .lt-panel-foot {\n    padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));\n  }\n  .lt-panel-body {\n    padding-left: max(14px, env(safe-area-inset-left, 0px));\n    padding-right: max(14px, env(safe-area-inset-right, 0px));\n  }\n  /* The settings sheet is as tall as it may be whatever tab is open, so\n     changing tab does not move the strip out from under the thumb. */\n  .lt-settings {\n    height: calc(var(--lt-svh) * 100 - var(--lt-kb) - 24px);\n  }\n  .lt-tabs {\n    padding-left: max(10px, env(safe-area-inset-left, 0px));\n    padding-right: max(10px, env(safe-area-inset-right, 0px));\n  }\n  .lt-tab {\n    height: 44px;\n    padding: 0 14px;\n  }\n  .lt-search {\n    max-width: none;\n  }\n  .lt-reset {\n    width: 32px;\n    height: 32px;\n  }\n  .lt-swatch {\n    width: 44px;\n    height: 44px;\n  }\n  .lt-sch {\n    width: 66px;\n    height: 44px;\n  }\n  /* The title says what it is; the sentence would cost the picture its room. */\n  .lt-live-head {\n    min-height: 40px;\n  }\n  .lt-live-body {\n    justify-content: center;\n  }\n  .lt-live-note {\n    display: none;\n  }\n  .lt-live-canvas {\n    height: clamp(48px, calc((var(--lt-svh) * 100 - var(--lt-kb) - 210px) * 0.3), 132px);\n  }\n  .lt-order-item {\n    min-height: 52px;\n  }\n  .lt-grip,\n  .lt-order-moves .lt-btn {\n    width: 40px;\n    height: 44px;\n  }\n  .lt-panel-foot {\n    flex-wrap: wrap;\n  }\n\n  .lt-bar {\n    left: max(8px, env(safe-area-inset-left, 0px));\n    right: max(8px, env(safe-area-inset-right, 0px));\n    bottom: calc(8px + var(--lt-kb) + env(safe-area-inset-bottom, 0px));\n    transform: none;\n    width: auto;\n    max-width: none;\n  }\n  .lt-bar .lt-input {\n    flex-basis: 100%;\n  }\n  #lt-toast {\n    left: max(8px, env(safe-area-inset-left, 0px));\n    right: max(8px, env(safe-area-inset-right, 0px));\n    transform: none;\n    max-width: none;\n    font-size: 14px;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .lt-ctl,\n  .lt-live-chevron,\n  #lt-toast,\n  .lt-dot::after,\n  .lt-objbox {\n    transition: none;\n  }\n}\n\n/* --------------------------------------------------------------- quick editor */\n\n.lt-panel.lt-editor {\n  width: min(1080px, 96vw);\n  max-width: none;\n}\n.lt-editor-body {\n  display: flex;\n  gap: 14px;\n  min-height: 0;\n  padding: 12px 18px;\n  overflow: auto;\n  overscroll-behavior: contain;\n}\n.lt-editor-stage {\n  flex: 1 1 auto;\n  min-width: 0;\n  display: flex;\n  align-items: flex-start;\n  justify-content: center;\n}\n.lt-editor-frame {\n  position: relative;\n  display: inline-block;\n  line-height: 0;\n  max-width: 100%;\n  border-radius: var(--radius);\n  overflow: hidden;\n  background: var(--muted);\n  /* A finger dragging a box must not scroll the sheet. */\n  touch-action: none;\n}\n.lt-editor-img {\n  display: block;\n  max-width: 100%;\n  max-height: calc(var(--lt-dvh) * 66);\n  width: auto;\n  height: auto;\n  min-width: 120px;\n  min-height: 80px;\n  user-select: none;\n  -webkit-user-select: none;\n  transition: opacity 0.15s;\n}\n.lt-editor-frame.lt-busy .lt-editor-img {\n  opacity: 0.75;\n}\n.lt-editor-box {\n  position: absolute;\n  margin: 0;\n  padding: 0;\n  min-width: 14px;\n  min-height: 14px;\n  border: 1.5px dashed rgba(255, 255, 255, 0.85);\n  border-radius: 4px;\n  outline: 1px solid rgba(0, 0, 0, 0.45);\n  background: transparent;\n  cursor: grab;\n  touch-action: none;\n}\n.lt-editor-box:hover {\n  background: rgba(59, 130, 246, 0.12);\n}\n.lt-editor-box.lt-edited {\n  border-style: solid;\n  border-color: rgba(250, 204, 21, 0.95);\n}\n.lt-editor-box.lt-off {\n  border-color: rgba(161, 161, 170, 0.9);\n}\n.lt-editor-box.lt-picked {\n  border: 2px solid #3b82f6;\n  background: rgba(59, 130, 246, 0.16);\n  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.7);\n}\n.lt-editor-box:active {\n  cursor: grabbing;\n}\n.lt-editor-box:focus-visible {\n  outline: 2px solid var(--ring);\n}\n.lt-editor-side {\n  flex: 0 0 280px;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  min-width: 0;\n}\n.lt-editor-hint {\n  margin: 0;\n}\n.lt-editor-fields {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n}\n.lt-editor-fields[hidden],\n.lt-editor-hint[hidden] {\n  display: none;\n}\n.lt-editor-field {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.lt-editor-field .lt-label {\n  display: flex;\n  justify-content: space-between;\n}\n.lt-editor-value {\n  color: var(--muted-foreground);\n  font-variant-numeric: tabular-nums;\n}\n.lt-editor-text {\n  min-height: 72px;\n  resize: vertical;\n  font: inherit;\n  line-height: 1.4;\n}\n.lt-editor-range {\n  width: 100%;\n  accent-color: var(--primary);\n}\n.lt-editor-colours {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 10px 16px;\n}\n.lt-editor-colour {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n.lt-editor-swatch {\n  width: 36px;\n  height: 28px;\n  padding: 0;\n  border: 1px solid var(--border);\n  border-radius: 6px;\n  background: transparent;\n  cursor: pointer;\n}\n.lt-editor-toggles {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n.lt-editor-toggles .lt-btn[aria-pressed='true'] {\n  color: var(--primary-foreground, #fff);\n  background: var(--primary);\n}\n.lt-editor-foot {\n  flex-wrap: wrap;\n}\n\n@media (max-width: 760px), (pointer: coarse) {\n  .lt-panel.lt-editor {\n    width: 100%;\n  }\n  .lt-editor-body {\n    flex-direction: column;\n    padding-left: max(14px, env(safe-area-inset-left, 0px));\n    padding-right: max(14px, env(safe-area-inset-right, 0px));\n  }\n  .lt-editor-side {\n    flex: none;\n  }\n  .lt-editor-img {\n    max-height: calc(var(--lt-svh) * 46 - var(--lt-kb));\n  }\n  .lt-editor-swatch {\n    width: 44px;\n    height: 36px;\n  }\n  .lt-editor-toggles .lt-btn,\n  .lt-editor-foot .lt-btn {\n    min-height: 40px;\n  }\n  /* Two rows: what to do with the picture, then the way out, on the right\n     where the thumb is - not wherever the wrap happens to leave Apply. */\n  .lt-editor-foot .lt-spacer {\n    flex-basis: 100%;\n    height: 0;\n  }\n  .lt-editor-foot .lt-spacer + .lt-btn {\n    margin-left: auto;\n  }\n}\n\n/* The tint swatches in General. Their colours are the tints themselves, not\n   the theme's, so each says what it will do before it is chosen. */\n.lt-swatches {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  padding: 2px 0;\n}\n.lt-swatch {\n  --lt-tint: #18181b;\n  width: 28px;\n  height: 28px;\n  padding: 0;\n  background: var(--lt-tint);\n  border: 2px solid var(--background);\n  border-radius: 50%;\n  box-shadow: 0 0 0 1px var(--border);\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n.lt-swatch[data-tint='zinc'] {\n  background: linear-gradient(135deg, #18181b 50%, #fafafa 50%);\n}\n.lt-swatch[data-tint='blue'] {\n  --lt-tint: #2563eb;\n}\n.lt-swatch[data-tint='violet'] {\n  --lt-tint: #7c3aed;\n}\n.lt-swatch[data-tint='green'] {\n  --lt-tint: #15803d;\n}\n.lt-swatch[data-tint='orange'] {\n  --lt-tint: #c2410c;\n}\n.lt-swatch[data-tint='rose'] {\n  --lt-tint: #e11d48;\n}\n.lt-swatch[aria-checked='true'] {\n  box-shadow: 0 0 0 2px var(--foreground);\n}\n.lt-swatch:focus-visible {\n  outline: 2px solid var(--ring);\n  outline-offset: 3px;\n}\n/* Translated and failed keep their own colours: they are news, the tint is not. */\n:host([data-accent]) .lt-main:not(.lt-active):not(.lt-error) {\n  background: var(--primary);\n  border-color: transparent;\n}\n@media (hover: none), (pointer: coarse) {\n  .lt-swatch {\n    width: 36px;\n    height: 36px;\n  }\n}\n";
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
  function applyLook(theme, accent) {
    if (!host) return;
    if (theme === "light" || theme === "dark") host.dataset["theme"] = theme;
    else delete host.dataset["theme"];
    if (typeof accent === "string" && accent !== "zinc" && /^[a-z]+$/.test(accent)) host.dataset["accent"] = accent;
    else delete host.dataset["accent"];
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
    applyLook(getSettings().uiTheme, getSettings().uiAccent);
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
    if (item.id) entry.dataset["item"] = item.id;
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
    const row2 = document.createElement("div");
    row2.className = "lt-field-row";
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
    row2.append(input, send);
    group.append(entry, row2);
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
  const SAMPLE_W = 400;
  const SAMPLE_H = 220;
  const SAMPLE_BUBBLES = [
    { cx: 104, cy: 84, rx: 84, ry: 66 },
    { cx: 301, cy: 82, rx: 58, ry: 68 }
  ];
  const SAMPLE_BAND_TOP = 164;
  const BLACK = 4279308561;
  const WHITE = 4294967295;
  const BAND = 4280953418;
  function row(source, cx, cy, size) {
    return { source, cx, cy, w: [...source].length * size, h: size + 1 };
  }
  function rowFrom(source, left, cy, size) {
    const w = [...source].length * size;
    return { source, cx: left + w / 2, cy, w, h: size + 1 };
  }
  function column(source, cx, top, size) {
    const h = [...source].length * size;
    return { source, cx, cy: top + h / 2, w: size + 1, h };
  }
  const SAMPLE = [
    {
      id: "bubble",
      direction: WritingDirection.LeftToRight,
      alignment: Alignment.Center,
      size: 15,
      textColor: BLACK,
      bgColor: WHITE,
      hPad: 0.4,
      vPad: 0.4,
      lines: [row("どうして", 104, 62, 15), row("ここに", 104, 84, 15), row("いるの？", 104, 106, 15)]
    },
    {
      id: "column",
      direction: WritingDirection.TopToBottom,
      alignment: Alignment.Center,
      size: 15,
      textColor: BLACK,
      bgColor: WHITE,
      hPad: 0.05,
      vPad: 0.05,
      // Right to left, as a vertical page is read.
      lines: [column("まさか君が", 312, 46, 15), column("来るとは", 290, 46, 15)]
    },
    {
      id: "caption",
      direction: WritingDirection.LeftToRight,
      alignment: Alignment.Left,
      size: 17,
      textColor: WHITE,
      bgColor: BAND,
      hPad: 0.4,
      vPad: 0.4,
      lines: [rowFrom("この先は関係者以外", 16, 181, 17), rowFrom("立入禁止です", 16, 204, 17)]
    }
  ];
  const TEXTS = {
    en: {
      glue: " ",
      bubble: ["What are you", "doing here", "so late?"],
      column: ["I never thought", "you'd come"],
      caption: ["Staff only", "No entry"]
    },
    ru: {
      glue: " ",
      bubble: ["Что ты здесь", "делаешь", "так поздно?"],
      column: ["Не думал,", "что ты придёшь"],
      caption: ["Только персонал", "Вход запрещён"]
    },
    ja: {
      glue: "",
      bubble: ["どうして", "ここに", "いるの？"],
      column: ["まさか君が", "来るとは"],
      caption: ["この先は関係者以外", "立入禁止です"]
    },
    zh: {
      glue: "",
      bubble: ["你怎么", "会在", "这里？"],
      column: ["没想到", "你会来"],
      caption: ["非工作人员", "禁止入内"]
    },
    ko: {
      glue: " ",
      bubble: ["너 왜", "여기", "있어?"],
      column: ["네가 올 줄은", "몰랐어"],
      caption: ["관계자 외", "출입 금지"]
    }
  };
  function sampleLanguage(targetLang) {
    const base = (targetLang.split("-")[0] ?? "").toLowerCase();
    return Object.hasOwn(TEXTS, base) ? base : "en";
  }
  const geometryOf = (box) => ({
    cx: box.cx / SAMPLE_W,
    cy: box.cy / SAMPLE_H,
    w: box.w / SAMPLE_W,
    h: box.h / SAMPLE_H,
    angle: 0
  });
  function paragraphBox(paragraph) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const line2 of paragraph.lines) {
      left = Math.min(left, line2.cx - line2.w / 2);
      right = Math.max(right, line2.cx + line2.w / 2);
      top = Math.min(top, line2.cy - line2.h / 2);
      bottom = Math.max(bottom, line2.cy + line2.h / 2);
    }
    return { cx: (left + right) / 2, cy: (top + bottom) / 2, w: right - left, h: bottom - top };
  }
  function patchRect(paragraph, line2) {
    const w = line2.w + paragraph.hPad * line2.h;
    const h = line2.h + paragraph.vPad * line2.h;
    return { x: line2.cx - w / 2, y: line2.cy - h / 2, w, h };
  }
  function sampleBlocks(targetLang, patches = []) {
    const language = sampleLanguage(targetLang);
    const text2 = TEXTS[language];
    let at = 0;
    return SAMPLE.map((paragraph) => {
      const parts = text2[paragraph.id];
      let translation = "";
      const lines = paragraph.lines.map((line2, index) => {
        const part = parts[index] ?? "";
        if (index > 0) translation += text2.glue;
        const words = [];
        for (const match of part.matchAll(/\S+/g)) {
          const start2 = translation.length + match.index;
          words.push([start2, start2 + match[0].length]);
        }
        translation += part;
        const bytes2 = patches[at] ?? null;
        at += 1;
        return {
          words,
          textColor: paragraph.textColor,
          bgColor: paragraph.bgColor,
          geometry: geometryOf(line2),
          background: bytes2 ? { bytes: bytes2, hPad: paragraph.hPad, vPad: paragraph.vPad } : null
        };
      });
      return {
        translation,
        geometry: geometryOf(paragraphBox(paragraph)),
        sourceLang: "ja",
        targetLang: language,
        writingDirection: paragraph.direction,
        alignment: paragraph.alignment,
        lines
      };
    });
  }
  const DRAWN = Object.keys({
    fontFamily: 0,
    fontWeight: 0,
    textColor: 0,
    outlineColor: 0,
    fillColor: 0,
    drawBackground: 0,
    patchPadding: 0,
    verticalText: 0,
    minReadablePx: 0,
    supersample: 0,
    maxCanvasSide: 0,
    mangaMinPx: 0,
    mangaMode: 0,
    mangaBoxGrowth: 0,
    outlineScale: 0,
    eraseMode: 0,
    hullPadding: 0,
    reflowHorizontal: 0,
    bubbleShape: 0,
    fitToBox: 0,
    lineSpacing: 0,
    textAlign: 0
  });
  function previewSignature(settings, displayedWidth) {
    const parts = DRAWN.map((name) => `${name}=${String(settings[name])}`);
    parts.push(`lang=${sampleLanguage(settings.targetLang)}`);
    parts.push(`opacity=${settings.coverOpacity}`);
    parts.push(`w=${Math.round(displayedWidth)}`);
    return parts.join("");
  }
  const DEBOUNCE_MS = 150;
  const RESIDUE = 0.12;
  const SCENE_FONT = "sans-serif";
  function paintGround(ctx) {
    ctx.fillStyle = "#e7e2d8";
    ctx.fillRect(0, 0, SAMPLE_W, SAMPLE_H);
    ctx.fillStyle = "rgba(30, 30, 40, 0.22)";
    for (let y = 3; y < SAMPLE_BAND_TOP; y += 6) {
      for (let x = y / 3 % 2 ? 3 : 6; x < SAMPLE_W; x += 6) {
        ctx.beginPath();
        ctx.arc(x, y, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const band = ctx.createLinearGradient(0, 0, SAMPLE_W, 0);
    band.addColorStop(0, "#1b2440");
    band.addColorStop(1, "#6a2c5b");
    ctx.fillStyle = band;
    ctx.fillRect(0, SAMPLE_BAND_TOP, SAMPLE_W, SAMPLE_H - SAMPLE_BAND_TOP);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, SAMPLE_BAND_TOP, SAMPLE_W, SAMPLE_H - SAMPLE_BAND_TOP);
    ctx.clip();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
    ctx.lineWidth = 5;
    for (let x = -60; x < SAMPLE_W; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, SAMPLE_H);
      ctx.lineTo(x + 60, SAMPLE_BAND_TOP);
      ctx.stroke();
    }
    ctx.restore();
    const [speech] = SAMPLE_BUBBLES;
    const shapes = SAMPLE_BUBBLES.map((bubble) => () => {
      ctx.beginPath();
      ctx.ellipse(bubble.cx, bubble.cy, bubble.rx, bubble.ry, 0, 0, Math.PI * 2);
    });
    if (speech) {
      const foot = speech.cy + speech.ry;
      shapes.push(() => {
        ctx.beginPath();
        ctx.moveTo(speech.cx - 46, foot - 16);
        ctx.lineTo(speech.cx - 62, foot + 8);
        ctx.lineTo(speech.cx - 22, foot - 6);
        ctx.closePath();
      });
    }
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 5;
    for (const trace of shapes) {
      trace();
      ctx.stroke();
    }
    ctx.fillStyle = "#ffffff";
    for (const trace of shapes) {
      trace();
      ctx.fill();
    }
  }
  function paintSource(ctx) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const paragraph of SAMPLE) {
      ctx.font = `${paragraph.size}px ${SCENE_FONT}`;
      ctx.fillStyle = argbToCss(paragraph.textColor);
      for (const line2 of paragraph.lines) {
        if (paragraph.direction !== WritingDirection.TopToBottom) {
          ctx.fillText(line2.source, line2.cx, line2.cy);
          continue;
        }
        const top = line2.cy - line2.h / 2;
        [...line2.source].forEach((char, index) => {
          ctx.fillText(char, line2.cx, top + (index + 0.5) * paragraph.size);
        });
      }
    }
  }
  function blank() {
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext("2d");
    return ctx ? { canvas, ctx } : null;
  }
  async function encode(canvas) {
    const blob = await new Promise((resolve2) => canvas.toBlob(resolve2, "image/webp"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  async function buildScene() {
    const picture = blank();
    const erased = blank();
    if (!picture || !erased) return null;
    paintGround(picture.ctx);
    paintSource(picture.ctx);
    paintGround(erased.ctx);
    erased.ctx.globalAlpha = RESIDUE;
    paintSource(erased.ctx);
    const patches = [];
    for (const paragraph of SAMPLE) {
      for (const line2 of paragraph.lines) {
        const area = patchRect(paragraph, line2);
        const cut = document.createElement("canvas");
        cut.width = Math.max(1, Math.round(area.w));
        cut.height = Math.max(1, Math.round(area.h));
        const ctx = cut.getContext("2d");
        if (!ctx) {
          patches.push(null);
          continue;
        }
        ctx.drawImage(erased.canvas, area.x, area.y, area.w, area.h, 0, 0, cut.width, cut.height);
        patches.push(await encode(cut));
      }
    }
    return { picture: picture.canvas, patches };
  }
  let scene = null;
  let open = true;
  function createPreview() {
    const element = document.createElement("details");
    element.className = "lt-live lt-extra";
    element.open = open;
    const summary = document.createElement("summary");
    summary.className = "lt-live-head";
    const chevron = document.createElement("span");
    chevron.className = "lt-live-chevron";
    chevron.innerHTML = icon("down", 14);
    const title = document.createElement("span");
    title.textContent = t("preview.title");
    summary.append(chevron, title);
    const canvas = document.createElement("canvas");
    canvas.className = "lt-live-canvas";
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", t("preview.title"));
    const note = document.createElement("div");
    note.className = "lt-live-note";
    note.textContent = t("preview.note");
    const body2 = document.createElement("div");
    body2.className = "lt-live-body";
    body2.append(canvas, note);
    element.append(summary, body2);
    let timer;
    let pending = null;
    let shown2 = "";
    let generation2 = 0;
    let disposed = false;
    const draw = async () => {
      const read = pending;
      if (!read || disposed || canvas.getClientRects().length === 0) return;
      const settings = read();
      const width = SAMPLE_W;
      const signature = previewSignature(settings, width);
      pending = null;
      if (signature === shown2) return;
      const mine = ++generation2;
      try {
        scene ??= buildScene();
        const made = await scene;
        if (!made) return;
        const blob = await renderToBlob(
          made.picture,
          SAMPLE_W,
          SAMPLE_H,
          sampleBlocks(settings.targetLang, made.patches),
          settings,
          width
        );
        const bitmap = await createImageBitmap(blob);
        if (mine === generation2 && !disposed) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(made.picture, 0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = Math.min(1, Math.max(0, settings.coverOpacity / 100));
            ctx.drawImage(bitmap, 0, 0);
            ctx.globalAlpha = 1;
            shown2 = signature;
          }
        }
        bitmap.close();
      } catch {
      }
    };
    const schedule = (read, delay = DEBOUNCE_MS) => {
      if (disposed) return;
      pending = read;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void draw(), delay);
    };
    element.addEventListener("toggle", () => {
      open = element.open;
      if (element.open && pending) schedule(pending, 0);
    });
    return {
      element,
      schedule,
      dispose() {
        disposed = true;
        pending = null;
        window.clearTimeout(timer);
      }
    };
  }
  const SCHEMATIC_W = 60;
  const SCHEMATIC_H = 40;
  const rect = (x, y, w, h, tone, r = 1.5) => ({
    kind: "rect",
    x,
    y,
    w,
    h,
    r,
    tone
  });
  const line = (x1, y1, x2, y2, tone = "ink") => ({
    kind: "line",
    x1,
    y1,
    x2,
    y2,
    tone
  });
  const stroke = (cx, y, w, tone = "ink") => line(cx - w / 2, y, cx + w / 2, y, tone);
  const FRAME = { x: 4, y: 4, w: 52, h: 32 };
  const frame = () => rect(FRAME.x, FRAME.y, FRAME.w, FRAME.h, "dim", 3);
  function controls(corner, size, count = 3) {
    const inset2 = 3;
    const gap = 2;
    const right = corner === "tr" || corner === "br";
    const bottom = corner === "br" || corner === "bl";
    const y = bottom ? FRAME.y + FRAME.h - inset2 - size : FRAME.y + inset2;
    const shapes = [];
    for (let i = 0; i < count; i += 1) {
      const step = i * (size + gap);
      const x = right ? FRAME.x + FRAME.w - inset2 - size - step : FRAME.x + inset2 + step;
      shapes.push(rect(x, y, size, size, i === 0 ? "solid" : "ink"));
    }
    return shapes;
  }
  const pointer = (x, y) => ({
    kind: "polygon",
    tone: "solid",
    points: [
      [x, y],
      [x, y + 10],
      [x + 2.8, y + 7.4],
      [x + 4.6, y + 11.2],
      [x + 6.2, y + 10.4],
      [x + 4.4, y + 6.8],
      [x + 7.6, y + 6.8]
    ]
  });
  function buttonMode(value) {
    if (value === "hover") return [frame(), ...controls("tr", 7, 1), pointer(24, 14)];
    if (value === "pinned") return [frame(), ...controls("tr", 7, 1)];
    return [
      rect(3, 8, 34, 24, "dim", 3),
      rect(27, 11, 7, 7, "solid"),
      pointer(13, 15),
      rect(43, 4, 14, 32, "dim", 3),
      rect(49, 7, 5, 5, "solid")
    ];
  }
  const TEXT_LINES = [
    [11, 34],
    [20, 22],
    [29, 30]
  ];
  function eraseMode(value) {
    const shapes = [];
    if (value === "hull") {
      shapes.push({
        kind: "polygon",
        tone: "soft",
        points: [[11, 5.5], [49, 5.5], [47, 34.5], [13, 34.5]]
      });
    } else {
      for (const [y, w] of TEXT_LINES) shapes.push(rect(30 - w / 2 - 2, y - 3.5, w + 4, 7, "soft"));
    }
    for (const [y, w] of TEXT_LINES) shapes.push(stroke(30, y, w - 4));
    return shapes;
  }
  function script(x, glyph, vertical) {
    const shapes = [{ kind: "text", x: x + 5.5, y: 24, text: glyph, tone: "solid" }];
    if (vertical) {
      shapes.push(line(x + 15, 8, x + 15, 26), line(x + 20, 8, x + 20, 32), line(x + 25, 8, x + 25, 32));
    } else {
      shapes.push(line(x + 13, 12, x + 26, 12), line(x + 13, 20, x + 26, 20), line(x + 13, 28, x + 21, 28));
    }
    return shapes;
  }
  function verticalText(value) {
    return [
      ...script(2, "文", value !== "horizontal"),
      line(30, 7, 30, 33, "dim"),
      ...script(31, "A", value === "keep")
    ];
  }
  const ALIGN_WIDTHS = [36, 24, 30, 18];
  function textAlign(value) {
    if (value === "auto") {
      const block = (left, tone) => [16, 10, 14, 8].map((w, i) => line(left, 11 + i * 6, left + w, 11 + i * 6, tone));
      return [
        ...block(6, "dim"),
        line(26, 20, 34, 20, "dim"),
        line(31, 17, 34, 20, "dim"),
        line(31, 23, 34, 20, "dim"),
        ...block(38, "ink")
      ];
    }
    return ALIGN_WIDTHS.map((w, i) => {
      const y = 11 + i * 6;
      if (value === "left") return line(12, y, 12 + w, y);
      if (value === "right") return line(48 - w, y, 48, y);
      return stroke(30, y, w);
    });
  }
  function reflowHorizontal(value) {
    const bubble = { kind: "ellipse", cx: 18, cy: 20, rx: 13, ry: 13, tone: "dim" };
    const inBubble = value === "off" ? [stroke(18, 14, 31), stroke(18, 20, 25), stroke(18, 26, 29)] : [stroke(18, 14, 13), stroke(18, 20, 19), stroke(18, 26, 13)];
    const paragraph = value === "on" ? [line(42, 14, 53, 14), line(42, 20, 53, 20), line(42, 26, 53, 26)] : [line(42, 14, 54, 14), line(42, 20, 54, 20), line(42, 26, 47, 26)];
    return [bubble, ...inBubble, rect(38, 7, 19, 26, "dim", 2), ...paragraph];
  }
  const BUTTON_SIZES = { s: 5, m: 7, l: 10 };
  const DRAWERS = {
    buttonCorner: (value) => [frame(), ...controls(value, 7)],
    buttonSize: (value) => [frame(), ...controls("tr", BUTTON_SIZES[value] ?? 7)],
    buttonMode,
    eraseMode,
    verticalText,
    textAlign,
    reflowHorizontal
  };
  function hasSchematic(key) {
    return Object.hasOwn(DRAWERS, key);
  }
  function schematic(key, value) {
    return DRAWERS[key]?.(value) ?? [];
  }
  const REPO = "https://github.com/bropines/chrome-lens-userscript";
  const BUTTON_ICONS = {
    translate: "translate",
    search: "search",
    ask: "sparkles",
    area: "area",
    objects: "objects",
    text: "text",
    copy: "copy",
    edit: "edit",
    settings: "settings",
    menu: "more"
  };
  let panel$1 = null;
  let requestClose = null;
  let stopListening = null;
  let recording = false;
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
  function el$1(tag, className, text2) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text2 !== void 0) element.textContent = text2;
    return element;
  }
  function button$1(className, text2, act) {
    const element = el$1("button", className, text2);
    element.type = "button";
    if (act) element.dataset["act"] = act;
    return element;
  }
  const changed = (input) => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const SVG = "http://www.w3.org/2000/svg";
  function drawSchematic(svg, key, value) {
    svg.textContent = "";
    for (const shape of schematic(key, value)) {
      const node = document.createElementNS(SVG, shape.kind);
      node.setAttribute("class", `lt-sch-${shape.tone}`);
      const set = (attributes) => {
        for (const [name, number] of Object.entries(attributes)) node.setAttribute(name, String(number));
      };
      if (shape.kind === "rect") {
        set({ x: shape.x, y: shape.y, width: shape.w, height: shape.h, rx: shape.r });
      } else if (shape.kind === "line") {
        set({ x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 });
      } else if (shape.kind === "ellipse") {
        set({ cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry });
      } else if (shape.kind === "polygon") {
        node.setAttribute("points", shape.points.map(([x, y]) => `${x},${y}`).join(" "));
      } else {
        set({ x: shape.x, y: shape.y });
        node.textContent = shape.text;
      }
      svg.appendChild(node);
    }
  }
  function withSchematic(field, select) {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "lt-sch");
    svg.setAttribute("viewBox", `0 0 ${SCHEMATIC_W} ${SCHEMATIC_H}`);
    svg.setAttribute("aria-hidden", "true");
    const refresh = () => drawSchematic(svg, field.key, select.value);
    select.addEventListener("input", refresh);
    select.addEventListener("change", refresh);
    refresh();
    const holder = el$1("span", "lt-pick");
    holder.append(svg, select);
    return holder;
  }
  function readout(field, value) {
    if (field.unit === "%") return `${Math.round(value * 100)}%`;
    if (field.unit === "pct") return `${Math.round(value)}%`;
    return `${value.toFixed((field.step ?? 1) < 0.1 ? 2 : 1)}x`;
  }
  function buildRange(field, settings) {
    const slider = el$1("input", "lt-input");
    slider.type = "range";
    if (field.min !== void 0) slider.min = String(field.min);
    if (field.max !== void 0) slider.max = String(field.max);
    if (field.step !== void 0) slider.step = String(field.step);
    slider.value = String(settings[field.key]);
    slider.dataset["key"] = field.key;
    const value = el$1("span", "lt-readout");
    const wantsPreview = field.key === "outlineScale";
    const livePopup = field.key === "popupOpacity";
    const preview = el$1("canvas", "lt-preview");
    preview.width = 460;
    preview.height = 64;
    const refresh = () => {
      const number = Number(slider.value);
      value.textContent = readout(field, number);
      if (wantsPreview) drawOutlinePreview(preview, number);
      if (livePopup) applyPopupOpacity(number);
    };
    slider.addEventListener("input", refresh);
    refresh();
    const holder = el$1("span", "lt-slider");
    holder.append(slider, value);
    return wantsPreview ? [holder, preview] : [holder];
  }
  function buildColor(field, settings) {
    const text2 = el$1("input", "lt-input");
    text2.type = "text";
    text2.value = String(settings[field.key]);
    text2.placeholder = t("color.auto");
    text2.dataset["key"] = field.key;
    text2.maxLength = 7;
    text2.spellcheck = false;
    const swatch = el$1("input", "lt-swatch");
    swatch.type = "color";
    swatch.setAttribute("aria-label", t("color.pick"));
    const sync = () => {
      const set = /^#[0-9a-f]{6}$/i.test(text2.value.trim());
      if (set) swatch.value = text2.value.trim();
      swatch.classList.toggle("lt-unset", !set);
    };
    sync();
    text2.addEventListener("input", sync);
    swatch.addEventListener("input", () => {
      text2.value = swatch.value;
      changed(text2);
    });
    const holder = el$1("span", "lt-color");
    holder.append(swatch, text2);
    return [holder];
  }
  function buildChord(field, settings) {
    const value = el$1("input");
    value.type = "hidden";
    value.value = String(settings[field.key]);
    value.dataset["key"] = field.key;
    const record = button$1("lt-btn lt-chord", "");
    const clear = button$1("lt-btn lt-ghost lt-square", "");
    clear.innerHTML = icon("close", 16);
    clear.setAttribute("aria-label", t("chord.clear"));
    let listening = false;
    const show = () => {
      record.textContent = listening ? t("chord.record") : formatChord(value.value) || t("chord.none");
      record.classList.toggle("lt-recording", listening);
      clear.hidden = !value.value;
    };
    const stop = () => {
      listening = false;
      recording = false;
      show();
    };
    const set = (next) => {
      value.value = next;
      stop();
      changed(value);
    };
    record.addEventListener("click", () => {
      listening = !listening;
      recording = listening;
      show();
    });
    record.addEventListener("blur", () => {
      if (listening) stop();
    });
    record.addEventListener("keydown", (event) => {
      if (!listening) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return stop();
      if (event.key === "Backspace" || event.key === "Delete") return set("");
      const chord = chordFromEvent(event);
      if (chord) set(serializeChord(chord));
      return void 0;
    });
    clear.addEventListener("click", () => set(""));
    show();
    const holder = el$1("span", "lt-chord-row");
    holder.append(value, record, clear);
    return [holder];
  }
  function buildButtons(field, settings) {
    const value = el$1("input");
    value.type = "hidden";
    value.value = String(settings[field.key]);
    value.dataset["key"] = field.key;
    let entries2 = parseButtons(value.value);
    const list = el$1("ul", "lt-order");
    const rows = /* @__PURE__ */ new Map();
    const commit = (next, focus) => {
      entries2 = next;
      value.value = serializeButtons(entries2);
      for (const entry of entries2) {
        const row2 = rows.get(entry.id);
        if (row2) list.appendChild(row2);
      }
      if (focus) rows.get(focus.id)?.querySelector(`[data-move="${focus.act}"]`)?.focus();
      changed(value);
    };
    for (const entry of entries2) {
      const name = t(`act.${entry.id}`);
      const row2 = el$1("li", "lt-order-item");
      row2.dataset["button"] = entry.id;
      const grip = el$1("span", "lt-grip");
      grip.innerHTML = icon("grip", 16);
      grip.title = t("buttons.drag");
      const pin = el$1("input", "lt-input");
      pin.type = "checkbox";
      pin.checked = entry.pinned;
      pin.setAttribute("aria-label", t("buttons.pin", { name }));
      pin.addEventListener("change", () => commit(togglePinned(entries2, entry.id)));
      const label = el$1("span", "lt-order-name");
      label.innerHTML = icon(BUTTON_ICONS[entry.id], 16);
      label.append(name);
      const up = button$1("lt-btn lt-ghost lt-square", "");
      up.innerHTML = icon("up", 16);
      up.dataset["move"] = "up";
      up.setAttribute("aria-label", t("buttons.up", { name }));
      up.addEventListener("click", () => commit(moveButton(entries2, entry.id, -1), { id: entry.id, act: "up" }));
      const down = button$1("lt-btn lt-ghost lt-square", "");
      down.innerHTML = icon("down", 16);
      down.dataset["move"] = "down";
      down.setAttribute("aria-label", t("buttons.down", { name }));
      down.addEventListener("click", () => commit(moveButton(entries2, entry.id, 1), { id: entry.id, act: "down" }));
      let dragging = false;
      grip.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragging = true;
        row2.classList.add("lt-dragging");
        try {
          grip.setPointerCapture(event.pointerId);
        } catch {
        }
      });
      grip.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        const items = [...list.children];
        let index = items.length;
        for (const [at, item] of items.entries()) {
          const box = item.getBoundingClientRect();
          if (event.clientY < box.top + box.height / 2) {
            index = at;
            break;
          }
        }
        const current = entries2.findIndex((candidate2) => candidate2.id === entry.id);
        const target = index > current ? index - 1 : index;
        if (target !== current) commit(placeButton(entries2, entry.id, target));
      });
      const drop2 = () => {
        dragging = false;
        row2.classList.remove("lt-dragging");
      };
      grip.addEventListener("pointerup", drop2);
      grip.addEventListener("pointercancel", drop2);
      const moves = el$1("span", "lt-order-moves");
      moves.append(up, down);
      row2.append(grip, pin, label, moves);
      rows.set(entry.id, row2);
      list.appendChild(row2);
    }
    return [value, list];
  }
  function buildField(field, settings) {
    const compound = field.type === "buttons" || field.type === "chord";
    const row2 = el$1("div", "lt-row");
    row2.dataset["field"] = field.key;
    if (field.wide) row2.classList.add("lt-row-wide");
    const id = `lt-field-${field.key}`;
    const label = el$1("span", "lt-label");
    if (compound) label.textContent = fieldLabel(field);
    else {
      const name = el$1("label", "lt-label-text", fieldLabel(field));
      name.htmlFor = id;
      label.appendChild(name);
    }
    const reset = button$1("lt-reset", "");
    reset.innerHTML = icon("undo", 14);
    reset.dataset["reset"] = field.key;
    reset.title = t("panel.resetField");
    reset.setAttribute("aria-label", `${t("panel.resetField")}: ${fieldLabel(field)}`);
    reset.hidden = true;
    label.appendChild(reset);
    row2.appendChild(label);
    if (field.type === "range") row2.append(...buildRange(field, settings));
    else if (field.type === "color") row2.append(...buildColor(field, settings));
    else if (field.type === "chord") row2.append(...buildChord(field, settings));
    else if (field.type === "buttons") row2.append(...buildButtons(field, settings));
    else if (field.type === "select") {
      const select = el$1("select", "lt-input");
      for (const [value, text2] of fieldChoices(field)) {
        const option = el$1("option", void 0, text2);
        option.value = value;
        select.appendChild(option);
      }
      select.value = String(settings[field.key]);
      select.dataset["key"] = field.key;
      row2.appendChild(hasSchematic(field.key) ? withSchematic(field, select) : select);
    } else {
      const control2 = el$1("input", "lt-input");
      control2.type = field.type;
      if (field.type === "checkbox") {
        control2.checked = Boolean(settings[field.key]);
        row2.classList.add("lt-row-check");
      } else {
        if (field.step !== void 0) control2.step = String(field.step);
        if (field.min !== void 0) control2.min = String(field.min);
        if (field.max !== void 0) control2.max = String(field.max);
        control2.value = shown(field, settings[field.key]);
      }
      control2.dataset["key"] = field.key;
      row2.appendChild(control2);
    }
    const control = compound ? null : row2.querySelector(`[data-key="${field.key}"]`);
    if (control) control.id = id;
    const hint = fieldHint(field);
    if (hint) {
      const note = el$1("span", "lt-hint", hint);
      note.id = `${id}-hint`;
      control?.setAttribute("aria-describedby", note.id);
      row2.appendChild(note);
    }
    return row2;
  }
  function readControl(field, input) {
    return field.type === "checkbox" ? input.checked : input.value;
  }
  function controlsOf(root) {
    const found = [];
    for (const field of FIELDS) {
      const input = root.querySelector(`[data-key="${field.key}"]`);
      if (input) found.push([field, input]);
    }
    return found;
  }
  function recordBaseline(root, baseline) {
    for (const [field, input] of controlsOf(root)) baseline.set(input, readControl(field, input));
  }
  function collect(root, baseline) {
    return formPatch(
      controlsOf(root).map(([field, input]) => {
        const now = readControl(field, input);
        return [field, now, baseline.get(input) ?? now];
      })
    );
  }
  function closeNow(revert = true) {
    stopListening?.();
    stopListening = null;
    requestClose = null;
    recording = false;
    panel$1?.remove();
    panel$1 = null;
    if (!revert) return;
    applyPopupOpacity(getSettings().popupOpacity);
    applyLook(getSettings().uiTheme, getSettings().uiAccent);
    useLanguage(getSettings().language);
  }
  function openSettings(context, restore) {
    if (panel$1) {
      requestClose?.();
      return;
    }
    const backdrop = el$1("div", "lt-panel-backdrop");
    panel$1 = backdrop;
    const dialog = el$1("div", "lt-panel lt-settings");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", t("panel.aria"));
    const head = el$1("header", "lt-panel-head");
    const search = el$1("input", "lt-input lt-search");
    search.type = "search";
    search.placeholder = t("panel.search");
    search.setAttribute("aria-label", t("panel.search"));
    const x = button$1("lt-x", "", "cancel");
    x.innerHTML = icon("close");
    x.setAttribute("aria-label", t("panel.close"));
    head.append(el$1("strong", void 0, t("panel.title")), search, x);
    const tabs = el$1("nav", "lt-tabs");
    tabs.setAttribute("role", "tablist");
    const body2 = el$1("div", "lt-panel-body");
    const main = el$1("div", "lt-settings-main");
    main.append(tabs, body2);
    const foot = el$1("footer", "lt-panel-foot");
    const guard = el$1("span", "lt-guard", t("panel.unsaved"));
    guard.hidden = true;
    const discard = button$1("lt-btn lt-ghost", t("panel.discard"), "discard");
    discard.hidden = true;
    const keep = button$1("lt-btn", t("panel.keepEditing"), "keep");
    keep.hidden = true;
    const cancel = button$1("lt-btn lt-ghost", t("panel.cancel"), "cancel");
    const save = button$1("lt-btn lt-primary", t("panel.save"), "save");
    foot.append(guard, el$1("span", "lt-spacer"), discard, keep, cancel, save);
    dialog.append(head, main, foot);
    backdrop.appendChild(dialog);
    let draft = restore?.draft ?? getSettings();
    let active2 = restore?.tab ?? "general";
    let importNote = "";
    const baseline = /* @__PURE__ */ new WeakMap();
    const current = () => ({ ...draft, ...collect(backdrop, baseline) });
    const isDirty = () => settingsDiffer(current(), getSettings());
    const preview = createPreview();
    const refreshPreview = (delay) => preview.schedule(current, delay);
    const setGuard = (on) => {
      guard.hidden = !on;
      discard.hidden = !on;
      keep.hidden = !on;
      cancel.hidden = on;
    };
    const markChanged = () => {
      const now = current();
      for (const reset of body2.querySelectorAll("[data-reset]")) {
        const key = reset.dataset["reset"];
        reset.hidden = now[key] === DEFAULTS[key];
      }
      for (const pane of body2.querySelectorAll("[data-pane]")) {
        const tabReset = pane.querySelector('[data-act="reset-tab"]');
        if (tabReset) tabReset.hidden = !pane.querySelector("[data-reset]:not([hidden])");
      }
    };
    const applyFilter = () => {
      const query = search.value.trim();
      let any = false;
      for (const pane of body2.querySelectorAll("[data-pane]")) {
        let matches = 0;
        for (const row2 of pane.querySelectorAll("[data-field]")) {
          const field = FIELDS.find((candidate2) => candidate2.key === row2.dataset["field"]);
          const hit = !query || field !== void 0 && fieldMatches(field, query);
          row2.hidden = !hit;
          if (hit) matches += 1;
        }
        for (const extra of pane.querySelectorAll(".lt-extra")) extra.hidden = Boolean(query);
        pane.hidden = query ? matches === 0 : pane.dataset["pane"] !== active2;
        if (!pane.hidden) any = true;
      }
      dialog.classList.toggle("lt-searching", Boolean(query));
      for (const tab of tabs.querySelectorAll("[data-tab]")) {
        tab.setAttribute("aria-selected", String(!query && tab.dataset["tab"] === active2));
      }
      const empty = body2.querySelector(".lt-empty");
      if (empty) {
        empty.hidden = any;
        empty.textContent = t("panel.noMatches", { query });
      }
    };
    const show = (tab) => {
      active2 = tab;
      search.value = "";
      applyFilter();
      body2.scrollTop = 0;
      refreshPreview(0);
      tabs.querySelector(`[data-tab="${tab}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const fieldOf = (key) => FIELDS.find((field) => field.key === key);
    const GENERAL_OWN = /* @__PURE__ */ new Set(["enabled", "autoTranslate", "uiMode", "language", "popupOpacity", "uiTheme", "uiAccent"]);
    let syncSiteNow = () => {
    };
    const buildSiteNow = () => {
      const row2 = el$1("div", "lt-row lt-extra lt-site-now");
      row2.appendChild(el$1("span", "lt-label", t("general.site", { host: hostOf() })));
      const group = el$1("div", "lt-segmented");
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", t("general.site", { host: hostOf() }));
      const hint = el$1("span", "lt-hint");
      const choices = ["off", "default", "auto"].map((mode) => {
        const choice = button$1("lt-seg", t(`general.site.${mode}`));
        choice.setAttribute("role", "radio");
        choice.addEventListener("click", () => {
          if (context.site() === mode) return;
          context.setSite(mode);
          syncSiteNow();
          redrawSites();
        });
        group.appendChild(choice);
        return [mode, choice];
      });
      syncSiteNow = () => {
        const now = context.site();
        for (const [mode, choice] of choices) choice.setAttribute("aria-checked", String(mode === now));
        hint.textContent = now === "off" ? t("general.site.hint.off") : now === "auto" ? t("general.site.hint.auto") : current().autoTranslate ? t("general.site.hint.defaultAuto") : t("general.site.hint.default");
      };
      row2.append(group, hint);
      return row2;
    };
    const buildModes = (values) => {
      const field = fieldOf("uiMode");
      const row2 = el$1("div", "lt-row lt-row-wide lt-modes-row");
      row2.dataset["field"] = field.key;
      row2.appendChild(el$1("span", "lt-label", fieldLabel(field)));
      const select = el$1("select", "lt-input");
      select.hidden = true;
      for (const value of ["simple", "pro"]) {
        const option = el$1("option", void 0, value);
        option.value = value;
        select.appendChild(option);
      }
      select.value = values.uiMode;
      select.dataset["key"] = field.key;
      const cards = el$1("div", "lt-modes");
      cards.setAttribute("role", "radiogroup");
      cards.setAttribute("aria-label", fieldLabel(field));
      for (const [mode, glyph] of [
        ["simple", "translate"],
        ["pro", "layers"]
      ]) {
        const card = button$1("lt-mode", "");
        card.setAttribute("role", "radio");
        card.setAttribute("aria-checked", String(values.uiMode === mode));
        const title = el$1("span", "lt-mode-title");
        title.innerHTML = icon(glyph, 16);
        title.appendChild(el$1("span", void 0, t(`general.${mode}.title`)));
        card.append(title, el$1("span", "lt-mode-desc", t(`general.${mode}.desc`)));
        card.addEventListener("click", () => {
          if (select.value === mode) return;
          select.value = mode;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        cards.appendChild(card);
      }
      row2.append(select, cards);
      return row2;
    };
    const buildLook = (values) => {
      const card = el$1("div", "lt-card lt-look");
      const live2 = { theme: values.uiTheme, accent: values.uiAccent };
      const show2 = () => applyLook(live2.theme, live2.accent);
      const hiddenSelect = (field, value) => {
        const select = el$1("select", "lt-input");
        select.hidden = true;
        for (const option of field.options ?? []) {
          const node = el$1("option", void 0, option);
          node.value = option;
          select.appendChild(node);
        }
        select.value = value;
        select.dataset["key"] = field.key;
        return select;
      };
      const group = (field, value, className, make, onPick) => {
        const row2 = el$1("div", "lt-row lt-row-wide");
        row2.dataset["field"] = field.key;
        row2.appendChild(el$1("span", "lt-label", fieldLabel(field)));
        const select = hiddenSelect(field, value);
        const choices = el$1("div", className);
        choices.setAttribute("role", "radiogroup");
        choices.setAttribute("aria-label", fieldLabel(field));
        const buttons = (field.options ?? []).map((option) => {
          const choice = make(option);
          choice.setAttribute("role", "radio");
          choice.setAttribute("aria-checked", String(option === value));
          choice.addEventListener("click", () => {
            select.value = option;
            for (const [i, other] of buttons.entries()) {
              other.setAttribute("aria-checked", String(field.options?.[i] === option));
            }
            onPick(option);
            select.dispatchEvent(new Event("change", { bubbles: true }));
          });
          return choice;
        });
        choices.append(...buttons);
        row2.append(select, choices);
        return row2;
      };
      const theme = fieldOf("uiTheme");
      const accent = fieldOf("uiAccent");
      card.append(
        group(theme, values.uiTheme, "lt-segmented", (option) => button$1("lt-seg", t(`set.uiTheme.opt.${option}`)), (option) => {
          live2.theme = option;
          show2();
        }),
        group(
          accent,
          values.uiAccent,
          "lt-swatches",
          (option) => {
            const swatch = button$1("lt-swatch", "");
            swatch.dataset["tint"] = option;
            const name = t(`set.uiAccent.opt.${option}`);
            swatch.title = name;
            swatch.setAttribute("aria-label", name);
            return swatch;
          },
          (option) => {
            live2.accent = option;
            show2();
          }
        )
      );
      show2();
      return card;
    };
    const QUICK = [
      ["translateAll", "images"],
      ["undoAll", "undo"],
      ["clearCache", "trash"],
      ["diagnostics", "pulse"]
    ];
    const buildQuick = () => {
      const commands2 = panelCommands();
      const found = QUICK.flatMap(([id, glyph]) => {
        const command = commands2.find((candidate2) => candidate2.id === id);
        return command ? [[command, glyph]] : [];
      });
      if (!found.length) return null;
      const section = el$1("div", "lt-extra");
      section.appendChild(el$1("div", "lt-group", t("general.quick")));
      const grid = el$1("div", "lt-quick");
      for (const [command, glyph] of found) {
        const action = button$1("lt-btn lt-quick-btn", "");
        action.dataset["command"] = command.id;
        action.innerHTML = icon(glyph, 16);
        action.appendChild(el$1("span", void 0, command.label));
        if (command.id === "clearCache") {
          const size = el$1("span", "lt-quick-meta");
          const measure = () => {
            const memory = cacheStats();
            void storedStats().then(({ bytes: bytes2 }) => {
              size.textContent = t("general.cacheSize", { size: ((memory.bytes + bytes2) / 1048576).toFixed(1) });
            });
          };
          measure();
          action.appendChild(size);
          action.addEventListener("click", () => {
            command.run();
            window.setTimeout(measure, 300);
          });
        } else {
          action.addEventListener("click", () => {
            closeNow();
            command.run();
          });
        }
        grid.appendChild(action);
      }
      section.append(grid, el$1("div", "lt-note", t("panel.actionsNote")));
      return section;
    };
    const buildGeneral = (values, fields) => {
      const parts = [];
      const status = el$1("div", "lt-card lt-status");
      status.append(buildField(fieldOf("enabled"), values), buildSiteNow(), buildField(fieldOf("autoTranslate"), values));
      parts.push(status, buildModes(values));
      const grid = el$1("div", "lt-grid");
      grid.append(buildField(fieldOf("language"), values), buildField(fieldOf("popupOpacity"), values));
      parts.push(grid, buildLook(values));
      const rest = fields.filter((field) => !GENERAL_OWN.has(field.key));
      if (rest.length) {
        parts.push(el$1("div", "lt-group lt-extra", t("general.essentials")));
        const more = el$1("div", "lt-grid");
        for (const field of rest) more.appendChild(buildField(field, values));
        parts.push(more);
      }
      const quick = buildQuick();
      if (quick) parts.push(quick);
      syncSiteNow();
      return parts;
    };
    const buildSites = () => {
      const section = el$1("div", "lt-extra lt-sites");
      const here = hostOf();
      const row2 = el$1("label", "lt-row lt-row-wide");
      row2.appendChild(el$1("span", "lt-label", t("sites.current", { host: here })));
      const select = el$1("select", "lt-input lt-site-mode");
      for (const mode of ["default", "off", "auto"]) {
        const option = el$1("option", void 0, t(`sites.${mode}`));
        option.value = mode;
        select.appendChild(option);
      }
      select.value = context.site();
      select.addEventListener("change", () => {
        context.setSite(select.value);
        redrawSites();
      });
      row2.appendChild(select);
      section.appendChild(row2);
      section.appendChild(el$1("div", "lt-group", t("sites.others")));
      const others = Object.entries(siteRules()).filter(([host2]) => host2 !== here);
      if (!others.length) section.appendChild(el$1("div", "lt-note", t("sites.none")));
      const list = el$1("ul", "lt-site-list");
      for (const [host2, mode] of others.sort(([a], [b]) => a.localeCompare(b))) {
        const item = el$1("li", "lt-site");
        const remove = button$1("lt-btn lt-ghost lt-square", "");
        remove.innerHTML = icon("close", 16);
        remove.setAttribute("aria-label", t("sites.remove", { host: host2 }));
        remove.addEventListener("click", () => {
          setSiteMode("default", host2);
          redrawSites();
        });
        item.append(el$1("span", "lt-site-host", host2), el$1("span", "lt-site-rule", t(`sites.${mode}`)), remove);
        list.appendChild(item);
      }
      section.append(list, el$1("div", "lt-note", t("sites.note")));
      return section;
    };
    const redrawSites = () => {
      body2.querySelector(".lt-sites")?.replaceWith(buildSites());
    };
    const link = (href, text2) => {
      const anchor = el$1("a", "lt-link", text2);
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      return anchor;
    };
    const buildAbout = () => {
      const section = el$1("div", "lt-extra lt-about");
      section.appendChild(el$1("div", "lt-version", t("about.version", { version: VERSION })));
      section.appendChild(el$1("div", "lt-group", t("about.links")));
      const links = el$1("div", "lt-actions");
      links.append(
        link(REPO, t("about.repo")),
        link(`${REPO}/issues`, t("about.issues")),
        link(`${REPO}/blob/main/docs/lens-capabilities.md`, t("about.docs"))
      );
      section.appendChild(links);
      section.appendChild(el$1("div", "lt-group", t("about.host")));
      section.appendChild(el$1("pre", "lt-report lt-facts", hostFacts().join("\n")));
      section.appendChild(el$1("div", "lt-group", t("about.tools")));
      const tools = el$1("div", "lt-actions");
      for (const command of panelCommands()) {
        if (command.id !== "diagnostics" && command.id !== "clearCache") continue;
        const action = button$1("lt-btn", command.label);
        action.dataset["command"] = command.id;
        action.addEventListener("click", () => {
          if (command.id === "diagnostics") closeNow();
          command.run();
        });
        tools.appendChild(action);
      }
      section.appendChild(tools);
      section.appendChild(el$1("div", "lt-group", t("about.backup")));
      const backup = el$1("div", "lt-actions");
      const file = el$1("input", "lt-import-file");
      file.type = "file";
      file.accept = "application/json,.json";
      file.hidden = true;
      file.addEventListener("change", () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        void chosen.text().then((text2) => {
          let report = null;
          try {
            report = importSettings(JSON.parse(text2));
          } catch {
            report = null;
          }
          const now = current();
          if (!report || !report.applied.length) importNote = t("about.importInvalid");
          else {
            importNote = t("about.importDone", { count: report.applied.length });
            const left = [...report.unknown, ...report.invalid];
            if (left.length) importNote += ` ${t("about.importIgnored", { keys: left.join(", ") })}`;
          }
          fill(report?.applied.length ? { ...now, ...report.patch } : now);
        });
      });
      const importer = button$1("lt-btn", t("about.import"), "import");
      importer.addEventListener("click", () => file.click());
      backup.append(
        button$1("lt-btn", t("about.export"), "export"),
        importer,
        file,
        button$1("lt-btn lt-ghost", t("panel.resetAll"), "reset")
      );
      section.appendChild(backup);
      if (importNote) section.appendChild(el$1("div", "lt-note lt-import-note", importNote));
      section.appendChild(el$1("div", "lt-note", t("about.locale")));
      return section;
    };
    function fill(values) {
      draft = values;
      const pro = values.uiMode === "pro";
      const scroll = body2.scrollTop;
      dialog.classList.toggle("lt-pro", pro);
      search.hidden = !pro;
      if (!pro) search.value = "";
      const shownTabs = pro ? [...TABS] : ["general", "about"];
      if (!shownTabs.includes(active2)) active2 = "general";
      tabs.textContent = "";
      body2.textContent = "";
      for (const tab of shownTabs) {
        const tabButton = button$1("lt-tab", t(`tab.${tab}`));
        tabButton.dataset["tab"] = tab;
        tabButton.setAttribute("role", "tab");
        tabs.appendChild(tabButton);
        const pane = el$1("section", "lt-pane");
        pane.dataset["pane"] = tab;
        const fields = FIELDS.filter((field) => pro ? field.tab === tab : tab === "general" && field.essential);
        const paneHead = el$1("div", "lt-pane-head");
        paneHead.appendChild(el$1("h3", void 0, t(`tab.${tab}`)));
        if (fields.length) {
          const tabReset = button$1("lt-btn lt-ghost lt-small", t("panel.resetTab"), "reset-tab");
          tabReset.hidden = true;
          paneHead.appendChild(tabReset);
        }
        pane.appendChild(paneHead);
        if (pro && tab === "appearance") pane.appendChild(preview.element);
        if (tab === "general") pane.append(...buildGeneral(values, fields));
        else if (fields.length) {
          const grid = el$1("div", "lt-grid");
          for (const field of fields) grid.appendChild(buildField(field, values));
          pane.appendChild(grid);
        }
        if (tab === "sites") pane.appendChild(buildSites());
        if (tab === "about") pane.appendChild(buildAbout());
        body2.appendChild(pane);
      }
      const empty = el$1("div", "lt-note lt-empty");
      empty.hidden = true;
      body2.appendChild(empty);
      recordBaseline(body2, baseline);
      applyFilter();
      markChanged();
      body2.scrollTop = scroll;
      refreshPreview(0);
    }
    fill(draft);
    const download2 = () => {
      const blob = new Blob([exportSettings(current(), VERSION)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = el$1("a");
      anchor.href = url;
      anchor.download = "lens-translate-settings.json";
      backdrop.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1e4);
    };
    requestClose = () => {
      if (guard.hidden && isDirty()) setGuard(true);
      else closeNow();
    };
    backdrop.addEventListener("input", (event) => {
      setGuard(false);
      markChanged();
      const target = event.target;
      if (target === search) applyFilter();
      refreshPreview();
    });
    backdrop.addEventListener("change", (event) => {
      markChanged();
      const key = event.target.dataset["key"];
      if (key === "uiMode") fill(current());
      if (key === "language") useLanguage(current().language);
      if (key === "autoTranslate") syncSiteNow();
      refreshPreview();
    });
    backdrop.addEventListener("click", (event) => {
      const target = event.target;
      if (target === backdrop) return requestClose?.();
      const reset = target.closest("[data-reset]");
      if (reset) {
        event.preventDefault();
        const key = reset.dataset["reset"];
        fill({ ...current(), [key]: DEFAULTS[key] });
        return void 0;
      }
      const tab = target.closest("[data-tab]")?.dataset["tab"];
      if (tab) return show(tab);
      const actor = target.closest("[data-act]");
      const action = actor?.dataset["act"];
      if (action === "cancel") return requestClose?.();
      if (action === "discard") return closeNow();
      if (action === "keep") return setGuard(false);
      if (action === "export") return download2();
      if (action === "save") {
        const saved = saveSettings(current());
        closeNow();
        context.onSaved(saved);
      } else if (action === "reset-tab") {
        const pane = actor?.closest("[data-pane]");
        const next = { ...current() };
        for (const row2 of pane?.querySelectorAll("[data-field]") ?? []) {
          const key = row2.dataset["field"];
          next[key] = DEFAULTS[key];
        }
        fill(next);
      } else if (action === "reset") {
        fill({ ...DEFAULTS, uiMode: current().uiMode });
      }
      return void 0;
    });
    for (const type of ["keydown", "keyup", "keypress"]) {
      backdrop.addEventListener(type, (event) => {
        if (event.key !== "Escape") event.stopPropagation();
      });
    }
    const onKey = (event) => {
      if (event.key !== "Escape" || recording) return;
      event.stopPropagation();
      if (!guard.hidden) setGuard(false);
      else requestClose?.();
    };
    document.addEventListener("keydown", onKey, true);
    const unsubscribe = onLocaleChange(() => {
      if (panel$1 !== backdrop) return;
      const state = { draft: current(), tab: active2 };
      closeNow(false);
      openSettings(context, state);
    });
    stopListening = () => {
      document.removeEventListener("keydown", onKey, true);
      unsubscribe();
      preview.dispose();
    };
    uiRoot().appendChild(backdrop);
    if (!isCompact()) body2.querySelector(".lt-input")?.focus();
  }
  let close = null;
  function closeEditor() {
    close?.();
  }
  const el = (tag, className, text2) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text2 !== void 0) node.textContent = text2;
    return node;
  };
  const button = (className, label, glyph) => {
    const node = el("button", className);
    node.type = "button";
    if (glyph) node.innerHTML = icon(glyph, 16);
    node.appendChild(el("span", void 0, label));
    return node;
  };
  const REDRAW_MS = 160;
  const DRAG_PX = 5;
  function openEditor(options) {
    closeEditor();
    const { blocks } = options;
    let edits = { ...cleanEdits(options.edits, blocks.length) ?? {} };
    let picked = -1;
    const backdrop = el("div", "lt-panel-backdrop lt-editor-backdrop");
    const panel2 = el("div", "lt-panel lt-editor");
    panel2.setAttribute("role", "dialog");
    panel2.setAttribute("aria-label", t("editor.title"));
    const head = el("header", "lt-panel-head");
    head.appendChild(el("strong", void 0, t("editor.title")));
    const x = el("button", "lt-x");
    x.type = "button";
    x.innerHTML = icon("close");
    x.setAttribute("aria-label", t("editor.cancel"));
    head.appendChild(x);
    const body2 = el("div", "lt-editor-body");
    const stage = el("div", "lt-editor-stage");
    const frame2 = el("div", "lt-editor-frame");
    const picture = el("img", "lt-editor-img");
    picture.alt = "";
    picture.draggable = false;
    frame2.appendChild(picture);
    stage.appendChild(frame2);
    const boxes = blocks.map((block, index) => {
      if (!block.geometry) return null;
      const box = el("button", "lt-editor-box");
      box.type = "button";
      box.setAttribute("aria-label", t("editor.paragraph", { n: index + 1 }));
      box.dataset["index"] = String(index);
      frame2.appendChild(box);
      return box;
    });
    const placeBox = (index) => {
      const box = boxes[index];
      const geometry = blocks[index]?.geometry;
      if (!box || !geometry) return;
      const edit = edits[index];
      const scale = edit?.scale ?? 1;
      const w = geometry.w * scale;
      const h = geometry.h * scale;
      box.style.left = `${(geometry.cx + (edit?.dx ?? 0) - w / 2) * 100}%`;
      box.style.top = `${(geometry.cy + (edit?.dy ?? 0) - h / 2) * 100}%`;
      box.style.width = `${w * 100}%`;
      box.style.height = `${h * 100}%`;
      box.style.transform = geometry.angle ? `rotate(${geometry.angle}deg)` : "";
      box.classList.toggle("lt-picked", index === picked);
      box.classList.toggle("lt-edited", edit !== void 0);
      box.classList.toggle("lt-off", Boolean(edit?.hidden || edit?.original));
    };
    const placeAll = () => boxes.forEach((_, index) => placeBox(index));
    const side = el("div", "lt-editor-side");
    const hint = el("p", "lt-hint lt-editor-hint", t("editor.hint"));
    const fields = el("div", "lt-editor-fields");
    const textLabel = el("label", "lt-editor-field");
    textLabel.appendChild(el("span", "lt-label", t("editor.text")));
    const text2 = el("textarea", "lt-input lt-editor-text");
    text2.rows = 3;
    text2.spellcheck = true;
    textLabel.appendChild(text2);
    const sizeRow = el("label", "lt-editor-field");
    const sizeHead = el("span", "lt-label", t("editor.size"));
    const sizeValue = el("span", "lt-editor-value");
    sizeHead.appendChild(sizeValue);
    const size = el("input", "lt-editor-range");
    size.type = "range";
    size.min = String(Math.round(SCALE_MIN * 100));
    size.max = String(Math.round(SCALE_MAX * 100));
    size.step = "5";
    sizeRow.append(sizeHead, size);
    const colourRow = el("div", "lt-editor-colours");
    const colour = (key, label) => {
      const wrap = el("div", "lt-editor-colour");
      const name = el("span", "lt-label", t(label));
      const input = el("input", "lt-editor-swatch");
      input.type = "color";
      input.setAttribute("aria-label", t(label));
      const auto = button("lt-btn lt-ghost lt-small", t("editor.auto"));
      wrap.append(name, input, auto);
      colourRow.appendChild(wrap);
      input.addEventListener("input", () => change({ [key]: input.value }));
      auto.addEventListener("click", () => change({ [key]: void 0 }));
      return { input, auto };
    };
    const fill = colour("color", "editor.color");
    const outline = colour("outline", "editor.outline");
    const toggles = el("div", "lt-editor-toggles");
    const hide = button("lt-btn lt-ghost lt-small", t("editor.hide"));
    const original = button("lt-btn lt-ghost lt-small", t("editor.original"));
    const resetOne = button("lt-btn lt-ghost lt-small", t("editor.reset"), "undo");
    toggles.append(hide, original, resetOne);
    fields.append(textLabel, sizeRow, colourRow, toggles);
    side.append(hint, fields);
    body2.append(stage, side);
    const foot = el("footer", "lt-panel-foot lt-editor-foot");
    const resetAll = button("lt-btn lt-ghost", t("editor.resetAll"));
    const copy = button("lt-btn lt-ghost", t("editor.copy"), "copy");
    const save = button("lt-btn lt-ghost", t("editor.save"), "download");
    const cancel = button("lt-btn lt-ghost", t("editor.cancel"));
    const apply = button("lt-btn lt-primary", t("editor.apply"));
    foot.append(resetAll, copy, save, el("span", "lt-spacer"), cancel, apply);
    panel2.append(head, body2, foot);
    backdrop.appendChild(panel2);
    const showPicked = () => {
      const block = blocks[picked];
      fields.hidden = !block;
      hint.hidden = Boolean(block);
      if (!block) return;
      const edit = edits[picked];
      const style = block.lines[0];
      if (document.activeElement !== text2 && uiRoot().activeElement !== text2) {
        text2.value = edit?.text ?? block.translation;
      }
      const percent = Math.round((edit?.scale ?? 1) * 100);
      size.value = String(percent);
      sizeValue.textContent = `${percent}%`;
      fill.input.value = edit?.color ?? (style ? argbToHex(style.textColor) : "#000000");
      outline.input.value = edit?.outline ?? (style ? argbToHex(style.bgColor) : "#ffffff");
      fill.auto.disabled = !edit?.color;
      outline.auto.disabled = !edit?.outline;
      hide.setAttribute("aria-pressed", String(Boolean(edit?.hidden)));
      original.setAttribute("aria-pressed", String(Boolean(edit?.original)));
      resetOne.disabled = !edit;
      const off = Boolean(edit?.original);
      for (const control of [text2, size, fill.input, outline.input, hide]) control.disabled = off;
    };
    const pick = (index) => {
      picked = index;
      placeAll();
      showPicked();
    };
    let shownUrl = "";
    let drawn = 0;
    let timer = 0;
    let latest = null;
    const redraw = () => {
      window.clearTimeout(timer);
      timer = 0;
      const ticket = ++drawn;
      frame2.classList.add("lt-busy");
      const snapshot = cleanEdits(edits, blocks.length);
      const job = options.render(snapshot);
      latest = job;
      job.then(
        (blob) => {
          if (ticket !== drawn || !close) return;
          if (shownUrl) URL.revokeObjectURL(shownUrl);
          shownUrl = URL.createObjectURL(blob);
          picture.src = shownUrl;
          frame2.classList.remove("lt-busy");
        },
        () => {
          if (ticket === drawn) frame2.classList.remove("lt-busy");
        }
      );
      return job;
    };
    const redrawSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void redraw(), REDRAW_MS);
    };
    const current = () => timer || !latest ? redraw() : latest;
    const change = (patch, now = false) => {
      if (picked < 0) return;
      const merged = { ...edits[picked], ...patch };
      for (const key of Object.keys(patch)) {
        if (patch[key] === void 0) delete merged[key];
      }
      const clean = cleanEdit(merged);
      if (clean) edits[picked] = clean;
      else delete edits[picked];
      placeBox(picked);
      showPicked();
      if (now) void redraw();
      else redrawSoon();
    };
    text2.addEventListener("input", () => {
      const block = blocks[picked];
      if (!block) return;
      change({ text: text2.value === block.translation ? void 0 : text2.value });
    });
    size.addEventListener("input", () => change({ scale: Number(size.value) / 100 }));
    hide.addEventListener("click", () => change({ hidden: !edits[picked]?.hidden || void 0 }, true));
    original.addEventListener("click", () => {
      const was = edits[picked]?.original;
      if (was) {
        delete edits[picked];
        change({}, true);
      } else change({ original: true }, true);
    });
    resetOne.addEventListener("click", () => {
      if (picked < 0) return;
      delete edits[picked];
      text2.blur();
      change({}, true);
    });
    resetAll.addEventListener("click", () => {
      edits = {};
      text2.blur();
      placeAll();
      showPicked();
      void redraw();
    });
    let press = null;
    frame2.addEventListener("pointerdown", (event) => {
      const box = event.target.closest(".lt-editor-box");
      if (!box) {
        if (event.target === picture) pick(-1);
        return;
      }
      const index = Number(box.dataset["index"]);
      event.preventDefault();
      box.setPointerCapture?.(event.pointerId);
      press = {
        index,
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        dx: edits[index]?.dx ?? 0,
        dy: edits[index]?.dy ?? 0,
        moved: false
      };
      if (picked !== index) pick(index);
    });
    frame2.addEventListener("pointermove", (event) => {
      if (!press || event.pointerId !== press.id) return;
      const moveX = event.clientX - press.x;
      const moveY = event.clientY - press.y;
      if (!press.moved && Math.hypot(moveX, moveY) < DRAG_PX) return;
      press.moved = true;
      const rect2 = frame2.getBoundingClientRect();
      if (!rect2.width || !rect2.height) return;
      const merged = { ...edits[press.index], dx: press.dx + moveX / rect2.width, dy: press.dy + moveY / rect2.height };
      const clean = cleanEdit(merged);
      if (clean) edits[press.index] = clean;
      else delete edits[press.index];
      placeBox(press.index);
    });
    const release2 = (event) => {
      if (!press || event.pointerId !== press.id) return;
      const moved = press.moved;
      press = null;
      if (moved) {
        showPicked();
        void redraw();
      }
    };
    frame2.addEventListener("pointerup", release2);
    frame2.addEventListener("pointercancel", release2);
    frame2.addEventListener("keydown", (event) => {
      if (picked < 0 || !event.key.startsWith("Arrow")) return;
      event.preventDefault();
      const step = event.shiftKey ? 0.02 : 4e-3;
      const edit = edits[picked];
      const dx = (edit?.dx ?? 0) + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0);
      const dy = (edit?.dy ?? 0) + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
      change({ dx, dy });
    });
    frame2.addEventListener("focusin", (event) => {
      const box = event.target.closest(".lt-editor-box");
      if (box && Number(box.dataset["index"]) !== picked) pick(Number(box.dataset["index"]));
    });
    copy.addEventListener("click", () => options.copy(current()));
    save.addEventListener("click", () => void current().then((blob) => options.save(blob)));
    apply.addEventListener("click", () => {
      options.apply(cleanEdits(edits, blocks.length));
      finish();
    });
    cancel.addEventListener("click", () => finish());
    x.addEventListener("click", () => finish());
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish();
    });
    const escape = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      finish();
    };
    document.addEventListener("keydown", escape, true);
    for (const type of ["keydown", "keyup", "keypress"]) {
      panel2.addEventListener(type, (event) => {
        if (event.key !== "Escape") event.stopPropagation();
      });
    }
    function finish() {
      if (!close) return;
      close = null;
      window.clearTimeout(timer);
      document.removeEventListener("keydown", escape, true);
      backdrop.remove();
      if (shownUrl) URL.revokeObjectURL(shownUrl);
      options.closed();
    }
    close = finish;
    uiRoot().appendChild(backdrop);
    placeAll();
    showPicked();
    void redraw();
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
    <div class="lt-panel lt-panel-report" role="dialog">
      <header class="lt-panel-head">
        <strong data-t="report.title"></strong>
        <button class="lt-x" type="button" data-act="close">${icon("close")}</button>
      </header>
      <pre class="lt-report"></pre>
      <footer class="lt-panel-foot">
        <button class="lt-btn lt-ghost" type="button" data-act="settings" data-t="report.settings"></button>
        <span class="lt-spacer"></span>
        <button class="lt-btn lt-ghost" type="button" data-act="copy" data-t="report.copy"></button>
        <button class="lt-btn lt-primary" type="button" data-act="close" data-t="report.close"></button>
      </footer>
    </div>`;
    backdrop.querySelector(".lt-panel")?.setAttribute("aria-label", t("report.aria"));
    backdrop.querySelector(".lt-x")?.setAttribute("aria-label", t("report.close"));
    for (const element of backdrop.querySelectorAll("[data-t]")) {
      element.textContent = t(element.dataset["t"]);
    }
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
            target.textContent = t("report.copied");
            window.setTimeout(() => target.textContent = t("report.copy"), 1500);
          },
          () => {
            const range = document.createRange();
            range.selectNodeContents(body);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            target.textContent = t("report.selected");
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
    const place2 = (rect2) => {
      current = rect2;
      layer.style.left = `${rect2.left}px`;
      layer.style.top = `${rect2.top}px`;
      layer.style.width = `${rect2.width}px`;
      layer.style.height = `${rect2.height}px`;
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
      const rect2 = options.rect();
      if (!rect2) {
        closeTool();
        return false;
      }
      place2(rect2);
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
      const row2 = document.createElement("div");
      row2.className = "lt-bar-buttons";
      for (const button2 of content.buttons ?? []) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = button2.primary ? "lt-btn lt-primary" : "lt-btn";
        element.innerHTML = button2.icon ? icon(button2.icon, 16) : "";
        element.append(button2.label);
        element.disabled = button2.disabled === true;
        element.addEventListener("click", () => button2.run());
        row2.appendChild(element);
      }
      const close2 = document.createElement("button");
      close2.type = "button";
      close2.className = "lt-btn lt-ghost lt-square";
      close2.setAttribute("aria-label", t("tool.close"));
      close2.innerHTML = icon("close", 16);
      close2.addEventListener("click", closeTool);
      row2.appendChild(close2);
      bar.appendChild(row2);
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
      if (!frame2 || !box) return;
      const rect2 = boxToRect(box, frame2.size());
      selection.style.left = `${rect2.left}px`;
      selection.style.top = `${rect2.top}px`;
      selection.style.width = `${rect2.width}px`;
      selection.style.height = `${rect2.height}px`;
    };
    const frame2 = openFrame(options, "region", draw);
    if (!frame2) return false;
    frame2.layer.appendChild(selection);
    const idle = () => {
      frame2.setBar({ text: t("tool.regionIdle") });
    };
    const chosen = () => {
      const chosenBox = box;
      if (!chosenBox) return;
      const input = frame2.setBar({
        text: t("tool.regionChosen"),
        input: { placeholder: t("tool.regionQuestion") },
        buttons: [
          {
            label: t("tool.search"),
            icon: "search",
            primary: true,
            run: () => send("visual")
          },
          { label: t("tool.askAi"), icon: "sparkles", run: () => send("ai") }
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
    const pictureOnScreen = () => frame2.size();
    frame2.layer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (!frame2.refresh()) return;
      event.preventDefault();
      start2 = { x: event.clientX, y: event.clientY };
      before = box;
      try {
        frame2.layer.setPointerCapture(event.pointerId);
      } catch {
      }
    });
    frame2.layer.addEventListener("pointermove", (event) => {
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
    frame2.layer.addEventListener("pointerup", finish);
    frame2.layer.addEventListener("pointercancel", () => {
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
      if (!frame2) return;
      const size = frame2.size();
      for (const { object, dot, outline } of dots) {
        if (!object.geometry) continue;
        const centre = centreOf(object.geometry, size);
        dot.style.left = `${centre.x}px`;
        dot.style.top = `${centre.y}px`;
        const rect2 = boxToRect(object.geometry, size);
        outline.style.left = `${rect2.left}px`;
        outline.style.top = `${rect2.top}px`;
        outline.style.width = `${rect2.width}px`;
        outline.style.height = `${rect2.height}px`;
      }
    };
    const frame2 = openFrame(options, "objects", layout);
    if (!frame2) return false;
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
      frame2.setBar({ text: text2, busy: true });
      void options.load().then((source) => {
        if (active !== mine) return;
        if (!source) return closeTool();
        const list = source.objects;
        const found = list.filter((object) => object.geometry);
        if (!found.length) {
          frame2.setBar({ text: t("tool.noObjects") });
          return void 0;
        }
        found.forEach((object, index) => {
          const outline = document.createElement("div");
          outline.className = "lt-objbox";
          const dot = document.createElement("button");
          dot.type = "button";
          dot.className = "lt-dot";
          dot.setAttribute("aria-label", t("tool.objectLabel", { n: index + 1 }));
          dot.addEventListener("click", () => {
            if (!objectsStillValid(source, list)) {
              show(t("tool.objectsAgain"));
              return;
            }
            closeTool();
            options.onPick(source, object.id);
          });
          frame2.layer.append(dot, outline);
          dots.push({ object, dot, outline });
        });
        layout();
        frame2.setBar({ text: t("tool.objectsHint", { count: found.length }) });
        return void 0;
      });
    };
    show(t("tool.objectsLooking"));
    return true;
  }
  function openTextTool(options) {
    let items = pickables([]);
    const picked = /* @__PURE__ */ new Set();
    const words = [];
    const layout = () => {
      if (!frame2) return;
      const size = frame2.size();
      items.forEach((item, index) => {
        const element = words[index];
        if (!element) return;
        const rect2 = boxToRect(item.geometry, size);
        element.style.left = `${rect2.left}px`;
        element.style.top = `${rect2.top}px`;
        element.style.width = `${rect2.width}px`;
        element.style.height = `${rect2.height}px`;
        element.style.transform = item.geometry.angle ? `rotate(${item.geometry.angle}deg)` : "";
      });
    };
    const frame2 = openFrame(options, "text", layout);
    if (!frame2) return false;
    frame2.setBar({ text: t("tool.reading"), busy: true });
    const mine = active;
    const bar = () => {
      const text2 = joinPicked(items, picked);
      frame2.setBar({
        text: picked.size ? text2 : t("tool.wordsHint"),
        buttons: [
          {
            label: picked.size === items.length ? t("tool.none") : t("tool.all"),
            run: () => {
              const all2 = picked.size !== items.length;
              items.forEach((_, index) => set(index, all2));
              bar();
            }
          },
          { label: t("tool.copy"), icon: "copy", disabled: !picked.size, run: () => options.onCopy(text2) },
          {
            label: t("tool.search"),
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
    frame2.layer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const index = wordAt(event.clientX, event.clientY);
      if (index < 0) return;
      event.preventDefault();
      painting = !picked.has(index);
      set(index, painting);
      try {
        frame2.layer.setPointerCapture(event.pointerId);
      } catch {
      }
    });
    frame2.layer.addEventListener("pointermove", (event) => {
      if (painting === null) return;
      const index = wordAt(event.clientX, event.clientY);
      if (index >= 0) set(index, painting);
    });
    for (const type of ["pointerup", "pointercancel"]) {
      frame2.layer.addEventListener(type, () => {
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
        frame2.setBar({ text: t("tool.noText") });
        return void 0;
      }
      for (const item of items) {
        const element = document.createElement("div");
        element.className = "lt-word";
        element.title = item.text;
        frame2.layer.appendChild(element);
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
    if (storageReady()) useLanguage(settings.language);
    let site = siteMode();
    const active2 = () => settings.enabled && site !== "off";
    setTransport(gmTransport);
    ignoreElements((element) => element.id === HOST_ID || isCover(element));
    const root = uiRoot();
    const controls2 = document.createElement("div");
    controls2.id = "lt-controls";
    root.appendChild(controls2);
    function control(id, label, content) {
      const element = document.createElement("div");
      element.id = id;
      element.innerHTML = content;
      element.title = label;
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", label);
      return element;
    }
    let button2 = document.createElement("div");
    let translateControl = null;
    let menuControl = button2;
    const markTranslated = (on) => {
      translateControl?.classList.toggle("lt-active", on);
    };
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
        const close2 = document.createElement("button");
        close2.type = "button";
        close2.className = "lt-btn lt-ghost lt-square";
        close2.setAttribute("aria-label", t("toast.dismiss"));
        close2.innerHTML = icon("close", 16);
        close2.addEventListener("click", hideToast);
        if (link.copy) {
          const address = document.createElement("span");
          address.className = "lt-url";
          address.textContent = link.href;
          text2.appendChild(address);
          const copy = document.createElement("button");
          copy.type = "button";
          copy.className = "lt-btn";
          copy.innerHTML = icon("copy", 16);
          copy.append(t("toast.copy"));
          copy.addEventListener("click", () => {
            void copyText(link.href).then((done) => {
              if (done) toast(t("toast.addressCopied"));
              else toast(t("toast.addressNotCopied"), 0, link);
            });
          });
          toastEl.append(anchor, copy, close2);
        } else {
          toastEl.append(anchor, close2);
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
      if (currentTarget?.element === img) markTranslated(false);
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
      drawnAs.delete(img);
      const restored = uncoverImage(img) || clearOverlay(img);
      if (restored) markTranslated(false);
      return restored;
    }
    const results = /* @__PURE__ */ new WeakMap();
    let lastShown = null;
    let working = 0;
    function setWorking(delta) {
      working += delta;
      button2.classList.toggle("lt-busy", working > 0);
    }
    let lastFailure = "";
    async function translate(target, options = {}) {
      const img = target.element;
      const say = (message, ms) => {
        if (!options.quiet) toast(message, ms);
      };
      if (busy.has(img)) return "skipped";
      if (options.auto) {
        if (isTranslated(img)) return "skipped";
        if (!autoWorthy(target)) return "deferred";
      }
      if (!settings.enabled) {
        say(t("toast.off"));
        return "skipped";
      }
      if (site === "off") {
        say(t("toast.siteOffHint", { host: hostOf() }));
        return "skipped";
      }
      if (undo(img)) return "undone";
      busy.add(img);
      setWorking(1);
      button2.classList.remove("lt-error");
      try {
        const key = cacheKey(target.url, settings);
        const displayedWidth = img.getBoundingClientRect().width;
        if (settings.renderMode === "canvas" && target.url && target.kind !== "background") {
          const natural = naturalSizeOf(target);
          const answered2 = getCached(key, settings, natural);
          const done = getRender(renderKey(key, settings, displayedWidth, answered2?.edits), settings, natural);
          if (done && natural && coverWith(target, done, natural)) {
            shown2(img, target, answered2);
            drawnAs.set(img, { blob: done, ...natural });
            return "shown";
          }
        }
        const prepared = await acquireSource(target);
        try {
          const size = { width: prepared.width, height: prepared.height };
          let result = target.url ? getCached(key, settings, size) : void 0;
          const identity = result ? null : identify(prepared.source, prepared.width, prepared.height);
          const tag = tilingTag(prepared.width, prepared.height, settings);
          const hash = identity?.hash ? identity.hash + tag : "";
          let near;
          if (identity?.face) {
            const sent = tag ? prepared : targetSize(prepared.width, prepared.height, settings);
            const source = prepared.source;
            near = {
              face: identity.face,
              tag,
              size: Math.max(sent.width, sent.height),
              width: prepared.width,
              height: prepared.height,
              sample: (boxes) => markStrips(source, prepared.width, prepared.height, boxes)
            };
          }
          if (!result && hash) {
            const remembered = await getStored(hash, settings, near);
            if (remembered) {
              result = remembered;
              if (target.url) putCached(key, result, settings, size);
            }
          }
          if (!result && options.auto) {
            if (settings.autoTextCheck && !await mayHaveText(prepared.source, prepared.width, prepared.height)) {
              return "empty";
            }
            const wait = takeRequest();
            if (wait > 0) {
              autoRetryIn(wait);
              return "deferred";
            }
          }
          if (!result) {
            result = await askLens(prepared.source, settings);
            if (target.url) putCached(key, result, settings, size);
            void putStored(hash, result, settings, near);
          }
          if (!result.blocks.length) {
            const detected = result.ocr.some((p) => p.lines.length > 0);
            results.set(img, result);
            say(
              detected ? t("toast.noTranslation") : t("toast.noText")
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
              displayedWidth,
              result.edits
            );
            if (target.url) {
              putRender(renderKey(key, settings, displayedWidth, result.edits), blob, settings, size);
            }
            const covered = coverWith(target, blob, size);
            if (covered) drawnAs.set(img, { blob, ...size });
            if (!covered) {
              lastFailure = target.kind === "background" ? t("toast.backgroundTiled") : t("toast.cannotCover");
              say(lastFailure);
              return "failed";
            }
          } else if (target.kind === "background") {
            lastFailure = t("toast.backgroundNeedsCanvas");
            say(lastFailure);
            return "failed";
          } else if (!renderTranslation(
            img,
            result.blocks,
            settings,
            { width: prepared.width, height: prepared.height },
            root,
            { onGone: forgetter(img), ...seeThrough() }
          )) {
            lastFailure = t("toast.nothingPlaced");
            say(lastFailure);
            return "failed";
          }
          shown2(img, target, result);
          return "shown";
        } finally {
          prepared.release();
        }
      } catch (error) {
        lastFailure = error.message;
        button2.classList.add("lt-error");
        say(t("toast.lensError", { message: lastFailure }), 5e3);
        window.setTimeout(() => button2.classList.remove("lt-error"), 3e3);
        return "failed";
      } finally {
        busy.delete(img);
        setWorking(-1);
      }
    }
    const drawnAs = /* @__PURE__ */ new WeakMap();
    function coverWith(target, blob, natural) {
      return coverImage(target.element, URL.createObjectURL(blob), {
        onGone: forgetter(target.element),
        ...seeThrough(),
        ...target.background ? { background: { spec: target.background, natural } } : {}
      });
    }
    function shown2(img, target, result) {
      showing.set(img, target);
      if (result) results.set(img, result);
      lastShown = new WeakRef(img);
      if (currentTarget?.element === img) markTranslated(true);
    }
    function seeThrough() {
      const percent = Math.min(100, Math.max(20, Number(settings.coverOpacity) || 100));
      return percent < 100 ? { opacity: percent / 100 } : {};
    }
    const concurrency = () => Math.min(6, Math.max(1, Math.round(settings.concurrency) || 2));
    const queued = [];
    let running = 0;
    function pump() {
      while (running < concurrency()) {
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
      const parts = [t("toast.batchDone", { shown: tally.shown, total: total2 })];
      if (tally.empty) parts.push(t("toast.batchEmpty", { count: tally.empty }));
      if (tally.failed) parts.push(t("toast.batchFailed", { count: tally.failed, reason: lastFailure }));
      return parts.join("; ");
    }
    async function translateVisible() {
      if (!settings.enabled || site === "off") {
        toast(
          site === "off" ? t("toast.siteOff", { host: hostOf() }) : t("toast.off")
        );
        return;
      }
      const targets2 = untranslatedInView(collect$1(settings.minImageSize));
      if (!targets2.length) {
        toast(t("toast.nothingLeft"));
        return;
      }
      toast(t("toast.batchStart", { count: targets2.length }), 12e4);
      toast(summarise(await translateAll(targets2), targets2.length), 5e3);
    }
    const autoOn = () => site === "auto" || site === "default" && settings.autoTranslate;
    const autoTried = /* @__PURE__ */ new WeakMap();
    let lastAutoComplaint = 0;
    function autoWorthy(target) {
      if (target.kind === "video" || !target.element.isConnected) return false;
      if (isTranslated(target.element) || busy.has(target.element)) return false;
      if (!isBigEnough(target, settings.minImageSize) || onVideo(target)) return false;
      const rect2 = target.element.getBoundingClientRect();
      if (Math.min(rect2.width, rect2.height) < settings.autoMinPx) return false;
      const part = visiblePart(target.element);
      const whole = Math.min(rect2.width * rect2.height, window.innerWidth * window.innerHeight);
      return whole > 0 && part.width * part.height >= settings.autoVisible * whole;
    }
    let requestTokens = -1;
    let requestsAt = 0;
    function takeRequest() {
      const capacity = Math.max(1, Math.round(settings.autoPerMinute) || 1);
      const perMs = capacity / 6e4;
      const now = Date.now();
      requestTokens = requestTokens < 0 ? capacity : Math.min(capacity, requestTokens + (now - requestsAt) * perMs);
      requestsAt = now;
      if (requestTokens >= 1) {
        requestTokens -= 1;
        return 0;
      }
      return Math.ceil((1 - requestTokens) / perMs);
    }
    let autoRetry = 0;
    let autoRetryAt = 0;
    function autoRetryIn(ms) {
      const at = Date.now() + ms;
      if (autoRetry && autoRetryAt <= at) return;
      window.clearTimeout(autoRetry);
      autoRetryAt = at;
      autoRetry = window.setTimeout(() => {
        autoRetry = 0;
        scheduleAuto();
      }, ms + 50);
    }
    function autoTranslate() {
      if (!autoOn() || !active2()) return;
      const area = (target) => {
        const part = visiblePart(target.element);
        return part.width * part.height;
      };
      const targets2 = known.filter((target) => autoTried.get(target.element) !== target.url && autoWorthy(target)).sort((a, b) => area(b) - area(a));
      if (!targets2.length) return;
      for (const target of targets2) autoTried.set(target.element, target.url);
      let failed2 = 0;
      void Promise.all(
        targets2.map(
          (target) => schedule(async () => {
            const outcome = await translate(target, { quiet: true, auto: true });
            if (outcome === "deferred") autoTried.delete(target.element);
            else if (outcome === "failed") failed2 += 1;
          })
        )
      ).then(() => {
        if (failed2 && Date.now() - lastAutoComplaint > 3e4) {
          lastAutoComplaint = Date.now();
          toast(t("toast.autoFailed", { count: failed2, reason: lastFailure }), 5e3);
        }
      });
    }
    const AUTO_SETTLE_MS = 350;
    const AUTO_MAX_WAIT_MS = 1200;
    let autoTimer = 0;
    let autoSince = 0;
    function scheduleAuto() {
      if (!autoOn()) return;
      const now = Date.now();
      if (!autoTimer) autoSince = now;
      window.clearTimeout(autoTimer);
      const wait = Math.max(0, Math.min(AUTO_SETTLE_MS, autoSince + AUTO_MAX_WAIT_MS - now));
      autoTimer = window.setTimeout(() => {
        autoTimer = 0;
        autoTranslate();
      }, wait);
    }
    let currentTarget = null;
    let hideTimer;
    let gearTimer;
    let extrasShown = false;
    function showGear() {
      extrasShown = true;
      controls2.classList.add("lt-extras");
    }
    function hideGear() {
      window.clearTimeout(gearTimer);
      extrasShown = false;
      controls2.classList.remove("lt-extras");
    }
    function visibleViewport() {
      const visual = window.visualViewport;
      if (visual && visual.width > 0 && visual.height > 0) {
        return { left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height };
      }
      return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }
    function placeControls(rect2) {
      const view = visibleViewport();
      const margin = 4;
      const gap = Number.parseFloat(getComputedStyle(controls2).columnGap) || 0;
      const widths = [...controls2.children].map((child) => child.offsetWidth);
      const width = Math.ceil(wrapWidth(widths, gap, view.width - margin * 2)) + 1;
      controls2.style.width = `${width}px`;
      const at = placeRow(
        settings.buttonCorner,
        rect2,
        { width, height: controls2.offsetHeight },
        view,
        margin,
        6
      );
      controls2.style.left = `${at.x}px`;
      controls2.style.top = `${at.y}px`;
    }
    function onVideo(target) {
      if (target.kind === "video") return true;
      const videos = document.getElementsByTagName("video");
      if (!videos.length) return false;
      const box = target.element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const area = box.width * box.height;
      for (const video of videos) {
        const r = video.getBoundingClientRect();
        if (r.width * r.height < area * 0.8) continue;
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
      }
      return false;
    }
    const offersButton = (target) => settings.showButton && site !== "off" && (settings.videoButton || !onVideo(target));
    function showButton(target, anchor) {
      if (!offersButton(target)) return;
      const img = target.element;
      currentTarget = target;
      const rect2 = anchor ?? img.getBoundingClientRect();
      placeControls(rect2);
      controls2.classList.add("lt-on");
      markTranslated(isTranslated(img));
      window.clearTimeout(gearTimer);
      if (!extrasShown) {
        const wait = Math.max(0, Number(settings.extrasDelayMs) || 0);
        if (wait === 0) showGear();
        else gearTimer = window.setTimeout(showGear, wait);
      }
    }
    function hideButton() {
      controls2.classList.remove("lt-on");
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
      const rect2 = element.getBoundingClientRect();
      const left = Math.max(rect2.left, 0);
      const top = Math.max(rect2.top, 0);
      const width = Math.min(rect2.right, window.innerWidth) - left;
      const height = Math.min(rect2.bottom, window.innerHeight) - top;
      return { top, left, width: Math.max(0, width), height: Math.max(0, height) };
    }
    function mostVisible() {
      let best = null;
      let bestArea = 0;
      let bestRank = -1;
      for (const target of known) {
        if (!target.element.isConnected) continue;
        if (!isBigEnough(target, settings.minImageSize)) continue;
        if (!settings.videoButton && onVideo(target)) continue;
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
      const wanted = pinned || autoOn();
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
          hideTimer = window.setTimeout(hideButton, hideDelay());
        }
      },
      true
    );
    const hideDelay = () => Math.max(0, Number(settings.hideDelayMs) || 0);
    controls2.addEventListener("mouseover", () => window.clearTimeout(hideTimer));
    controls2.addEventListener("mouseout", () => {
      if (pinned) return;
      hideTimer = window.setTimeout(hideButton, hideDelay());
    });
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
      openSettings({ onSaved, site: () => site, setSite: (mode) => chooseSite(mode, true) });
    }
    function onSaved(saved) {
      settings = saved;
      useLanguage(settings.language);
      applySettings();
      applyButtonMode();
      scheduleAuto();
      void redrawShowing();
      toast(t("toast.saved"));
    }
    const REPEATABLE = ["translate", "search", "ask", "area", "objects", "text", "copy"];
    function mainButton() {
      const last = getState().lastAction;
      return settings.repeatLast && REPEATABLE.includes(last) ? last : settings.mainAction;
    }
    function question() {
      return settings.rememberQuestion && getState().lastQuestion || settings.aiPrompt;
    }
    function runAction(id, target, origin, text2) {
      if ((origin === "menu" || origin === "row") && REPEATABLE.includes(id)) {
        const before = mainButton();
        setState({ lastAction: id });
        if (mainButton() !== before) buildControls();
      }
      switch (id) {
        case "translate":
          void translate(target);
          break;
        case "search":
          searchPicture(target, { kind: "image" }, "visual", "");
          break;
        case "ask": {
          const asked = (text2 ?? question()).trim();
          if (text2 !== void 0 && asked) setState({ lastQuestion: asked });
          searchPicture(target, { kind: "image" }, "ai", asked);
          break;
        }
        case "area":
          void selectArea(target);
          break;
        case "objects":
          void showObjects(target);
          break;
        case "text":
          void pickText(target);
          break;
        case "copy":
          void copyAny(target);
          break;
        case "edit":
          void editPicture(target);
          break;
        case "settings":
          showSettings();
          break;
        case "menu":
          openActions(target);
          break;
      }
    }
    function pressed(id, isMain, event) {
      event.preventDefault();
      event.stopPropagation();
      if (isMain && swallowClick) {
        swallowClick = false;
        return;
      }
      if (id === "settings") return showSettings();
      if (id === "menu") {
        if (isMenuOpen()) closeMenu();
        else openActions();
        return void 0;
      }
      if (currentTarget) runAction(id, currentTarget, isMain ? "main" : "row");
      return void 0;
    }
    function buildControls() {
      endHold();
      const main = mainButton();
      const ids = rowOf(parseButtons(settings.buttons), main);
      controls2.textContent = "";
      controls2.dataset["corner"] = settings.buttonCorner;
      controls2.dataset["size"] = settings.buttonSize;
      const idle = Math.min(100, Math.max(20, Number(settings.idleOpacity) || 100));
      controls2.style.setProperty("--lt-idle", String(idle / 100));
      translateControl = null;
      let menuFound = null;
      for (const id of ids) {
        const isMain = id === main;
        const label = id === "translate" ? t("btn.translate") : id === "settings" ? t("btn.settings") : id === "menu" ? t("btn.more") : t(`act.${id}`);
        const element = control(
          isMain ? "lt-button" : id === "settings" ? "lt-gear" : id === "menu" ? "lt-more" : `lt-act-${id}`,
          label,
          // The spinner is a second icon rather than the first one turning:
          // letters going round do not read as "working".
          isMain ? icon(BUTTON_ICONS[id]) + icon("loader") : icon(BUTTON_ICONS[id], 16)
        );
        element.className = isMain ? "lt-ctl lt-main" : "lt-ctl";
        element.dataset["action"] = id;
        if (settings.buttonLabels) {
          const words = document.createElement("span");
          words.className = "lt-ctl-label";
          words.textContent = t(`act.${id}`);
          element.appendChild(words);
          element.classList.add("lt-labelled");
        }
        element.addEventListener("click", (event) => pressed(id, isMain, event), true);
        if (id === "translate") translateControl = element;
        if (id === "menu") menuFound = element;
        if (isMain) {
          button2 = element;
          element.addEventListener("pointerdown", startHold);
          for (const type of ["pointerup", "pointercancel"]) element.addEventListener(type, endHold);
          element.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const held = holding !== null || swallowClick;
            window.clearTimeout(holdTimer);
            if (!held) openActions();
          });
        }
        controls2.appendChild(element);
      }
      menuControl = menuFound ?? button2;
      button2.classList.toggle("lt-busy", working > 0);
      if (currentTarget) markTranslated(isTranslated(currentTarget.element));
      if (controls2.classList.contains("lt-on")) reposition();
    }
    function applySettings() {
      buildControls();
      bindKeys();
    }
    document.addEventListener(
      "click",
      (event) => {
        const modifier = settings.hotkey;
        if (modifier === "none") return;
        const pressed2 = modifier === "alt" && event.altKey || modifier === "ctrl" && event.ctrlKey || modifier === "shift" && event.shiftKey;
        if (!pressed2) return;
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
        toast(t("toast.translateFirst"));
        return;
      }
      const text2 = kind === "translation" ? translationText(result) : ocrText(result);
      if (!text2) {
        toast(t("toast.nothingToCopy"));
        return;
      }
      await copied(text2, kind === "translation" ? "toast.copiedTranslation" : "toast.copiedOriginal");
    }
    async function atOwnSize(drawn) {
      const bitmap = await createImageBitmap(drawn.blob);
      try {
        if (bitmap.width <= drawn.width) return drawn.blob;
        const canvas = document.createElement("canvas");
        canvas.width = drawn.width;
        canvas.height = drawn.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return drawn.blob;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, drawn.width, drawn.height);
        const small = await new Promise((resolve2) => canvas.toBlob(resolve2, "image/png"));
        return small ?? drawn.blob;
      } finally {
        bitmap.close();
      }
    }
    function pictureName(target) {
      let base = "";
      try {
        base = new URL(target.url).pathname.split("/").pop() ?? "";
      } catch {
      }
      base = base.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 60);
      return `${base ? base + "-" : ""}translated.png`;
    }
    function copyPicture(picture, name) {
      let write;
      try {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("no clipboard");
        write = navigator.clipboard.write([new ClipboardItem({ "image/png": picture })]);
      } catch (error) {
        write = Promise.reject(error);
      }
      write.then(
        () => toast(t("toast.copiedPicture")),
        () => void picture.then(
          (blob) => {
            downloadPicture(blob, name);
            toast(t("toast.pictureSavedInstead"), 4e3);
          },
          (error) => failed(error)
        )
      );
    }
    function downloadPicture(blob, name) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.rel = "noopener";
      uiRoot().appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 6e4);
    }
    async function savePicture(blob, name) {
      const file = new File([blob], name, { type: "image/png" });
      if (isCompact() && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (error) {
          if (error.name === "AbortError") return;
        }
      }
      downloadPicture(blob, name);
    }
    function copyShown(target) {
      const drawn = drawnAs.get(target.element);
      if (!drawn) {
        toast(t("toast.pictureFirst"));
        return;
      }
      copyPicture(atOwnSize(drawn), pictureName(target));
    }
    function saveShown(target) {
      const drawn = drawnAs.get(target.element);
      if (!drawn) {
        toast(t("toast.pictureFirst"));
        return;
      }
      void atOwnSize(drawn).then((blob) => savePicture(blob, pictureName(target)), failed);
    }
    async function editPicture(target) {
      const img = target.element;
      const result = results.get(img);
      if (!drawnAs.has(img) || !result?.blocks.length) {
        toast(t("toast.pictureFirst"));
        return;
      }
      closeTool();
      closeMenu();
      hideToast();
      let prepared;
      try {
        prepared = await acquireSource(target);
      } catch (error) {
        failed(error);
        return;
      }
      const drawWith = settings;
      const displayedWidth = img.getBoundingClientRect().width || prepared.width;
      const size = { width: prepared.width, height: prepared.height };
      const draw = (edits) => renderToBlob(prepared.source, prepared.width, prepared.height, result.blocks, drawWith, displayedWidth, edits);
      const name = pictureName(target);
      openEditor({
        blocks: result.blocks,
        edits: result.edits,
        render: draw,
        copy: (picture) => copyPicture(picture.then((blob) => atOwnSize({ blob, ...size })), name),
        save: (blob) => void atOwnSize({ blob, ...size }).then((own) => savePicture(own, name), failed),
        apply: (edits) => {
          if (edits) result.edits = edits;
          else delete result.edits;
          void putEdits(result);
          void draw(result.edits).then((blob) => {
            if (!img.isConnected) return;
            if (target.url && target.kind !== "background") {
              putRender(renderKey(cacheKey(target.url, drawWith), drawWith, displayedWidth, result.edits), blob, drawWith, size);
            }
            if (coverWith(target, blob, size)) {
              drawnAs.set(img, { blob, ...size });
              shown2(img, target, result);
            }
          }, failed);
        },
        closed: () => prepared.release()
      });
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
      uiLanguage: settings.searchLang || settings.targetLang,
      dark: settings.searchTheme === "auto" ? prefersDark() : settings.searchTheme === "dark"
    });
    const tabFor = (preopen) => prepareTab(preopen, { background: settings.backgroundTabs, waiting: t("toast.searching") });
    function deliver(tab, url) {
      if (tab.go(url)) toast(t("toast.opened"), 9e3, { href: url, label: t("toast.openAgain") });
      else if (framed) toast(t("toast.ready"), 0, { href: url, label: t("toast.open"), copy: true });
      else toast(t("toast.ready"), 0, { href: url, label: t("toast.openResults") });
    }
    function searchPicture(target, pick, mode, text2, held) {
      if (!stillShows(target)) {
        closeTool();
        toast(t("toast.changed"));
        return;
      }
      const tab = tabFor(!onTouch());
      setWorking(1);
      button2.classList.remove("lt-error");
      toast(mode === "ai" ? t("toast.asking") : t("toast.searching"), 12e4);
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
          button2.classList.add("lt-error");
          toast(lensSaid(error), 5e3);
          window.setTimeout(() => button2.classList.remove("lt-error"), 3e3);
        }
      ).finally(() => setWorking(-1));
    }
    function openNow(url) {
      deliver(tabFor(true), url);
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
        toast(t("toast.cannotMeasure"));
        return null;
      }
      return () => pictureRect(target, natural);
    }
    function failed(error) {
      lastFailure = error.message;
      toast(lensSaid(error), 5e3);
      return null;
    }
    const lensSaid = (error) => error.message === CHANGED ? t("toast.changed") : t("toast.lensError", { message: error.message });
    async function selectArea(target) {
      const rect2 = await frameOf(target);
      if (!rect2) return;
      openRegionTool({
        rect: rect2,
        onSearch: (box, mode, text2) => searchPicture(target, { kind: "region", box }, mode, text2)
      });
    }
    async function showObjects(target) {
      const rect2 = await frameOf(target);
      if (!rect2) return;
      openObjectsTool({
        rect: rect2,
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
      const rect2 = await frameOf(target);
      if (!rect2) return;
      openTextTool({
        rect: rect2,
        paragraphs: readText(target).then((paragraphs) => paragraphs, failed),
        onSearch: (text2) => openNow(textSearchUrl(text2, pageOptions())),
        onCopy: (text2) => void copied(text2, "toast.copiedText")
      });
    }
    async function copied(text2, done) {
      toast(await copyText(text2) ? t(done, { count: text2.length }) : t("toast.clipboardDenied"));
    }
    async function copyAny(target) {
      const result = results.get(target.element);
      const translated = result ? translationText(result) : "";
      if (translated) return copied(translated, "toast.copiedTranslation");
      let text2 = result ? ocrText(result) : "";
      if (!text2) {
        toast(t("toast.reading"), 12e4);
        try {
          text2 = (await readText(target)).map((paragraph) => paragraph.lines.map((line2) => line2.text.trim()).filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
        } catch (error) {
          failed(error);
          return void 0;
        }
      }
      if (!text2) {
        toast(t("toast.noText"));
        return void 0;
      }
      return copied(text2, "toast.copiedText");
    }
    function openActions(target = currentTarget) {
      if (!target) return;
      closeTool();
      hideToast();
      const translated = isTranslated(target.element);
      const words = results.has(target.element);
      const pro = settings.uiMode === "pro";
      const items = [];
      let lastKind = "";
      const add = (kind, item) => {
        items.push(lastKind && kind !== lastKind ? { ...item, divider: true } : item);
        lastKind = kind;
      };
      const act = (id) => () => runAction(id, target, "menu");
      for (const { id } of parseButtons(settings.buttons)) {
        if (id === "translate") {
          add("core", {
            id,
            label: translated ? t("menu.original") : t("menu.translate"),
            icon: translated ? "undo" : "translate",
            run: act(id)
          });
        } else if (id === "search") {
          add("core", { id, label: t("menu.search"), icon: "search", run: act(id) });
        } else if (id === "ask") {
          add("core", {
            id,
            label: t("menu.ask"),
            icon: "sparkles",
            run: () => {
            },
            field: {
              value: question(),
              placeholder: t("menu.askPlaceholder"),
              sendLabel: t("menu.askSend"),
              submit: (text2) => runAction("ask", target, "menu", text2)
            }
          });
        } else if (id === "area" && pro) {
          add("tools", { id, label: t("menu.area"), icon: "area", run: act(id) });
        } else if (id === "objects" && pro) {
          add("tools", { id, label: t("menu.objects"), icon: "objects", run: act(id) });
        } else if (id === "text" && pro) {
          add("tools", { id, label: t("menu.text"), icon: "text", run: act(id) });
        } else if (id === "edit") {
          if (drawnAs.has(target.element)) {
            add("picture", { id, label: t("menu.edit"), icon: "edit", run: act(id) });
            add("picture", { id: "copyPicture", label: t("menu.copyPicture"), icon: "images", run: () => copyShown(target) });
            add("picture", { id: "savePicture", label: t("menu.savePicture"), icon: "download", run: () => saveShown(target) });
          }
        } else if (id === "copy" && pro) {
          add("copy", {
            id: "copyTranslation",
            label: t("menu.copyTranslation"),
            icon: "copy",
            run: () => void copyFrom("translation", target.element),
            disabled: !words
          });
          add("copy", {
            id: "copyOriginal",
            label: t("menu.copyOriginal"),
            icon: "copy",
            run: () => void copyFrom("original", target.element),
            disabled: !words
          });
        } else if (id === "copy") {
          add("copy", {
            id,
            label: translated ? t("menu.copyTranslation") : t("menu.copyText"),
            icon: "copy",
            run: act(id)
          });
        }
      }
      if (pro) {
        add(lastKind === "copy" ? "copy" : "all", {
          id: "all",
          label: t("menu.all"),
          icon: "images",
          run: () => void translateVisible()
        });
      }
      add("settings", { id: "settings", label: t("menu.settings"), icon: "settings", run: () => showSettings() });
      const rect2 = menuControl.getBoundingClientRect();
      const onLeft = settings.buttonCorner === "tl" || settings.buttonCorner === "bl";
      openMenu({ top: rect2.bottom + 6, left: onLeft ? rect2.left : rect2.right - 260 }, items, menuControl);
    }
    const peek = (element, peeking) => peekCover(element, peeking) || peekOverlay(element, peeking);
    let holdTimer = 0;
    let holding = null;
    let swallowClick = false;
    function startHold(event) {
      const action = settings.longPressAction;
      if (event.button !== 0 || !currentTarget || action === "none") return;
      const target = currentTarget;
      const element = target.element;
      if (action === "peek" && !isTranslated(element)) return;
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(
        () => {
          swallowClick = true;
          if (action === "peek") {
            holding = element;
            peek(element, true);
            button2.classList.add("lt-peeking");
          } else runAction(action, target, "hold");
        },
        Math.min(2e3, Math.max(150, Number(settings.holdMs) || 350))
      );
      try {
        button2.setPointerCapture(event.pointerId);
      } catch {
      }
    }
    function endHold() {
      window.clearTimeout(holdTimer);
      if (holding) {
        peek(holding, false);
        holding = null;
        button2.classList.remove("lt-peeking");
      }
      window.setTimeout(() => {
        swallowClick = false;
      }, 0);
    }
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
    let chords = [];
    function pictureForKey() {
      if (currentTarget?.element.isConnected) return currentTarget;
      if (!watching) known = collect$1(settings.minImageSize);
      return mostVisible()?.target ?? null;
    }
    function bindKeys() {
      chords = [];
      const bind = (raw, run) => {
        const chord = parseChord(raw);
        if (chord) chords.push([chord, run]);
      };
      const onPicture = (id) => () => {
        const target = pictureForKey();
        if (target) runAction(id, target, "key");
        else toast(t("toast.noPicture"));
      };
      bind(settings.keyTranslateAll, () => void translateVisible());
      bind(settings.keyTranslate, onPicture("translate"));
      bind(settings.keySearch, onPicture("search"));
      bind(settings.keyAsk, onPicture("ask"));
      bind(settings.keyArea, onPicture("area"));
      bind(settings.keyCopy, onPicture("copy"));
      bind(settings.keyUndoAll, undoAll);
    }
    document.addEventListener(
      "keydown",
      (event) => {
        if (isTyping(event) || isOurs(event.composedPath()[0] ?? null)) return;
        if (site !== "off" && !event.repeat) {
          const hit = chords.find(([chord]) => matchesChord(chord, event));
          if (hit) {
            event.preventDefault();
            event.stopPropagation();
            hit[1]();
            return;
          }
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
    const addCommand = (command2) => registerCommand(command2, !framed);
    const command = (id, key, run, options = {}) => addCommand({
      id,
      menuLabel: `Lens Translate: ${t(key)}`,
      // The panel is where these are drawn, so it does not offer what it makes redundant.
      label: options.panel === false ? null : () => t(key),
      ...options.essential ? { essential: true } : {},
      run
    });
    function clearEverything() {
      const memory = cacheStats();
      clearCache();
      void storedStats().then(({ entries: entries2, bytes: bytes2 }) => {
        void clearStored();
        const total2 = memory.entries + entries2;
        toast(
          total2 ? t("toast.cleared", { count: total2, size: ((memory.bytes + bytes2) / 1048576).toFixed(1) }) : t("toast.cacheEmpty")
        );
      });
    }
    function undoAll() {
      showing.clear();
      const restored = uncoverAll() + clearAllOverlays();
      markTranslated(false);
      toast(restored ? t("toast.restored", { count: restored }) : t("toast.nothingToRestore"));
    }
    command("settings", "cmd.settings", () => showSettings(), { panel: false });
    command("clearCache", "cmd.clearCache", clearEverything);
    command("undoAll", "cmd.undoAll", undoAll, { essential: true });
    command("translateAll", "cmd.translateAll", () => void translateVisible());
    command("copyTranslation", "cmd.copyTranslation", () => void copyFrom("translation"), { panel: false });
    command("copyOriginal", "cmd.copyOriginal", () => void copyFrom("original"), { panel: false });
    function chooseSite(next, quiet = false) {
      site = next;
      setSiteMode(next);
      if (next === "off") {
        showing.clear();
        uncoverAll();
        clearAllOverlays();
        hideButton();
      }
      const started = syncWatchers();
      if (autoOn() && !started) refresh();
      if (quiet) return;
      const host2 = hostOf();
      toast(
        next === "off" ? t("toast.siteNowOff", { host: host2 }) : next === "auto" ? t("toast.siteNowAuto", { host: host2 }) : t("toast.siteNowDefault", { host: host2 })
      );
    }
    command("toggleSite", "cmd.toggleSite", () => chooseSite(site === "off" ? "default" : "off"), {
      essential: true
    });
    command("toggleAuto", "cmd.toggleAuto", () => chooseSite(site === "auto" ? "default" : "auto"));
    if (!framed) command("diagnostics", "cmd.diagnostics", openDiagnostics, { essential: true });
    command("toggle", "cmd.toggle", () => {
      settings = saveSettings({ enabled: !settings.enabled });
      if (!settings.enabled) {
        showing.clear();
        uncoverAll();
        clearAllOverlays();
        hideButton();
      }
      toast(settings.enabled ? t("toast.enabled") : t("toast.disabled"));
    });
    const DEBUG_HASH = "#lens-debug";
    function openDiagnostics() {
      openReport(t("report.probing"));
      void diagnose({ pinned }).then(
        openReport,
        (error) => openReport(t("report.failed", { message: error.message }))
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
    applySettings();
    onLocaleChange(buildControls);
    applyButtonMode();
    if (hovered) showButton(hovered);
    void preloadStored([...SETTINGS_KEYS, SITES_KEY, ...LOCALE_KEYS, STATE_KEY]).then((arrived) => {
      if (!arrived) return;
      settings = reloadSettings();
      reloadSites();
      reloadState();
      site = siteMode();
      useLanguage(settings.language);
      applyPopupOpacity(settings.popupOpacity);
      applyLook(settings.uiTheme, settings.uiAccent);
      applySettings();
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
      const rect2 = target.element.getBoundingClientRect();
      sizes.push({ width: rect2.width, height: rect2.height });
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
      if (await preloadStored([...SETTINGS_KEYS, SITES_KEY, ...LOCALE_KEYS])) {
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