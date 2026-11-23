/**
 * The version this bundle was built as.
 *
 * From `package.json` at build time (vite.config.ts defines it), not from
 * `GM_info`: a host is not obliged to publish that, and the translations are
 * fetched by this number - "unknown" is not a tag anyone can ask GitHub for.
 * Outside a build, in the tests, there is nothing to substitute and it is 'dev'.
 */
export const VERSION: string = typeof __LT_VERSION__ === 'string' ? __LT_VERSION__ : 'dev';
