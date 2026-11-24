# Interface language

The settings, menus and messages in your language, and how to add or fix a translation.

The interface is in English out of the box and can be in Russian, Ukrainian, German, Spanish, French, Brazilian Portuguese, Japanese, Simplified Chinese, Korean or Turkish. **Interface language** in settings is *Auto* (the browser's language, when there is a translation for it) or one of those by name.

Only English is inside the script. The others are JSON files in [`locales/`](../locales/), and **the script downloads the one it needs from GitHub**: one request to `raw.githubusercontent.com` per version and language - the file for the release's tag, or the one on `main` for a beta, which has no tag. It is then kept by the userscript host and not asked for again until the version changes. GitHub sees that request like any other - your IP address and user agent - and nothing else: it is sent without cookies and without a referrer, so it does not say who you are or which page you were on. The one exception is a host whose own request does not work at all (see the diagnostics): there the script falls back to an ordinary page request, as it does for Lens, and the browser adds the site's origin to it. With the language set to English, or a browser in English on *Auto*, no request is made at all. If it fails - offline, the domain blocked - the interface stays English and the next page load tries again.

What arrives is treated as somebody else's file: only known keys are used, a string whose `{placeholders}` do not match the English ones falls back to English, and every string is inserted as text, never as markup.

**To add or fix a translation:**

1. `bun run locales:check --template > locales/<code>.json` writes the English strings as a starting point (or copy an existing file).
2. Translate the values. Keep the keys, keep every `{placeholder}` exactly as written, and leave product names (Lens, Google, GitHub, Chromium) alone. Counts are deliberately written as "label: {count}" so no plural forms are needed.
3. For a new language, add its code to `LOCALES` in `src/i18n/locale.ts` - that is what puts it in the settings list.
4. `bun run locales:check` and `bun test` must pass: both refuse a file with a missing key, an extra key or a changed placeholder.

No rebuild is needed for a change to an existing locale; it reaches people when the next version is tagged.
