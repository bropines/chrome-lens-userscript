import {
  GM,
  GM_getValue,
  GM_info,
  GM_openInTab,
  GM_registerMenuCommand,
  GM_setClipboard,
  GM_setValue,
  GM_xmlhttpRequest,
  unsafeWindow,
} from '$';
import type {
  BinaryRequest,
  BinaryResponse,
  GetOptions,
  Transport as EngineTransport,
} from './transport.js';
import type { Bytes } from './types.js';

export type { BinaryResponse };

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

/** Which build is actually running, which a phone has no other way to say. */
export const scriptVersion = (): string => GM_info?.script?.version ?? 'unknown';

/** Only ever used to word an error; never to decide behaviour. */
export function hostName(): string {
  return GM_info?.scriptHandler ?? 'The userscript host';
}

// --- Storage ----------------------------------------------------------------

/**
 * Three places a value can live, in order of preference.
 *
 * 1. The synchronous `GM_getValue`/`GM_setValue` - Tampermonkey, Violentmonkey
 *    and AdGuard.
 * 2. The GM4 `GM.getValue`/`GM.setValue`, which return promises and are all
 *    that Greasemonkey 4 and Safari's Userscripts publish. There is no reading
 *    one of those synchronously, so the values are loaded once at startup into
 *    `loaded` (see `preloadStored`) and written through to both.
 * 3. `localStorage`, the last resort and not the default: AdGuard runs in the
 *    page's context, so its `localStorage` is the *site's*, and settings saved
 *    on one domain would not exist on the next. Falling to it silently was how
 *    a Safari user's settings became per-site without anyone being told.
 */
const LOCAL_PREFIX = 'lens-translate:';

const hasAsyncStorage = (): boolean =>
  typeof GM_getValue !== 'function' && typeof GM?.getValue === 'function';

/** What the async API returned at startup, plus whatever has been written since. */
const loaded = new Map<string, unknown>();

/**
 * Bring the keys into memory when the host can only hand them over by promise.
 *
 * Resolves true when it actually loaded something, which is the signal to read
 * the settings again: everything that ran before this settled saw defaults. On
 * a host with the synchronous API there is nothing to do and nothing changes.
 */
export async function preloadStored(keys: string[]): Promise<boolean> {
  if (!hasAsyncStorage()) return false;
  await Promise.all(
    keys.map(async (key) => {
      try {
        loaded.set(key, await GM.getValue<unknown>(key, null));
      } catch {
        // A key that cannot be read is a key with nothing in it.
      }
    })
  );
  preloaded = true;
  return true;
}

let preloaded = false;

/**
 * Whether a synchronous read now says what is stored.
 *
 * Always on a host with the synchronous API; on a promise-only one, only once
 * a preload has settled. Before that every key reads empty, which is the same
 * answer as "never stored" - and acting on it re-does whatever was kept.
 */
export const storageReady = (): boolean => preloaded || !hasAsyncStorage();

export function readStored(key: string): unknown {
  if (typeof GM_getValue === 'function') return GM_getValue<unknown>(key, null);
  if (hasAsyncStorage()) return loaded.get(key) ?? null;
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
  if (typeof GM?.setValue === 'function') {
    // Remembered here as well, so a read straight after a write sees it
    // without waiting for the promise.
    loaded.set(key, encoded);
    void Promise.resolve(GM.setValue(key, encoded)).catch(() => {});
    return;
  }
  try {
    window.localStorage.setItem(LOCAL_PREFIX + key, encoded);
  } catch {
    // Private mode, or a quota that a page has already filled. Nothing to do.
  }
}

// --- Clipboard --------------------------------------------------------------

