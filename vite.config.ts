import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Lens Translate',
        namespace: 'https://github.com/bropines/chrome-lens-py',
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
        grant: [
          'GM_xmlhttpRequest',
          'GM_addStyle',
          'GM_getValue',
          'GM_setValue',
          'GM_registerMenuCommand',
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
