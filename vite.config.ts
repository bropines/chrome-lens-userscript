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
        updateURL:
          'https://github.com/bropines/chrome-lens-userscript/raw/main/dist/lens-translate.user.js',
        description:
          "Hover any image, click the button, and its text is translated in place - rendered the way Chromium's own Lens overlay does it.",
        author: 'bropines',
        license: 'MIT',
        match: ['*://*/*'],
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
          'GM_registerMenuCommand',
          'GM_info',
          'unsafeWindow',
        ],
        'run-at': 'document-idle',
        icon: 'https://lens.google.com/favicon.ico',
      },
      build: {
        fileName: 'lens-translate.user.js',
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
