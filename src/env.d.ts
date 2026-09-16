/// <reference types="vite/client" />
/// <reference types="vite-plugin-monkey/client" />

declare module '*.css?raw' {
  const content: string;
  export default content;
}
