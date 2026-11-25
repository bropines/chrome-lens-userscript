import { describe, expect, test } from 'bun:test';
import { F } from '../src/gen/fields.js';
import { fromBase64, isBase64Text, jsonRequest, toBase64 } from '../src/lens/wire-text.js';

const settings = {
  targetLang: 'ru',
  sourceLang: '',
  ocrLang: '',
  region: 'US',
  timeZone: 'Europe/Moscow',
  apiKey: 'k',
} as never;

/** Every key of a JSON object, with the path of message names it sits under. */
const KNOWN: Record<string, keyof typeof F> = {
  objectsRequest: 'LensOverlayObjectsRequest',
  requestContext: 'LensOverlayRequestContext',
  requestId: 'LensOverlayRequestId',
  clientContext: 'LensOverlayClientContext',
  localeContext: 'LocaleContext',
  clientFilters: 'AppliedFilters',
  filter: 'AppliedFilter',
  translate: 'AppliedFilter_Translate',
  renderingContext: 'RenderingContext',
  imageData: 'ImageData',
  payload: 'ImagePayload',
  imageMetadata: 'ImageMetadata',
};

function check(value: unknown, message: keyof typeof F, path: string): void {
  if (Array.isArray(value)) return value.forEach((item) => check(item, message, path));
  if (!value || typeof value !== 'object') return;
  const fields = F[message] as Record<string, number>;
  for (const [key, inner] of Object.entries(value)) {
    expect(`${path}.${key} in ${message}: ${key in fields}`).toBe(`${path}.${key} in ${message}: true`);
    const child = KNOWN[key];
    if (child) check(inner, child, `${path}.${key}`);
  }
}

describe('the Lens request as text', () => {
  test('every name is a field the binary request writes, in the right message', () => {
    const json = JSON.parse(jsonRequest('QUJD', 640, 480, settings));
    check(json, 'LensOverlayServerRequest', '');
    expect(json.objectsRequest.imageData.payload.imageBytes).toBe('QUJD');
    expect(json.objectsRequest.requestContext.clientContext.clientFilters.filter[0].translate).toEqual({ targetLanguage: 'ru' });
    // A 64-bit id is a string in proto3 JSON.
    expect(typeof json.objectsRequest.requestContext.requestId.uuid).toBe('string');
  });

  test('base64 both ways, every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...fromBase64(toBase64(all as never))]).toEqual([...all]);
  });

  test('an answer is told apart from base64 by its bytes', () => {
    expect(isBase64Text(new TextEncoder().encode('EoIrCgAang8K') as never)).toBe(true);
    expect(isBase64Text(Uint8Array.from([0x12, 0x82, 0x2b]) as never)).toBe(false);
    expect(isBase64Text(new Uint8Array(0) as never)).toBe(false);
  });
});
