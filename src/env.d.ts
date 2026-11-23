/// <reference types="vite/client" />
/// <reference types="vite-plugin-monkey/client" />

/** Substituted by the build with the version in package.json; absent under `bun test`. */
declare const __LT_VERSION__: string | undefined;

declare module '*.css?raw' {
  const content: string;
  export default content;
}
