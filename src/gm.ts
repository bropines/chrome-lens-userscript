import {
  GM,
  GM_getValue,
  GM_info,
  GM_registerMenuCommand,
  GM_setValue,
  GM_xmlhttpRequest,
  unsafeWindow,
} from '$';
import type { Bytes } from './types.js';

/**
 * Everything that differs between userscript hosts.
 *
 * Tampermonkey is the reference implementation, but AdGuard ships a userscript
 * engine of its own (Extensions -> Add extension) and it differs in four ways
 * that reach this script:
 *
 * 1. `GM_registerMenuCommand` may not exist. Calling it is a TypeError that
 *    aborts the rest of the bundle.
 * 2. It may run scripts in the page's own context rather than a sandbox, which
 *    is why nothing may rely on a private global.
 * 3. Its `GM_xmlhttpRequest` has been loose about `responseType` (CoreLibs
 *    #1983), reports a status through `onerror`, and no host documents which
 *    shapes of request *body* it accepts.
 * 4. Its storage persists only what GM4 promises - strings, numbers, booleans.
 *
 * And which of those apply is not readable from `GM_info`: one build has the
 * menu and sandboxes, another has neither. A version behaves how it behaves, so
 * every difference below is settled by feature detection, by writing to the
 * narrowest contract, or by trying and falling back.
 */

/** Only ever used to word an error; never to decide behaviour. */
export function hostName(): string {
  return GM_info?.scriptHandler ?? 'The userscript host';
}

// --- Storage ----------------------------------------------------------------

/**
 * `localStorage` is the last resort, not the default: AdGuard runs in the
 * page's context, so its `localStorage` is the *site's*, and settings saved on
 * one domain would not exist on the next. Every host worth supporting has
 * `GM_getValue`; this is only here so a host missing it degrades to forgetful
 * rather than broken.
 */
const LOCAL_PREFIX = 'lens-translate:';

export function readStored(key: string): unknown {
  if (typeof GM_getValue === 'function') return GM_getValue<unknown>(key, null);
  try {
    return window.localStorage.getItem(LOCAL_PREFIX + key);
  } catch {
    return null;
  }
}

/**
 * Always a string, never the object itself.
 *
 * The GM4 API only promises to persist strings, numbers and booleans, and
 * AdGuard for Android takes that literally in the worst way: it accepts an
 * object and hands it straight back for as long as the page lives, so a
 * read-after-write looks fine - and then the key reads empty after a reload.
 * Settings that survived until you refreshed the page were the symptom.
 *
 * Reading stays tolerant of both, so a value an older version wrote as an
 * object still loads.
 */
export function writeStored(key: string, value: unknown): void {
  const encoded = JSON.stringify(value);
  if (typeof GM_setValue === 'function') {
    GM_setValue(key, encoded);
    return;
  }
  try {
    window.localStorage.setItem(LOCAL_PREFIX + key, encoded);
  } catch {
    // Private mode, or a quota that a page has already filled. Nothing to do.
  }
}

// --- Commands ---------------------------------------------------------------

export interface Command {
  /** What the host's menu shows, where it sits among every other script's. */
  menuLabel: string;
  /** What our own panel shows, or null for one the panel makes redundant. */
  label: string | null;
  run(): void;
}

export interface PanelCommand {
  label: string;
  run(): void;
}

const commands: Command[] = [];

/**
 * Register a command with the host's menu, and remember it either way.
 *
 * On AdGuard there is no menu, and these are the only way to reach clearing
 * the cache or undoing a page, so the settings panel renders whatever the host
 * would not take.
 */
export function registerCommand(command: Command): void {
  commands.push(command);
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand(command.menuLabel, command.run);
  }
}

export function panelCommands(): PanelCommand[] {
  const out: PanelCommand[] = [];
  for (const command of commands) {
    if (command.label !== null) out.push({ label: command.label, run: command.run });
  }
  return out;
}

// --- Transport --------------------------------------------------------------

