import { describe, expect, test } from 'bun:test';
import { ocrText, translationText } from '../src/lens/text.js';
import type { LensResult, OcrLine, TranslationBlock } from '../src/types.js';

const block = (translation: string): TranslationBlock => ({
  translation,
  geometry: null,
  sourceLang: 'ja',
  targetLang: 'en',
  writingDirection: 0,
  alignment: 0,
  lines: [],
});

const line = (text: string): OcrLine => ({ text, words: [], geometry: null });

const result = (over: Partial<LensResult>): LensResult => ({
  contentLanguage: 'ja',
  ocr: [],
  blocks: [],
  ...over,
});

describe('translationText', () => {
  test('a blank line between paragraphs, each trimmed', () => {
    expect(translationText(result({ blocks: [block(' Hello there \n'), block('Goodbye')] }))).toBe(
      'Hello there\n\nGoodbye'
    );
  });

  test('an empty paragraph leaves no gap', () => {
    expect(translationText(result({ blocks: [block('One'), block('  '), block('Two')] }))).toBe(
      'One\n\nTwo'
    );
  });

  test('nothing translated is the empty string', () => {
    expect(translationText(result({}))).toBe('');
  });
});

describe('ocrText', () => {
  test('a line to a line, a blank line between paragraphs', () => {
    const text = ocrText(
      result({
        ocr: [
          {
            writingDirection: 0,
            geometry: null,
            lines: [line('こんにちは'), line('世界')],
          },
          { writingDirection: 0, geometry: null, lines: [line('さようなら')] },
        ],
      })
    );
    expect(text).toBe('こんにちは\n世界\n\nさようなら');
  });

  test('is the text Lens recognised even where it translated nothing', () => {
    // No blocks at all - the same-language case - and the words are still there.
    const text = ocrText(
      result({
        blocks: [],
        ocr: [{ writingDirection: 0, geometry: null, lines: [line('Already English')] }],
      })
    );
    expect(text).toBe('Already English');
  });

  test('empty lines and empty paragraphs are dropped', () => {
    const text = ocrText(
      result({
        ocr: [
          { writingDirection: 0, geometry: null, lines: [line(' '), line('')] },
          { writingDirection: 0, geometry: null, lines: [line('Kept')] },
        ],
      })
    );
    expect(text).toBe('Kept');
  });
});
