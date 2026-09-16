/** Shared domain types. Everything crossing a module boundary is described here. */

/**
 * Bytes backed by a plain ArrayBuffer.
 *
 * TypeScript 5.7 split Uint8Array by its backing buffer, and the DOM's
 * BufferSource / BlobPart reject the SharedArrayBuffer-capable default. Every
 * buffer here comes from a fetch or an allocation, never shared memory.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/** A bounding box in normalized image coordinates, with rotation in degrees. */
export interface Geometry {
  /** Centre x, 0..1 of the image width. */
  cx: number;
  /** Centre y, 0..1 of the image height. */
  cy: number;
  /** Width, 0..1 of the image width. */
  w: number;
  /** Height, 0..1 of the image height. */
  h: number;
  /** Clockwise rotation in degrees, converted from the server's radians. */
  angle: number;
}

/** The inpainted patch the server produces to erase the source text. */
export interface BackgroundImage {
  /** WebP with alpha. */
  bytes: Bytes;
  /** Vertical padding as a fraction of the line height. */
  vPad: number;
  /** Horizontal padding, also a fraction of the line HEIGHT, not width. */
  hPad: number;
}

/** One line of translated text, ready to render. */
export interface TranslatedLine {
  /** `[start, end)` ranges into the paragraph translation, in UTF-16 code units. */
  words: Array<[number, number]>;
  /** Foreground colour as aRGB. */
  textColor: number;
  /** Background colour as aRGB. */
  bgColor: number;
  /** Borrowed from the detected line: the server sends none for translated text. */
  geometry: Geometry | null;
  background: BackgroundImage | null;
}

export interface TranslationBlock {
  /** The whole paragraph translation; lines index into this. */
  translation: string;
  sourceLang: string;
  targetLang: string;
  writingDirection: WritingDirection;
  alignment: Alignment;
  lines: TranslatedLine[];
}

export interface OcrWord {
  text: string;
  separator: string;
  geometry: Geometry | null;
  /** Present only when the server classified the word as a formula. */
  type?: 'FORMULA';
  latex?: string;
}

export interface OcrLine {
  text: string;
  words: OcrWord[];
  geometry: Geometry | null;
}

export interface OcrParagraph {
  writingDirection: WritingDirection;
  geometry: Geometry | null;
  lines: OcrLine[];
}

export interface LensResult {
  contentLanguage: string;
  ocr: OcrParagraph[];
  blocks: TranslationBlock[];
}

export const WritingDirection = {
  LeftToRight: 0,
  RightToLeft: 1,
  TopToBottom: 2,
} as const;
export type WritingDirection = (typeof WritingDirection)[keyof typeof WritingDirection];

export const Alignment = {
  Left: 0,
  Right: 1,
  Center: 2,
} as const;
export type Alignment = (typeof Alignment)[keyof typeof Alignment];

export type VerticalTextMode = 'auto' | 'keep' | 'horizontal';
export type HotkeyModifier = 'alt' | 'ctrl' | 'shift' | 'none';

export interface Settings {
  targetLang: string;
  sourceLang: string;
  ocrLang: string;
  region: string;
  timeZone: string;
  apiKey: string;
  timeoutMs: number;
  minImageSize: number;
  maxArea: number;
  maxSide: number;
  jpegQuality: number;
  showButton: boolean;
  hotkey: HotkeyModifier;
  fontFamily: string;
  drawBackground: boolean;
  verticalText: VerticalTextMode;
  renderMode: RenderMode;
  enabled: boolean;
}

/** An image encoded and sized the way Chromium would send it. */
export interface PreparedImage {
  imageBytes: Bytes;
  /** Size of the uploaded bytes, after Chromium's downscale rule. */
  width: number;
  height: number;
  /**
   * The decoded pixels, at natural size. Reused for rendering so a
   * cross-origin image that tainted the element's own canvas still works.
   */
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  /** Frees the source when it is an ImageBitmap. */
  release(): void;
}

export type RenderMode = 'canvas' | 'overlay';
