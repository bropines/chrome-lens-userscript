import { F } from '../gen/fields.js';
import { bytes, decode, num, sub, subs, text, writer } from '../protobuf.js';
import type { PbMessage, Writer } from '../protobuf.js';
import { getTransport } from '../transport.js';
import {
  PLATFORM_WEB,
  RENDERING_ENV_LENS_OVERLAY,
  SURFACE_CHROMIUM,
  randomUuid,
  writeClientContext,
  writeImageData,
} from './request.js';
import { LENS_ENDPOINT } from './client.js';
import { parseGeometry, parseResponse } from './response.js';
import type { Bytes, DetectedObject, LensOptions, LensResult, NormalizedBox, PreparedImage } from '../types.js';

/**
 * Search with an image: the half of Lens that is not in the protobuf.
 *
 * Visual matches, products and the AI Mode answer exist only as Google's
 * results page. Chrome uploads the picture, then opens that page with two ids
 * that name the upload: `vsrid` (a serialized request id) and `gsessionid`
 * (the search session). Google joins them server side, and it does not care
 * which client made the upload - verified by uploading from a script through
 * a proxy and opening the URL in an unrelated browser. So the whole job here
 * is: open a session, upload, describe the selection, mint the URL.
 *
 * The sequence numbers follow `LensOverlayRequestIdGenerator`; see
 * docs/lens-capabilities.md for where each one comes from.
 */

export const CLUSTER_INFO_ENDPOINT = 'https://lensfrontend-pa.googleapis.com/v1/gsessionid';
export const RESULTS_URL = 'https://www.google.com/search';

/** Chromium's `cluster-info-lifetime-seconds`; past it the ids stop resolving. */
const SESSION_LIFETIME_MS = 1800 * 1000;
/** A margin, so a URL is never minted from a session about to expire. */
const SESSION_MARGIN_MS = 60 * 1000;

const COORDINATE_NORMALIZED = 1;
const INTERACTION_TAP = 1;
const INTERACTION_REGION_SEARCH = 4;

/**
 * Which tab of the results page to open.
 *
 * - `visual`: Lens results - visual matches, exact matches, an AI overview.
 * - `ai`: AI Mode, with the picture attached and `text` as the question.
 *
 * There is no `shopping`. Chrome's `udm=28` is a tab the user reaches from
 * inside the visual results; asked for directly with a fresh `vsrid` it opens
 * an empty Google Shopping page that never sees the picture (tried, 2026-11-23).
 * Products are one tap away on the `visual` page instead.
 */
export type SearchMode = 'visual' | 'ai';

export interface SearchOptions {
  mode?: SearchMode;
  /** Words to add to the picture; for `ai`, the question. */
  text?: string;
  /** `hl`: the results page's language. */
  uiLanguage?: string;
  dark?: boolean;
}

/** What to search for, inside an uploaded picture. */
export type Selection =
  | { kind: 'image' }
  | { kind: 'region'; box: NormalizedBox; crop?: { bytes: Bytes; width: number; height: number } }
  | { kind: 'object'; id: string };

interface SessionIds {
  serverSessionId: string;
  searchSessionId: string;
  /** Opaque to us; copied into every request id, as Chromium does. */
  routingInfo: Bytes | null;
  openedAt: number;
}

interface RequestId {
  uuid: bigint;
  sequenceId: number;
  imageSequenceId: number;
  analyticsId: Bytes;
  contextId: bigint;
}

function randomBytes(n: number): Bytes {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out as Bytes;
}

function writeRequestId(w: Writer, id: RequestId, routingInfo: Bytes | null): void {
  w.int(F.LensOverlayRequestId.uuid, id.uuid)
    .int(F.LensOverlayRequestId.sequenceId, id.sequenceId)
    .int(F.LensOverlayRequestId.imageSequenceId, id.imageSequenceId)
    .bytes(F.LensOverlayRequestId.analyticsId, id.analyticsId)
    // The initial request bumps long_context_id to 1 and nothing after it does.
    .int(F.LensOverlayRequestId.longContextId, 1)
    .bytes(F.LensOverlayRequestId.routingInfo, routingInfo ?? undefined)
    .int(F.LensOverlayRequestId.timeUsec, BigInt(Date.now()) * 1000n)
    .int(F.LensOverlayRequestId.contextId, id.contextId);
}

