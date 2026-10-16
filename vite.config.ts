import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Lens Translate',
        namespace: 'https://github.com/bropines/chrome-lens-userscript',
        homepage: 'https://github.com/bropines/chrome-lens-userscript',
        supportURL: 'https://github.com/bropines/chrome-lens-userscript/issues',
        downloadURL:
          'https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.user.js',
        // The managers poll this for the version number, so it points at the
        // metadata block alone: the full script is well over 100 kB, and
        // fetching it on every check to read one line is wasteful for them and
        // for the repo's raw endpoint. The download itself stays the full file.
        updateURL:
          'https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.meta.js',
        description:
          "Hover any image, click the button, and its text is translated in place - rendered the way Chromium's own Lens overlay does it.",
        author: 'bropines',
        license: 'MIT',
        match: ['*://*/*'],
        // Top frame only. Without this the script runs in every iframe on the
        // page, ads and embeds included, each paying for its own copy of a
        // 110 kB bundle, an observer and a shadow root - and offering a
        // translate button over an advertisement. The cost is a reader that
        // lives inside an iframe of its own: open the frame's address
        // directly, or use a manager that lets a script opt in per site.
        noframes: true,
        // Lens is the only host the script itself calls. The wildcard is for
        // image bytes: most images are read straight off the already-decoded
        // <img> element, but a cross-origin one served without CORS headers
        // taints the canvas and has to be re-fetched from wherever it lives,
        // which cannot be known ahead of time.
        connect: ['lensfrontend-pa.googleapis.com', '*'],
        // GM.xmlHttpRequest is the same call under its GM4 name, for a host
        // that publishes only that one; GM_registerMenuCommand is requested
        // even though AdGuard has no menu to put it in, because asking for a
        // grant a host does not implement is free and the script feature-tests
        // it anyway.
        grant: [
          'GM_xmlhttpRequest',
          'GM.xmlHttpRequest',
          'GM_getValue',
          'GM_setValue',
          // The promise-only spellings, for Greasemonkey 4 and Safari's
          // Userscripts, which publish nothing synchronous.
          'GM.getValue',
          'GM.setValue',
          // For "copy translation" and "copy original text".
          'GM_setClipboard',
          'GM.setClipboard',
          'GM_registerMenuCommand',
          'GM_info',
          'unsafeWindow',
        ],
        'run-at': 'document-idle',
        icon: 'https://lens.google.com/favicon.ico',
      },
      build: {
        fileName: 'lens-translate.user.js',
        // dist/lens-translate.meta.js: the same header with no code, which is
        // what updateURL above points at.
        metaFileName: true,
        // Everything is hand-rolled, so there is nothing to pull from a CDN.
        externalGlobals: {},
      },
    }),
  ],
  build: {
    // A userscript is read by humans reviewing what they install; keep it legible.
    minify: false,
    target: 'es2022',
  },
});