/**
 * Put text on the clipboard by whichever way this host allows.
 *
 * The host's own call comes first because it asks nothing of the page: the
 * asynchronous clipboard API wants a secure context and a focused document, and
 * fails on plain-http pages and when the click that led here landed in a shadow
 * root the page does not consider focused. The old `execCommand` is last and
 * works nearly everywhere a user gesture is in flight, which is why it is still
 * there. Resolves false, rather than throwing, when nothing took it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return true;
    }
    if (typeof GM?.setClipboard === 'function') {
      await GM.setClipboard(text, 'text');
      return true;
    }
  } catch {
    // Fall through to the page's own.
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused for want of focus or a gesture; the textarea route may not be.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

// --- Opening a tab ----------------------------------------------------------

/**
 * A tab that is asked for now and told where to go later.
 *
 * A search's address exists only after Lens has answered, and by then the tap
 * that asked for it is spent: a browser lets a page open a tab during a user
 * gesture, before the first await, and calls anything later a popup. So the
 * two halves are separate. `prepareTab` runs inside the tap handler,
 * synchronously, and `go` runs when the address is known.
 *
 * Which half does the work depends on the host:
 *
 * - One with `GM_openInTab` opens tabs from its own privileged side, where no
 *   gesture is needed, so nothing happens until `go`.
 * - One without it has only `window.open`. With `preopen` the tab is opened
 *   blank at once and navigated afterwards. Without, nothing is opened and
 *   `go` answers false - which is the caller's cue to show the address as a
 *   real link for the user to tap, the one way that is known to work
 *   everywhere, a shadow root on a phone included.
 *
 * `preopen` is the caller's to decide because it is not free: on a phone the
 * blank tab takes the screen for the length of an upload, and `window.open`
 * on AdGuard for Android has never been seen to work at all. `go` answering
 * false is always a possibility and the link is always the fallback.
 */
export interface PendingTab {
  /** Send the tab to its address. False when no tab could be opened for it. */
  go(url: string): boolean;
  /** The address never came: close whatever was opened on its account. */
  cancel(): void;
}

/**
 * The host's own opener, under either name.
 *
 * The second argument is `false` and not an option bag on purpose. The legacy
 * signature and the GM4 one both read it as "open in the background", and an
 * object is truthy - so `{ active: true }` asks Greasemonkey for the opposite
 * of what it says. `false` means the foreground to every host.
 */
function hostOpener(): ((url: string, background: boolean) => unknown) | null {
  if (typeof GM_openInTab === 'function') return (url, background) => GM_openInTab(url, background);
  if (typeof GM?.openInTab === 'function') return (url, background) => GM.openInTab(url, background);
  return null;
}

/** Whether results can be opened with no gesture to spend, by the host itself. */
export const opensTabsItself = (): boolean => hostOpener() !== null;

function openWindow(url: string): Window | null {
  try {
    // Not `noopener` in the feature string: that makes the call return null
    // whether or not it worked, and whether it worked is the whole question.
    const tab = window.open(url, '_blank');
    if (tab) {
      try {
        tab.opener = null;
      } catch {
        // Already navigated cross-origin; the address is Google's either way.
      }
    }
    return tab ?? null;
  } catch {
    return null;
  }
}

/**
 * Navigate a tab this page opened, without naming this page as where from.
 *
 * Assigning the tab's location makes this page the source of the navigation,
 * so its origin goes out as the `Referer`. A link inside the blank tab makes
 * the blank tab the source, and `noreferrer` on it sends none at all.
 */
function navigate(tab: Window, url: string): void {
  try {
    const link = tab.document.createElement('a');
    link.href = url;
    link.rel = 'noreferrer';
    tab.document.body.appendChild(link);
    link.click();
  } catch {
    tab.location.replace(url);
  }
}

export interface TabOptions {
  /**
   * Open behind the current tab. Only a host's own opener can: `window.open`
   * always takes the foreground, so without one this changes nothing.
   */
  background?: boolean;
  /** What the blank tab says while the address is still being worked out. */
  waiting?: string;
}