/**
 * The transport, under whichever of its two names this host publishes.
 *
 * The GM4 spelling returns a promise where the legacy one returns a handle,
 * but both take the same option bag and both call the same callbacks, which is
 * all this script uses. The cast says exactly that.
 */
const request: typeof GM_xmlhttpRequest | undefined =
  typeof GM_xmlhttpRequest === 'function'
    ? GM_xmlhttpRequest
    : (GM?.xmlHttpRequest as unknown as typeof GM_xmlhttpRequest | undefined);

/** A response reduced to the three things this script ever reads. */
export interface BinaryResponse {
  status: number;
  bytes: Bytes;
  contentType: string;
}

/**
 * Ask for bytes, and be ready to be given text instead.
 *
 * `x-user-defined` is what makes the text case recoverable: it maps every byte
 * to a code point in U+F7xx rather than running it through a UTF-8 decode that
 * would replace anything invalid. A host that honours `responseType` ignores
 * the override entirely, since it only governs how *text* is decoded.
 */
const BINARY_MIME = 'text/plain; charset=x-user-defined';

function fromLatin1(text: string): Bytes {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes as Bytes;
}

function toLatin1(bytes: Bytes): string {
  // Spreading a megabyte of JPEG into one call overflows the argument stack.
  const CHUNK = 0x8000;
  let text = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return text;
}

async function toBytes(response: unknown, responseText: string): Promise<Bytes | null> {
  if (response instanceof ArrayBuffer) return new Uint8Array(response) as Bytes;
  if (response instanceof Blob) return new Uint8Array(await response.arrayBuffer()) as Bytes;
  if (ArrayBuffer.isView(response)) {
    const { buffer, byteOffset, byteLength } = response;
    return new Uint8Array((buffer as ArrayBuffer).slice(byteOffset, byteOffset + byteLength)) as Bytes;
  }
  // An empty body is a body: a host that answers 200 with nothing has still
  // answered, and only one that hands back no readable shape at all is a
  // failure worth reporting.
  if (typeof response === 'string') return fromLatin1(response);
  if (typeof responseText === 'string') return fromLatin1(responseText);
  return null;
}

/** Content-Type out of the raw header block, for rebuilding a typed Blob. */
function contentTypeOf(headers: string | undefined): string {
  const match = /^content-type:\s*(.+)$/im.exec(headers ?? '');
  return match?.[1]?.trim() ?? '';
}

/**
 * A timeout, marked so the retry below can tell it apart.
 *
 * Every other failure is cheap to repeat; this one already cost the full
 * timeout, and waiting it out twice turns a slow network into two minutes of
 * a spinning button.
 */
function timedOut(): Error {
  const error = new Error('Timed out');
  error.name = 'TimeoutError';
  return error;
}

/** How the body goes on the wire. Not a preference - a host capability. */
type BodyEncoding = 'typed' | 'binary-string';

/** As much of a GM response as this script reads, from either callback. */
interface RawResponse {
  status: number;
  response: unknown;
  responseText: string;
  responseHeaders: string;
}

interface Attempt {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body: Bytes | null;
  encoding: BodyEncoding;
  timeoutMs: number;
}

