import type { LensResult } from '../types.js';

/**
 * The words in an answer, as plain text.
 *
 * The picture is only one way to use what Lens returned: the text itself is
 * what gets pasted into a chat, a dictionary or a bug report, and neither a
 * bitmap nor a DOM overlay can be copied from.
 */

/** What the translation says, one block to a paragraph and a blank line between. */
export function translationText(result: LensResult): string {
  return result.blocks
    .map((block) => block.translation.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * What the picture says in its own language, a line to a line.
 *
 * Read from the recognised paragraphs rather than from the translation blocks,
 * because those are only the paragraphs Lens managed to translate: text it
 * recognised and could not translate (a name, a sound effect, the target
 * language already) is still text worth being able to copy.
 */
export function ocrText(result: LensResult): string {
  return result.ocr
    .map((paragraph) =>
      paragraph.lines
        .map((line) => line.text.trim())
        .filter(Boolean)
        .join('\n')
    )
    .filter(Boolean)
    .join('\n\n');
}
