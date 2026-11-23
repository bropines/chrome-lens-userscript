import { afterEach, describe, expect, test } from 'bun:test';
import { F } from '../src/gen/fields.js';
import { bytes, decode, num, sub, text, writer } from '../src/protobuf.js';
import type { PbMessage } from '../src/protobuf.js';
import {
  CLUSTER_INFO_ENDPOINT,
  ImageSearch,
  base64Url,
  buildSearchUrl,
  clampBox,
  textSearchUrl,
} from '../src/lens/search.js';
import { getTransport as getTransportForTest, setTransport } from '../src/transport.js';
import type { BinaryRequest, Transport } from '../src/transport.js';
import type { Bytes, LensOptions } from '../src/types.js';

const settings: LensOptions = {
  targetLang: '',
  sourceLang: '',
  ocrLang: '',
  region: 'US',
  timeZone: 'UTC',
  apiKey: 'test-key',
  timeoutMs: 1000,
  maxArea: 1_500_000,
  maxSide: 1600,
  jpegQuality: 0.4,
};

const image = { imageBytes: Uint8Array.from([0xff, 0xd8, 1, 2, 3]) as Bytes, width: 640, height: 480 };
const ROUTING = writer().str(1, 'server-address').finish();

/** A Lens that answers in the shapes the real one does, and keeps what it was sent. */
function fakeLens(options: { interactionError?: number } = {}) {
  const sent: { url: string; body: PbMessage; headers: Record<string, string> }[] = [];
  const transport: Transport = {
    async post(request: BinaryRequest) {
      const body = decode(request.body as Bytes);
      sent.push({ url: request.url, body, headers: request.headers ?? {} });
      let reply: Bytes;
      if (request.url === CLUSTER_INFO_ENDPOINT) {
        reply = writer()
          .str(F.LensOverlayServerClusterInfoResponse.serverSessionId, `server-${sent.length}`)
          .str(F.LensOverlayServerClusterInfoResponse.searchSessionId, `search-${sent.length}`)
          .bytes(F.LensOverlayServerClusterInfoResponse.routingInfo, ROUTING)
          .finish();
      } else if (sub(body, F.LensOverlayServerRequest.objectsRequest)) {
        reply = writer()
          .sub(F.LensOverlayServerResponse.objectsResponse, (o) =>
            o.sub(F.LensOverlayObjectsResponse.overlayObjects, (obj) =>
              obj.str(F.OverlayObject.id, 'DetectedObject-1').sub(F.OverlayObject.geometry, (g) =>
                g.sub(F.Geometry.boundingBox, (b) =>
                  b.float(F.CenterRotatedBox.centerX, 0.25).float(F.CenterRotatedBox.centerY, 0.5)
                    .float(F.CenterRotatedBox.width, 0.5).float(F.CenterRotatedBox.height, 0.5)
                )
              )
            )
          )
          .finish();
      } else {
        reply = writer()
          .sub(F.LensOverlayServerResponse.error, (e) =>
            e.int(F.LensOverlayServerError.errorType, options.interactionError ?? 0)
          )
          .sub(F.LensOverlayServerResponse.interactionResponse, (i) =>
            i.str(F.LensOverlayInteractionResponse.encodedResponse, 'opaque')
          )
          .finish();
      }
      return { status: 200, bytes: reply, contentType: 'application/x-protobuf' };
    },
    async get() {
      throw new Error('not used');
    },
  };
  setTransport(transport);
  return sent;
}

function requestIdOf(body: PbMessage, kind: 'objects' | 'interaction'): PbMessage | null {
  const outer =
    kind === 'objects'
      ? sub(body, F.LensOverlayServerRequest.objectsRequest)
      : sub(body, F.LensOverlayServerRequest.interactionRequest);
  const ctx = sub(outer, kind === 'objects' ? F.LensOverlayObjectsRequest.requestContext : F.LensOverlayInteractionRequest.requestContext);
  return sub(ctx, F.LensOverlayRequestContext.requestId);
}

function vsridOf(url: string): PbMessage {
  const value = new URL(url).searchParams.get('vsrid') ?? '';
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)) as Bytes);
}

afterEach(() => setTransport(null as unknown as Transport));