function sendViaGm(attempt: Attempt): Promise<BinaryResponse> {
  return new Promise((resolve, reject) => {
    if (!request) {
      reject(new Error(`${hostName()} has no GM_xmlhttpRequest`));
      return;
    }

    /** Both callbacks carry a full response; only the status tells them apart. */
    const deliver = (response: RawResponse): void => {
      void (async () => {
        const bytes = await toBytes(response.response, response.responseText);
        if (!bytes) {
          reject(new Error(`${hostName()} returned a response this script cannot read`));
          return;
        }
        resolve({
          status: response.status,
          bytes,
          contentType: contentTypeOf(response.responseHeaders),
        });
      })();
    };

    const data =
      attempt.body === null
        ? undefined
        : attempt.encoding === 'typed'
          ? attempt.body
          : toLatin1(attempt.body);

    request({
      method: attempt.method,
      url: attempt.url,
      headers: attempt.headers,
      ...(data === undefined ? {} : { data, binary: true }),
      responseType: 'arraybuffer',
      overrideMimeType: BINARY_MIME,
      timeout: attempt.timeoutMs,
      onload: deliver,
      onerror: (response) => {
        // AdGuard routes every non-2xx through onerror rather than onload, so
        // a plain 404 arrives here with its status intact - and a status is an
        // answer: the request reached the other end and came back. Only a
        // request that never got one is an error. Reading this wrong made the
        // diagnostics report a working transport as a blocked domain.
        if (response.status > 0) {
          deliver(response);
          return;
        }
        // Whatever the host knows about the failure: "network error" alone
        // names neither the host nor the reason, and both were needed to work
        // out that AdGuard was not sending the request at all.
        const detail = response.error || response.statusText || 'network error';
        reject(new Error(`via ${hostName()}: ${detail}`));
      },
      ontimeout: () => reject(timedOut()),
    });
  });
}

/**
 * The same request as an ordinary page fetch.
 *
 * `GM_xmlhttpRequest` exists to dodge CORS, and for an arbitrary image host
 * that is the only thing that works. The Lens endpoint, though, answers a
 * preflight: it allows POST, `content-type` and `x-goog-api-key`, and echoes
 * whatever origin asked. So when a host's own transport cannot be made to
 * work - AdGuard's was failing outright - a plain fetch still reaches Lens.
 *
 * It is the last rung and not the first because it is the leakier one: the
 * browser attaches an `Origin` header that cannot be removed, which tells
 * Google which site the image came from. GM_xmlhttpRequest sends none.
 */
