import { F } from '../gen/fields.js';
import { bytes, decode, num, sub, subs, text } from '../protobuf.js';
import type { PbMessage } from '../protobuf.js';
import type {
  Alignment,
  Bytes,
  BackgroundImage,
  Geometry,
  LensResult,
  OcrParagraph,
  OcrWord,
  TranslatedLine,
  TranslationBlock,
  WritingDirection,
} from '../types.js';

const TRANSLATION_SUCCESS = 1;
const WORD_TYPE_FORMULA = 1;

function parseGeometry(geometry: PbMessage | null): Geometry | null {
  const box = sub(geometry, F.Geometry.boundingBox);
  if (!box) return null;
  return {
    cx: num(box, F.CenterRotatedBox.centerX),
    cy: num(box, F.CenterRotatedBox.centerY),
    w: num(box, F.CenterRotatedBox.width),
    h: num(box, F.CenterRotatedBox.height),
    // rotation_z is clockwise radians; CSS rotate() takes clockwise degrees.
    angle: (num(box, F.CenterRotatedBox.rotationZ) * 180) / Math.PI,
  };
}

function parseWord(word: PbMessage): OcrWord {
  const parsed: OcrWord = {
    text: text(word, F.TextLayout_Word.plainText),
    separator: text(word, F.TextLayout_Word.textSeparator),
    geometry: parseGeometry(sub(word, F.TextLayout_Word.geometry)),
  };
  // The server decides on its own whether a word is a formula; there is no
  // request flag that asks for it.
  if (num(word, F.TextLayout_Word.type) === WORD_TYPE_FORMULA) {
    parsed.type = 'FORMULA';
    parsed.latex = text(sub(word, F.TextLayout_Word.formulaMetadata), F.TextLayout_Word_FormulaMetadata.latex);
  }
  return parsed;
}

function paragraphsOf(objects: PbMessage | null): PbMessage[] {
  const layout = sub(sub(objects, F.LensOverlayObjectsResponse.text), F.Text.textLayout);
  return subs(layout, F.TextLayout.paragraphs);
}

/** Recognized text, whether or not a translation came back with it. */
export function parseOcr(objects: PbMessage | null): OcrParagraph[] {
  return paragraphsOf(objects).map((paragraph) => ({
    writingDirection: num(paragraph, F.TextLayout_Paragraph.writingDirection) as WritingDirection,
    geometry: parseGeometry(sub(paragraph, F.TextLayout_Paragraph.geometry)),
    lines: subs(paragraph, F.TextLayout_Paragraph.lines).map((line) => {
      const words = subs(line, F.TextLayout_Line.words).map(parseWord);
      return {
        text: words.map((w) => w.text + w.separator).join('').trim(),
        words,
        geometry: parseGeometry(sub(line, F.TextLayout_Line.geometry)),
      };
    }),
  }));
}

function parseBackground(line: PbMessage): BackgroundImage | null {
  const data = sub(line, F.TranslationData_Line.backgroundImageData);
  if (!data) return null;
  const image = bytes(data, F.TranslationData_BackgroundImageData.backgroundImage);
  if (!image) return null;
  return {
    bytes: image,
    vPad: num(data, F.TranslationData_BackgroundImageData.verticalPadding),
    hPad: num(data, F.TranslationData_BackgroundImageData.horizontalPadding),
  };
}

/**
 * Everything needed to repaint the translation.
 *
 * A translated line borrows the geometry of the *detected* line at the same
 * index, because the server sends none for translated text. A paragraph whose
 * two line counts disagree is therefore dropped, which is what Chromium does.
 */
export function parseTranslation(objects: PbMessage | null): TranslationBlock[] {
  const paragraphs = paragraphsOf(objects);
  const gleams = subs(objects, F.LensOverlayObjectsResponse.deepGleams);
  const blocks: TranslationBlock[] = [];

  paragraphs.forEach((paragraph, index) => {
    const gleam = gleams[index];
    const translation = gleam ? sub(gleam, F.DeepGleamData.translation) : null;
    if (!translation) return;
    if (num(sub(translation, F.TranslationData.status), F.TranslationData_Status.code) !== TRANSLATION_SUCCESS) return;

    const sourceLines = subs(paragraph, F.TextLayout_Paragraph.lines);
    const translatedLines = subs(translation, F.TranslationData.line);
    if (sourceLines.length !== translatedLines.length) return;

    const lines: TranslatedLine[] = translatedLines.map((line, i) => {
      const style = sub(line, F.TranslationData_Line.style);
      const source = sourceLines[i];
      return {
        words: subs(line, F.TranslationData_Line.word).map(
          (word): [number, number] => [num(word, F.TranslationData_Line_Word.start), num(word, F.TranslationData_Line_Word.end)]
        ),
        textColor: num(style, F.TranslationData_TextStyle.textColor),
        bgColor: num(style, F.TranslationData_TextStyle.backgroundPrimaryColor),
        geometry: source ? parseGeometry(sub(source, F.TextLayout_Line.geometry)) : null,
        background: parseBackground(line),
      };
    });

    blocks.push({
      translation: text(translation, F.TranslationData.translation),
      geometry: parseGeometry(sub(paragraph, F.TextLayout_Paragraph.geometry)),
      sourceLang: text(translation, F.TranslationData.sourceLanguage),
      targetLang: text(translation, F.TranslationData.targetLanguage),
      writingDirection: num(translation, F.TranslationData.writingDirection) as WritingDirection,
      alignment: num(translation, F.TranslationData.alignment) as Alignment,
      lines,
    });
  });
  return blocks;
}

export function parseResponse(raw: Bytes): LensResult {
  const response = decode(raw);

  const error = sub(response, F.LensOverlayServerResponse.error);
  const errorType = error ? num(error, F.LensOverlayServerError.errorType) : 0;
  if (errorType) throw new Error(`Lens returned server error type ${errorType}`);

  const objects = sub(response, F.LensOverlayServerResponse.objectsResponse);
  if (!objects) return { contentLanguage: '', ocr: [], blocks: [] };

  return {
    contentLanguage: text(sub(objects, F.LensOverlayObjectsResponse.text), F.Text.contentLanguage),
    ocr: parseOcr(objects),
    blocks: parseTranslation(objects),
  };
}