describe('buildSearchUrl', () => {
  test('a picture alone is a unimodal Lens search', () => {
    const url = new URL(buildSearchUrl('search-id', 'vs', { uiLanguage: 'ru' }));
    expect(url.origin + url.pathname).toBe('https://www.google.com/search');
    const p = url.searchParams;
    expect([p.get('udm'), p.get('lns_mode'), p.get('q')]).toEqual(['26', 'un', '']);
    expect([p.get('gsessionid'), p.get('vsrid'), p.get('lns_surface'), p.get('hl')]).toEqual([
      'search-id',
      'vs',
      '42',
      'ru',
    ]);
  });

  test('words with the picture make it multimodal', () => {
    const p = new URL(buildSearchUrl('s', 'v', { text: ' red shoes ' })).searchParams;
    expect([p.get('udm'), p.get('lns_mode'), p.get('q')]).toEqual(['24', 'mu', 'red shoes']);
  });

  test('AI Mode is its own tab', () => {
    expect(new URL(buildSearchUrl('s', 'v', { mode: 'ai', text: 'what is it' })).searchParams.get('udm')).toBe('50');
    expect(new URL(buildSearchUrl('s', 'v', { mode: 'ai' })).searchParams.get('lns_mode')).toBe('mu');
  });
});

describe('textSearchUrl', () => {
  test('selected words need no upload', () => {
    const p = new URL(textSearchUrl('  hello world ', { dark: true })).searchParams;
    expect([p.get('q'), p.get('lns_mode'), p.get('cs'), p.get('vsrid')]).toEqual(['hello world', 'text', '1', null]);
  });
});

describe('helpers', () => {
  test('base64Url has no padding and no + or /', () => {
    expect(base64Url(Uint8Array.from([0xfb, 0xff]) as Bytes)).toBe('-_8');
  });

  test('a box dragged past the edge is cut to the picture', () => {
    expect(clampBox({ cx: 0.9, cy: 0.5, w: 0.4, h: 2 })).toEqual({ cx: 0.85, cy: 0.5, w: 0.30000000000000004, h: 1 });
  });
});