async function sendViaFetch(attempt: Attempt): Promise<BinaryResponse> {
  let response: Response;
  try {
    response = await fetch(attempt.url, {
      method: attempt.method,
      headers: attempt.headers,
      ...(attempt.body === null ? {} : { body: attempt.body }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(attempt.timeoutMs),
    });
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') throw timedOut();
    throw new Error(`via fetch: ${(error as Error).message}`);
  }
  return {
    status: response.status,
    bytes: new Uint8Array(await response.arrayBuffer()) as Bytes,
    contentType: response.headers.get('content-type') ?? '',
  };
}

/**
 * What worked last time, so it is not rediscovered on every image.
 *
 * Two unknowns, both answered by trying. Whether the host's transport works at
 * all: AdGuard's failed outright here, with the request never leaving the
 * device. And which body shape it marshals: a typed array is what every host
 * documents, but a body that arrives mangled looks exactly like a `400` from
 * Lens, so a `400` buys one retry as a binary string.
 *
 * Only the Lens endpoint remembers. It is the one called over and over against
 * the same host, and what works for it says nothing about an arbitrary image
 * host - where a fetch is blocked by the very CORS that GM_xmlhttpRequest is
 * there to dodge.
 */
type Transport = 'gm' | 'fetch';

let workingTransport: Transport | null = null;
let workingEncoding: BodyEncoding | null = null;

interface Rung {
  transport: Transport;
  encoding: BodyEncoding;
}

function ladder(hasBody: boolean, remember: boolean): Rung[] {
  const latchedEncoding = remember ? workingEncoding : null;
  const encodings: BodyEncoding[] = !hasBody
    ? ['typed']
    : latchedEncoding
      ? [latchedEncoding]
      : ['typed', 'binary-string'];

  const rungs: Rung[] = encodings.map((encoding) => ({ transport: 'gm' as const, encoding }));
  rungs.push({ transport: 'fetch', encoding: 'typed' });

  const latchedTransport = remember ? workingTransport : null;
  return latchedTransport ? rungs.filter((rung) => rung.transport === latchedTransport) : rungs;
}

/** The status a mangled body produces, and the only one worth another rung. */
const BAD_REQUEST = 400;

async function climb(attempt: Attempt, remember: boolean): Promise<BinaryResponse> {
  const failures: string[] = [];

  for (const rung of ladder(attempt.body !== null, remember)) {
    const next = { ...attempt, encoding: rung.encoding };
    let response: BinaryResponse;
    try {
      response = rung.transport === 'fetch' ? await sendViaFetch(next) : await sendViaGm(next);
    } catch (error) {
      failures.push((error as Error).message);
      // A timeout has already cost the full wait; paying it again on the next
      // rung turns a slow network into two minutes of a spinning button.
      if ((error as Error).name === 'TimeoutError') break;
      continue;
    }

    if (response.status < 400) {
      if (remember) {
        workingTransport = rung.transport;
        if (rung.transport === 'gm') workingEncoding = rung.encoding;
      }
      return response;
    }

    failures.push(`HTTP ${response.status}`);
    // Anything but a 400 is a real answer from the other end, not a transport
    // that garbled the question.
    if (response.status !== BAD_REQUEST) break;
  }

  throw new Error(failures.join('; ') || 'the request was never sent');
}

export function postBinary(options: {
  url: string;
  headers: Record<string, string>;
  body: Bytes;
  timeoutMs: number;
}): Promise<BinaryResponse> {
  return climb({ ...options, method: 'POST', encoding: 'typed' }, true);
}

export function getBinary(url: string, timeoutMs: number): Promise<BinaryResponse> {
  return climb(
    { method: 'GET', url, headers: {}, body: null, encoding: 'typed', timeoutMs },
    false
  );
}

// --- Diagnostics ------------------------------------------------------------

/**
 * What the host is and what it hands the script.
 *
 * A userscript on a phone has no console anyone can reach, and "network error"
 * on its own names neither the host nor the reason. Everything here is a fact
 * the script can read about itself, so a report can be pasted somewhere useful.
 */
export function hostFacts(): string[] {
  const has = (name: string, value: unknown): string =>
    `${name}: ${typeof value === 'function' ? 'yes' : 'NO'}`;
  return [
    `host: ${GM_info?.scriptHandler ?? 'unknown'} ${GM_info?.version ?? ''}`.trim(),
    `script: ${GM_info?.script?.version ?? 'unknown'}`,
    // A host that grants no unsafeWindow says nothing either way, which is not
    // the same as saying the script is sandboxed.
    `context: ${unsafeWindow === undefined ? 'unknown' : unsafeWindow === window ? 'page (AdGuard-style)' : 'sandbox'}`,
    [
      has('xmlhttpRequest', request),
      has('getValue', GM_getValue),
      has('setValue', GM_setValue),
      has('registerMenuCommand', GM_registerMenuCommand),
    ].join(', '),
  ];
}

/**
 * One rung of the ladder, on its own, so a report can say which one failed.
 *
 * It sends the *shape* of the real request, not a convenient GET. That is not
 * fussiness: a GET to the Lens endpoint is answered `404` with no CORS headers
 * at all, so a page fetch cannot read it and reports the same "Failed to fetch"
 * a blocked domain would. The real POST, with its own headers, comes back `200`
 * with `Access-Control-Allow-Origin` set. Probing with anything else measures
 * the probe.
 */
export async function probe(
  transport: Transport,
  target: { url: string; method: 'GET' | 'POST'; headers: Record<string, string> },
  timeoutMs: number
): Promise<string> {
  const started = Date.now();
  const attempt: Attempt = {
    method: target.method,
    url: target.url,
    headers: target.headers,
    body: target.method === 'POST' ? (new Uint8Array(0) as Bytes) : null,
    encoding: 'typed',
    timeoutMs,
  };
  try {
    const response =
      transport === 'fetch' ? await sendViaFetch(attempt) : await sendViaGm(attempt);
    return `HTTP ${response.status}, ${Date.now() - started} ms`;
  } catch (error) {
    return `${(error as Error).message}, ${Date.now() - started} ms`;
  }
}