export function prepareTab(preopen: boolean, options: TabOptions = {}): PendingTab {
  const viaHost = hostOpener();
  if (viaHost) {
    return {
      go(url) {
        try {
          const tab = viaHost(url, options.background === true) as { closed?: boolean } | null | false | undefined;
          // Hosts return a tab control, a window, a promise or nothing at all.
          // Only an explicit refusal is read as one.
          return tab !== null && tab !== false && tab?.closed !== true;
        } catch {
          // A host that lists the function and cannot run it.
          return false;
        }
      },
      cancel() {},
    };
  }

  const tab = preopen ? openWindow('about:blank') : null;
  if (tab) {
    try {
      // A blank page for the length of an upload reads as something broken.
      tab.document.title = 'Lens';
      tab.document.body.textContent = options.waiting ?? 'Searching with Lens...';
    } catch {
      // Cosmetic.
    }
  }
  return {
    go(url) {
      if (!tab || tab.closed) return false;
      try {
        navigate(tab, url);
        return true;
      } catch {
        return false;
      }
    },
    cancel() {
      try {
        tab?.close();
      } catch {
        // Not ours to close any more.
      }
    },
  };
}

// --- Commands ---------------------------------------------------------------

export interface Command {
  /** A name the panel can ask for one by: its About tab draws two of them itself. */
  id: string;
  /** What the host's menu shows, where it sits among every other script's. */
  menuLabel: string;
  /**
   * What our own panel shows, or null for one the panel makes redundant. A
   * function, because the panel can be redrawn in a language that arrived
   * after the command was registered; the host's menu cannot, and keeps the
   * words it was given.
   */
  label: (() => string) | null;
  /** Worth showing even in the panel's short form, where most are left out. */
  essential?: boolean;
  run(): void;
}

export interface PanelCommand {
  id: string;
  label: string;
  essential: boolean;
  run(): void;
}

const commands: Command[] = [];

/**
 * Register a command with the host's menu, and remember it either way.
 *
 * On AdGuard there is no menu, and these are the only way to reach clearing
 * the cache or undoing a page, so the settings panel renders whatever the host
 * would not take.
 *
 * `toMenu` false keeps it to the panel: a frame registering with the host would
 * add a second copy of every command to the tab's one menu.
 */
export function registerCommand(command: Command, toMenu = true): void {
  commands.push(command);
  if (toMenu && typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand(command.menuLabel, command.run);
  }
}

