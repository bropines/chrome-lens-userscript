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
// @updateURL    https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.meta.js
// @match        *://*/*
// @connect      lensfrontend-pa.googleapis.com
// @connect      *
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==