/**
 * Just enough of a page for the modules under test to load.
 *
 * Text is measured with a ruler anyone can do in their head: a Latin glyph is
 * half an em wide, a CJK one a full em, and the font's bounding box is exactly
 * one em tall. That is not what a browser does, and it does not need to be -
 * what the layout maths promises is a relationship between the measurements it
 * is given and the size it picks, and a predictable ruler is what lets a test
 * state that relationship.
 */

const FONT = /(\d+(?:\.\d+)?)px/;

export function glyphWidth(char: string, size: number): number {
  return (char.codePointAt(0) ?? 0) >= 0x2e80 ? size : size * 0.5;
}

class FakeContext {
  font = '10px sans-serif';
  direction = 'ltr';

  private size(): number {
    return Number(FONT.exec(this.font)?.[1] ?? 10);
  }

  measureText(text: string): {
    width: number;
    fontBoundingBoxAscent: number;
    fontBoundingBoxDescent: number;
  } {
    const size = this.size();
    let width = 0;
    for (const char of text) width += glyphWidth(char, size);
    return { width, fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2 };
  }
}

const fakeDocument = {
  baseURI: 'https://example.com/gallery/index.html',
  createElement(tag: string): unknown {
    if (tag !== 'canvas') throw new Error(`the test page cannot make a <${tag}>`);
    return { width: 0, height: 0, getContext: () => new FakeContext() };
  },
};

Object.assign(globalThis, { document: fakeDocument });