export function panelCommands(): PanelCommand[] {
  const out: PanelCommand[] = [];
  for (const command of commands) {
    if (command.label !== null) {
      out.push({
        id: command.id,
        label: command.label(),
        essential: command.essential === true,
        run: command.run,
      });
    }
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

function locationOf(headers: string | undefined): string {
  const match = /^location:\s*(.+)$/im.exec(headers ?? '');
  return match?.[1]?.trim() ?? '';
}

/** A response, plus the one header a redirect needs. Never leaves this file. */
type HostResponse = BinaryResponse & { location?: string };

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
  /**
   * Whether to send the host's cookies, for the host's transport only.
   *
   * `false` is a browser's own default for an <img>, and hotlink protection
   * that keys on a session needs it. Hosts without the option ignore it.
   */
  withCookies?: boolean;
  body: Bytes | null;
  encoding: BodyEncoding;
  timeoutMs: number;
}

function sendViaGm(attempt: Attempt): Promise<HostResponse> {
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
        const location = locationOf(response.responseHeaders);
        resolve({
          status: response.status,
          bytes,
          contentType: contentTypeOf(response.responseHeaders),
          ...(location ? { location } : {}),
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
      ...(attempt.withCookies === undefined ? {} : { anonymous: !attempt.withCookies }),
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

function ladder(hasBody: boolean, remember: boolean, allowFetch: boolean): Rung[] {
  const latchedEncoding = remember ? workingEncoding : null;
  const encodings: BodyEncoding[] = !hasBody
    ? ['typed']
    : latchedEncoding
      ? [latchedEncoding]
      : ['typed', 'binary-string'];

  const rungs: Rung[] = encodings.map((encoding) => ({ transport: 'gm' as const, encoding }));
  if (allowFetch) rungs.push({ transport: 'fetch', encoding: 'typed' });

  const latchedTransport = remember ? workingTransport : null;
  return latchedTransport ? rungs.filter((rung) => rung.transport === latchedTransport) : rungs;
}

/** The status a mangled body produces, and the only one worth another rung. */
const BAD_REQUEST = 400;

async function climb(attempt: Attempt, remember: boolean, allowFetch = true): Promise<HostResponse> {
  const failures: string[] = [];

  for (const rung of ladder(attempt.body !== null, remember, allowFetch)) {
    const next = { ...attempt, encoding: rung.encoding };
    let response: HostResponse;
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

/**
 * A POST to Lens. It carries no cookies: the API key is the whole of its
 * authentication, and a host left to its default (Tampermonkey's sends them)
 * would hand Google the user's session with every picture.
 */
export function postBinary(options: BinaryRequest): Promise<BinaryResponse> {
  return climb({ ...options, method: 'POST', encoding: 'typed', withCookies: false }, true);
}

/** Enough hops for a CDN's chain; more than that is a loop. */
const MAX_REDIRECTS = 5;

/** An HTML page where a picture was asked for: an error or a redirect page. */
function isWebPage(response: BinaryResponse): boolean {
  // An SVG starts with '<' too, and says what it is.
  if (/^image\//i.test(response.contentType)) return false;
  if (/text\/html/i.test(response.contentType)) return true;
  for (const byte of response.bytes) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    return byte === 0x3c; // '<'
  }
  return false;
}

/**
 * Fetch an image the way the page's own <img> would.
 *
 * AdGuard's GM_xmlhttpRequest does not follow redirects: an nginx "302 Found"
 * page arrives as a successful response, sometimes with no headers at all, and
 * it used to be handed on as if it were the picture. So a 3xx with a Location
 * is followed here, by hand; and a web page with nowhere to go gets one try as
 * an ordinary fetch, which does follow redirects (it works where the host
 * sends CORS headers) - and otherwise an error that says what came back,
 * rather than "could not decode the image" three steps later.
 */
export async function getBinary(
  url: string,
  timeoutMs: number,
  options: GetOptions = {}
): Promise<BinaryResponse> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await getOnce(current, timeoutMs, options);
    const redirected = response.status >= 300 && response.status < 400;
    if ((redirected || isWebPage(response)) && response.location) {
      current = new URL(response.location, current).href;
      continue;
    }
    if ((redirected || isWebPage(response)) && options.noFetchFallback === true) {
      throw new Error(`the host answered with a web page, not the file (HTTP ${response.status})`);
    }
    if (redirected || isWebPage(response)) {
      try {
        const page = await sendViaFetch({
          method: 'GET',
          url: current,
          headers: {},
          body: null,
          encoding: 'typed',
          timeoutMs,
        });
        if (page.status < 400 && !isWebPage(page)) return page;
      } catch {
        // CORS or the network; the error below is the more useful one.
      }
      throw new Error(`the image host answered with a web page, not a picture (HTTP ${response.status})`);
    }
    const { location: _location, ...plain } = response;
    return plain;
  }
  throw new Error(`the image host redirected more than ${MAX_REDIRECTS} times`);
}

function getOnce(url: string, timeoutMs: number, options: GetOptions): Promise<HostResponse> {
  return climb(
    {
      method: 'GET',
      url,
      // `Referer` is a forbidden header for a page fetch and a perfectly good
      // one for a privileged request, which is the whole reason to be here.
      headers: options.referer ? { Referer: options.referer } : {},
      body: null,
      encoding: 'typed',
      timeoutMs,
      // The same request the <img> would have made, cookies included - unless
      // the caller is fetching something public and said so.
      withCookies: options.anonymous !== true,
    },
    false,
    options.noFetchFallback !== true
  );
}

/**
 * This host, as the transport the engine asks for.
 *
 * The engine knows it needs a privileged cross-origin POST and nothing more;
 * which host is running, what it does with a typed array and where a blocked
 * domain is undone are all answered here.
 */
export const gmTransport: EngineTransport = {
  post: postBinary,
  get: getBinary,
  hint: () =>
    hostName() === 'Tampermonkey'
      ? ' If Tampermonkey blocked this domain, clear it under Settings > Security > Blocked domains.'
      : '',
};

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
      has('getValue', GM_getValue ?? GM?.getValue),
      has('setValue', GM_setValue ?? GM?.setValue),
      has('registerMenuCommand', GM_registerMenuCommand),
      has('openInTab', GM_openInTab ?? GM?.openInTab),
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