/** base64url without padding, which is how Chromium writes `vsrid`. */
export function base64Url(data: Bytes): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function post(url: string, body: Bytes, settings: LensOptions): Promise<PbMessage> {
  const response = await getTransport().post({
    url,
    headers: { 'Content-Type': 'application/x-protobuf', 'X-Goog-Api-Key': settings.apiKey },
    body,
    timeoutMs: settings.timeoutMs,
  });
  return decode(response.bytes);
}

/** Open a search session. One request, no image. */
export async function openSession(settings: LensOptions): Promise<SessionIds> {
  const body = writer()
    .int(F.LensOverlayServerClusterInfoRequest.enableSearchSessionId, 1)
    .int(F.LensOverlayServerClusterInfoRequest.surface, SURFACE_CHROMIUM)
    .int(F.LensOverlayServerClusterInfoRequest.platform, PLATFORM_WEB)
    .sub(F.LensOverlayServerClusterInfoRequest.renderingContext, (r) =>
      r.int(F.RenderingContext.renderingEnvironment, RENDERING_ENV_LENS_OVERLAY)
    )
    .finish();
  const response = await post(CLUSTER_INFO_ENDPOINT, body, settings);
  const ids: SessionIds = {
    serverSessionId: text(response, F.LensOverlayServerClusterInfoResponse.serverSessionId),
    searchSessionId: text(response, F.LensOverlayServerClusterInfoResponse.searchSessionId),
    routingInfo: bytes(response, F.LensOverlayServerClusterInfoResponse.routingInfo),
    openedAt: Date.now(),
  };
  if (!ids.serverSessionId || !ids.searchSessionId) {
    throw new Error('Lens did not open a search session');
  }
  return ids;
}

/** The objects Lens found: what Chrome draws as tappable dots. */
export function parseObjects(raw: Bytes): DetectedObject[] {
  const objects = sub(decode(raw), F.LensOverlayServerResponse.objectsResponse);
  return subs(objects, F.LensOverlayObjectsResponse.overlayObjects)
    .map((object) => ({
      id: text(object, F.OverlayObject.id),
      geometry: parseGeometry(sub(object, F.OverlayObject.geometry)),
    }))
    .filter((object) => object.id);
}

function writeBox(w: Writer, box: NormalizedBox): void {
  w.float(F.CenterRotatedBox.centerX, box.cx)
    .float(F.CenterRotatedBox.centerY, box.cy)
    .float(F.CenterRotatedBox.width, box.w)
    .float(F.CenterRotatedBox.height, box.h)
    .int(F.CenterRotatedBox.coordinateType, COORDINATE_NORMALIZED);
}

const WHOLE: NormalizedBox = { cx: 0.5, cy: 0.5, w: 1, h: 1 };