describe('ImageSearch', () => {
  test('session, upload and search follow Chromium sequence numbers', async () => {
    const sent = fakeLens();
    const search = await ImageSearch.upload(image, settings);
    expect(search.objects).toEqual([
      { id: 'DetectedObject-1', geometry: { cx: 0.25, cy: 0.5, w: 0.5, h: 0.5, angle: 0 } },
    ]);

    const url = await search.search({ kind: 'region', box: { cx: 0.5, cy: 0.5, w: 0.5, h: 0.5 } }, { uiLanguage: 'en' });

    expect(sent.map((s) => s.url.split('?')[0])).toEqual([
      CLUSTER_INFO_ENDPOINT,
      'https://lensfrontend-pa.googleapis.com/v1/crupload',
      'https://lensfrontend-pa.googleapis.com/v1/crupload',
    ]);
    // The server session goes on crupload; the search session on the page.
    expect(sent[1]?.url).toEndWith('?gsessionid=server-1');
    expect(new URL(url).searchParams.get('gsessionid')).toBe('search-1');
    expect(sent.every((s) => s.headers['X-Goog-Api-Key'] === 'test-key')).toBe(true);

    const objectsId = requestIdOf(sent[1]!.body, 'objects');
    const interactionId = requestIdOf(sent[2]!.body, 'interaction');
    const urlId = vsridOf(url);
    expect([objectsId, interactionId, urlId].map((id) => num(id, F.LensOverlayRequestId.sequenceId))).toEqual([1, 2, 3]);
    const uuids = [objectsId, interactionId, urlId].map((id) => num(id, F.LensOverlayRequestId.uuid));
    expect(new Set(uuids).size).toBe(1);
    // kSearchUrl keeps the interaction's analytics id; the interaction got a new one.
    const analytics = [objectsId, interactionId, urlId].map((id) =>
      Array.from(bytes(id, F.LensOverlayRequestId.analyticsId) ?? [])
    );
    expect(analytics[2]).toEqual(analytics[1]!);
    expect(analytics[1]).not.toEqual(analytics[0]!);
    expect(Array.from(bytes(urlId, F.LensOverlayRequestId.routingInfo) ?? [])).toEqual(Array.from(ROUTING));
  });

  test('a region carries its box and the pixels; an object only its id', async () => {
    const sent = fakeLens();
    const search = await ImageSearch.upload(image, settings);
    await search.search({ kind: 'region', box: { cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 } }, { text: 'what is this' });
    await search.search({ kind: 'object', id: 'DetectedObject-1' });

    const region = sub(sent[2]!.body, F.LensOverlayServerRequest.interactionRequest);
    const meta = sub(region, F.LensOverlayInteractionRequest.interactionRequestMetadata);
    expect(num(meta, F.LensOverlayInteractionRequestMetadata.type)).toBe(4);
    const box = sub(
      sub(sub(meta, F.LensOverlayInteractionRequestMetadata.selectionMetadata), F.LensOverlayInteractionRequestMetadata_SelectionMetadata.region),
      F.LensOverlayInteractionRequestMetadata_SelectionMetadata_Region.region
    );
    expect(num(box, F.CenterRotatedBox.width)).toBeCloseTo(0.2, 5);
    expect(num(box, F.CenterRotatedBox.coordinateType)).toBe(1);
    const query = sub(sub(meta, F.LensOverlayInteractionRequestMetadata.queryMetadata), F.LensOverlayInteractionRequestMetadata_QueryMetadata.textQuery);
    expect(text(query, F.TextQuery.query)).toBe('what is this');
    const crop = sub(region, F.LensOverlayInteractionRequest.imageCrop);
    expect(Array.from(bytes(sub(crop, F.ImageCrop.image), F.ClientImage.imageContent) ?? [])).toEqual(Array.from(image.imageBytes));
    expect(num(sub(crop, F.ImageCrop.zoomedCrop), F.ZoomedCrop.parentWidth)).toBe(640);

    const tap = sub(sent[3]!.body, F.LensOverlayServerRequest.interactionRequest);
    const tapMeta = sub(tap, F.LensOverlayInteractionRequest.interactionRequestMetadata);
    expect(num(tapMeta, F.LensOverlayInteractionRequestMetadata.type)).toBe(1);
    expect(sub(tap, F.LensOverlayInteractionRequest.imageCrop)).toBeNull();
    const object = sub(sub(tapMeta, F.LensOverlayInteractionRequestMetadata.selectionMetadata), F.LensOverlayInteractionRequestMetadata_SelectionMetadata.object);
    expect(text(object, F.LensOverlayInteractionRequestMetadata_SelectionMetadata_Object.objectId)).toBe('DetectedObject-1');
    // Each search is one more step on the same sequence.
    expect(num(requestIdOf(sent[3]!.body, 'interaction'), F.LensOverlayRequestId.sequenceId)).toBe(4);
  });

  test('two searches at once are numbered one after the other', async () => {
    const sent = fakeLens();
    const search = await ImageSearch.upload(image, settings);
    const [a, b] = await Promise.all([search.search({ kind: 'image' }), search.search({ kind: 'object', id: 'x' })]);
    expect([2, 3].map((i) => num(requestIdOf(sent[i]!.body, 'interaction'), F.LensOverlayRequestId.sequenceId))).toEqual([2, 4]);
    expect([a, b].map((u) => num(vsridOf(u), F.LensOverlayRequestId.sequenceId))).toEqual([3, 5]);
  });

  test('a failed upload does not leave a session to search in', async () => {
    let failUpload = false;
    const sent = fakeLens();
    const search = await ImageSearch.upload(image, settings);
    const inner = getTransportForTest();
    setTransport({
      ...inner,
      async post(request) {
        if (failUpload && sub(decode(request.body), F.LensOverlayServerRequest.objectsRequest)) throw new Error('network');
        return inner.post(request);
      },
    });
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 31 * 60 * 1000;
      failUpload = true;
      await expect(search.search({ kind: 'image' })).rejects.toThrow('network');
      failUpload = false;
      const url = await search.search({ kind: 'image' });
      // The second try opened a session again rather than searching the empty one.
      expect(sent.filter((s) => s.url.endsWith('/gsessionid')).length).toBe(3);
      expect(num(vsridOf(url), F.LensOverlayRequestId.sequenceId)).toBe(3);
    } finally {
      Date.now = realNow;
    }
  });

  test('a server error on the interaction is an error, not a URL', async () => {
    fakeLens({ interactionError: 2 });
    const search = await ImageSearch.upload(image, settings);
    await expect(search.search({ kind: 'image' })).rejects.toThrow('server error type 2');
  });

  test('an expired session is reopened and the picture uploaded again', async () => {
    const sent = fakeLens();
    const search = await ImageSearch.upload(image, settings);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 31 * 60 * 1000;
      const url = await search.search({ kind: 'image' });
      expect(sent.map((s) => s.url.split('?')[0]!.split('/').pop())).toEqual([
        'gsessionid',
        'crupload',
        'gsessionid',
        'crupload',
        'crupload',
      ]);
      expect(new URL(url).searchParams.get('gsessionid')).toBe('search-3');
      expect(num(requestIdOf(sent[4]!.body, 'interaction'), F.LensOverlayRequestId.sequenceId)).toBe(2);
    } finally {
      Date.now = realNow;
    }
  });

});
