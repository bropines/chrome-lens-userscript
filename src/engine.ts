/**
 * The engine, as something other than this userscript can use.
 *
 * Everything reachable from here asks Lens and draws the answer, and nothing
 * reachable from here knows what a userscript is. No `$`, no `GM_*`, no
 * settings store, no shadow root, no button - those live above this line, in
 * `main.ts` and `ui/`, and the three imports that used to run the other way
 * (a detector reaching for our shadow host, a renderer drawing into it) are
 * now parameters the front end supplies.
 *
 * `scripts/check-layers.ts` is what keeps that true: it walks this module's
 * imports and fails the build if the closure reaches the application. A layer
 * nobody checks is a layer that lasts until the next convenient import.
 *
 * What a front end has to do, in order:
 *
 *   1. `setTransport(...)` - the privileged cross-origin POST is the one thing
 *      the engine cannot do for itself.
 *   2. `ignoreElements(...)` - if it draws anything over a picture, say so, or
 *      the detector will offer to translate it.
 *   3. `acquireSource` / `askLens` / `renderToBlob`, with options of its own.
 *      (`askLens` is `callLens` for a picture of any shape: a long strip is
 *      sent as tiles and comes back as one answer. `callLens` is one upload.)
 *
 * The options are split three ways on purpose. A caller that wants to draw a
 * picture should not have to invent a value for `hotkey`.
 */

export type {
  Alignment,
  BackgroundImage,
  Bytes,
  CacheOptions,
  DetectedObject,
  EngineOptions,
  Geometry,
  LensOptions,
  LensResult,
  NormalizedBox,
  OcrLine,
  OcrParagraph,
  OcrWord,
  PreparedImage,
  RenderOptions,
  TranslatedLine,
  TranslationBlock,
  VerticalTextMode,
  WritingDirection,
} from './types.js';

export type { BinaryRequest, BinaryResponse, GetOptions, Transport } from './transport.js';
export { getTransport, setTransport } from './transport.js';

export { LENS_ENDPOINT, callLens, fetchImageBlob } from './lens/client.js';
export { askLens } from './lens/ask.js';
export type { Tile, TilePlan } from './lens/tiles.js';
export { MAX_TILES, mergeTiles, planTiles, tilingTag, toPicture } from './lens/tiles.js';
export { buildRequest } from './lens/request.js';
export type { SearchMode, SearchOptions, Selection } from './lens/search.js';
export {
  CLUSTER_INFO_ENDPOINT,
  ImageSearch,
  RESULTS_URL,
  buildSearchUrl,
  clampBox,
  openSession,
  parseObjects,
  textSearchUrl,
} from './lens/search.js';
export { parseResponse } from './lens/response.js';
export { ocrText, translationText } from './lens/text.js';

export type { Source } from './image.js';
export {
  acquireSource,
  encodeForUpload,
  encodeRect,
  encodeRegion,
  fingerprint,
  prepareImage,
} from './image.js';

export type { Target, TargetKind } from './detect.js';
export { classify, collect, ignoreElements, isBigEnough, targetFromEvent } from './detect.js';

export {
  cacheKey,
  cacheStats,
  clearCache,
  getCached,
  getRender,
  normalizeUrl,
  putCached,
  putRender,
  renderKey,
} from './cache.js';

export { clearStored, getStored, putStored, storedStats } from './store.js';

export { renderToBlob } from './render/canvas.js';
export {
  OVERLAY_CSS,
  clearAllOverlays,
  clearOverlay,
  hasOverlay,
  peekAllOverlays,
  peekOverlay,
  renderTranslation,
  repositionOverlays,
  sweepOverlays,
} from './render/overlay.js';
export {
  COVER_MARK,
  coverImage,
  isCover,
  isCovered,
  peekAllCovers,
  peekCover,
  sweepCovers,
  uncoverAll,
  uncoverImage,
} from './render/cover.js';
export type { CoverOptions } from './render/cover.js';
export type { PictureHandlers } from './render/watch.js';
export { watchPicture } from './render/watch.js';