/** Clamp a box to the picture, so a drag past the edge still means something. */
export function clampBox(box: NormalizedBox): NormalizedBox {
  const x0 = Math.max(0, box.cx - box.w / 2);
  const y0 = Math.max(0, box.cy - box.h / 2);
  const x1 = Math.min(1, box.cx + box.w / 2);
  const y1 = Math.min(1, box.cy + box.h / 2);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * The results URL, as `BuildLensSearchURL` builds it.
 *
 * `gsessionid` here is the *search* session id; the server one only ever goes
 * on `crupload`. The logging parameters (`vsint`, `plla`, `qsubts`, `cud`) are
 * left out: the page renders without them.
 */
export function buildSearchUrl(searchSessionId: string, vsrid: string, options: SearchOptions = {}): string {
  const mode = options.mode ?? 'visual';
  const query = options.text?.trim() ?? '';
  const multimodal = Boolean(query) || mode === 'ai';
  const udm = mode === 'ai' ? '50' : multimodal ? '24' : '26';
  const params = new URLSearchParams({
    q: query,
    lns_mode: multimodal ? 'mu' : 'un',
    lns_fp: '1',
    lns_surface: '42',
    gsessionid: searchSessionId,
    udm,
    vsrid,
    source: 'chrome.cr.ctxi',
  });
  if (options.uiLanguage) params.set('hl', options.uiLanguage);
  if (options.dark !== undefined) params.set('cs', options.dark ? '1' : '0');
  return `${RESULTS_URL}?${params.toString()}`;
}

/**
 * A plain text search, as Chrome sends one for selected words.
 *
 * `BuildTextOnlySearchURL`: no upload, no session - the words are the query
 * and the `lns_*` parameters only mark where it came from.
 */
export function textSearchUrl(words: string, options: Pick<SearchOptions, 'uiLanguage' | 'dark'> = {}): string {
  const params = new URLSearchParams({ q: words.trim(), lns_fp: '1', lns_mode: 'text', lns_surface: '42' });
  if (options.uiLanguage) params.set('hl', options.uiLanguage);
  if (options.dark !== undefined) params.set('cs', options.dark ? '1' : '0');
  return `${RESULTS_URL}?${params.toString()}`;
}

/**
 * One picture, uploaded into one search session, ready to be searched.
 *
 * `upload` costs two requests (the session and the picture); every search
 * after it costs one, and a session that has expired is reopened and the
 * picture uploaded again without the caller having to notice.
 */
export class ImageSearch {
  /** The objects Lens detected, normalised to the picture. */
  objects: DetectedObject[] = [];
  /** OCR from the same upload; a search asks for no translation. */
  result: LensResult = { contentLanguage: '', ocr: [], blocks: [] };

  private ids: SessionIds | null = null;
  private uuid = randomUuid();
  private contextId = randomUuid();
  private sequence = 0;
  /**
   * Every request goes through this chain, one at a time. The sequence numbers
   * are a counter, and two searches interleaving their requests would number
   * them 2,3,4,5 in the wrong order - or, on an expired session, both reopen it.
   */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly image: Pick<PreparedImage, 'imageBytes' | 'width' | 'height'>,
    private readonly settings: LensOptions
  ) {}

  static async upload(
    image: Pick<PreparedImage, 'imageBytes' | 'width' | 'height'>,
    settings: LensOptions
  ): Promise<ImageSearch> {
    const search = new ImageSearch(image, settings);
    await search.start();
    return search;
  }

  /** Whether the session behind this upload is still good. */
  get fresh(): boolean {
    return Boolean(this.ids) && Date.now() - (this.ids?.openedAt ?? 0) < SESSION_LIFETIME_MS - SESSION_MARGIN_MS;
  }

  private static endpoint(ids: SessionIds): string {
    return `${LENS_ENDPOINT}?gsessionid=${encodeURIComponent(ids.serverSessionId)}`;
  }

  private nextId(analyticsId: Bytes): RequestId {
    this.sequence += 1;
    return {
      uuid: this.uuid,
      sequenceId: this.sequence,
      imageSequenceId: 1,
      analyticsId,
      contextId: this.contextId,
    };
  }

  /**
   * Open a session and upload the picture into it.
   *
   * Nothing is kept until the upload has succeeded: a session whose upload
   * failed has no picture in it, and searching it would mint URLs that show
   * nothing.
   */
  private async start(): Promise<void> {
    const ids = await openSession(this.settings);
    const uuid = randomUuid();
    const contextId = randomUuid();
    const id: RequestId = { uuid, sequenceId: 1, imageSequenceId: 1, analyticsId: randomBytes(16), contextId };
    const routing = ids.routingInfo;
    const body = writer()
      .sub(F.LensOverlayServerRequest.objectsRequest, (objects) => {
        objects.sub(F.LensOverlayObjectsRequest.requestContext, (ctx) => {
          ctx.sub(F.LensOverlayRequestContext.requestId, (w) => writeRequestId(w, id, routing));
          ctx.sub(F.LensOverlayRequestContext.clientContext, (client) =>
            writeClientContext(client, this.settings, false)
          );
        });
        objects.sub(F.LensOverlayObjectsRequest.imageData, (data) => writeImageData(data, this.image));
      })
      .finish();
    const response = await getTransport().post({
      url: ImageSearch.endpoint(ids),
      headers: { 'Content-Type': 'application/x-protobuf', 'X-Goog-Api-Key': this.settings.apiKey },
      body,
      timeoutMs: this.settings.timeoutMs,
    });
    const result = parseResponse(response.bytes);
    this.result = result;
    this.objects = parseObjects(response.bytes);
    this.ids = ids;
    this.uuid = uuid;
    this.contextId = contextId;
    this.sequence = 1;
  }

  /**
   * Describe a selection to Lens and return the results URL for it.
   *
   * Chrome builds the URL as soon as the interaction is *sent*, but the page
   * resolves `vsrid` against the interaction, so this waits for the answer:
   * opening the page first would race the request it names.
   */
  search(selection: Selection, options: SearchOptions = {}): Promise<string> {
    const run = this.queue.then(() => this.searchNow(selection, options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async searchNow(selection: Selection, options: SearchOptions): Promise<string> {
    if (!this.fresh) await this.start();
    const ids = this.ids;
    if (!ids) throw new Error('Lens did not open a search session');

    const analytics = randomBytes(16);
    const interactionId = this.nextId(analytics);
    const routing = ids.routingInfo;
    const query = options.text?.trim() ?? '';

    const body = writer()
      .sub(F.LensOverlayServerRequest.interactionRequest, (interaction) => {
        interaction.sub(F.LensOverlayInteractionRequest.requestContext, (ctx) => {
          ctx.sub(F.LensOverlayRequestContext.requestId, (w) => writeRequestId(w, interactionId, routing));
          ctx.sub(F.LensOverlayRequestContext.clientContext, (client) =>
            writeClientContext(client, this.settings, false)
          );
        });
        interaction.sub(F.LensOverlayInteractionRequest.interactionRequestMetadata, (meta) => {
          if (selection.kind === 'object') {
            meta.int(F.LensOverlayInteractionRequestMetadata.type, INTERACTION_TAP);
            meta.sub(F.LensOverlayInteractionRequestMetadata.selectionMetadata, (s) =>
              s.sub(F.LensOverlayInteractionRequestMetadata_SelectionMetadata.object, (o) =>
                o.str(F.LensOverlayInteractionRequestMetadata_SelectionMetadata_Object.objectId, selection.id)
              )
            );
          } else {
            const box = selection.kind === 'region' ? clampBox(selection.box) : WHOLE;
            meta.int(F.LensOverlayInteractionRequestMetadata.type, INTERACTION_REGION_SEARCH);
            meta.sub(F.LensOverlayInteractionRequestMetadata.selectionMetadata, (s) =>
              s.sub(F.LensOverlayInteractionRequestMetadata_SelectionMetadata.region, (r) =>
                r.sub(F.LensOverlayInteractionRequestMetadata_SelectionMetadata_Region.region, (b) => writeBox(b, box))
              )
            );
          }
          if (query) {
            meta.sub(F.LensOverlayInteractionRequestMetadata.queryMetadata, (q) =>
              q.sub(F.LensOverlayInteractionRequestMetadata_QueryMetadata.textQuery, (t) =>
                t.str(F.TextQuery.query, query)
              )
            );
          }
        });
        if (selection.kind !== 'object') {
          const box = selection.kind === 'region' ? clampBox(selection.box) : WHOLE;
          const crop = selection.kind === 'region' && selection.crop ? selection.crop : null;
          interaction.sub(F.LensOverlayInteractionRequest.imageCrop, (c) => {
            c.sub(F.ImageCrop.image, (img) =>
              img.bytes(F.ClientImage.imageContent, crop ? crop.bytes : this.image.imageBytes)
            );
            c.sub(F.ImageCrop.zoomedCrop, (z) => {
              z.sub(F.ZoomedCrop.crop, (b) => writeBox(b, box));
              z.int(F.ZoomedCrop.parentWidth, this.image.width)
                .int(F.ZoomedCrop.parentHeight, this.image.height)
                .float(F.ZoomedCrop.zoom, 1);
            });
          });
        }
      })
      .finish();

    const response = await getTransport().post({
      url: ImageSearch.endpoint(ids),
      headers: { 'Content-Type': 'application/x-protobuf', 'X-Goog-Api-Key': this.settings.apiKey },
      body,
      timeoutMs: this.settings.timeoutMs,
    });
    const error = sub(decode(response.bytes), F.LensOverlayServerResponse.error);
    const errorType = error ? num(error, F.LensOverlayServerError.errorType) : 0;
    if (errorType) throw new Error(`Lens returned server error type ${errorType}`);

    // RequestIdUpdateMode::kSearchUrl: one more sequence step, same analytics id.
    const urlId = this.nextId(analytics);
    const vsrid = base64Url(requestIdBytes(urlId, routing));
    return buildSearchUrl(ids.searchSessionId, vsrid, options);
  }
}

function requestIdBytes(id: RequestId, routingInfo: Bytes | null): Bytes {
  const w = writer();
  writeRequestId(w, id, routingInfo);
  return w.finish();
}
