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
        // The Lens endpoint is the only host this ever contacts. GM_xmlhttpRequest
        // is not subject to CORS, which is what lets the script stay serverless.
        connect: ['lensfrontend-pa.googleapis.com'],
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
