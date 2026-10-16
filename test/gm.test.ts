import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * gm.ts against fake hosts.
 *
 * `$` is the module vite-plugin-monkey makes out of the host's globals, so
 * replacing it is replacing the host. `vite-plugin-monkey` captures them when
 * the bundle starts, which is why every scenario imports a fresh copy of the
 * module under a query string: a different host needs a different evaluation.
 */

type Gm = typeof import('../src/gm.js');

const NO_HOST = {
  GM: undefined,
  GM_getValue: undefined,
  GM_setValue: undefined,
  GM_info: undefined,
  GM_registerMenuCommand: undefined,
  GM_setClipboard: undefined,
  GM_xmlhttpRequest: undefined,
  unsafeWindow: undefined,
};

let copy = 0;
async function loadWith(host: Record<string, unknown>): Promise<Gm> {
  mock.module('$', () => ({ ...NO_HOST, ...host }));
  copy += 1;
  return (await import(`../src/gm.ts?host=${copy}`)) as Gm;
}

/** A page whose localStorage is a spy, so "did not fall back to it" is checkable. */
function pageStorage(): Map<string, string> {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
      },
    },
  });
  return data;
}

beforeEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('storage on a host with the synchronous API', () => {
  test('reads and writes through GM_getValue and GM_setValue, as strings', async () => {
    const backing = new Map<string, unknown>();
    const gm = await loadWith({
      GM_getValue: (key: string, fallback: unknown) => backing.get(key) ?? fallback,
      GM_setValue: (key: string, value: unknown) => void backing.set(key, value),
    });
    gm.writeStored('k', { a: 1 });
    // A string, never the object: AdGuard for Android hands an object back
    // until the page reloads and then loses it.
    expect(backing.get('k')).toBe('{"a":1}');
    expect(gm.readStored('k')).toBe('{"a":1}');
    expect(await gm.preloadStored(['k'])).toBe(false);
  });
});

describe('storage on a host with only the promise API', () => {
  test('values are loaded once at startup and read synchronously afterwards', async () => {
    const storage = pageStorage();
    const backing = new Map<string, unknown>([['k', '{"saved":true}']]);
    const gm = await loadWith({
      GM: {
        getValue: async (key: string, fallback: unknown) => backing.get(key) ?? fallback,
        setValue: async (key: string, value: unknown) => void backing.set(key, value),
      },
    });

    // Before the load there is nothing to read - and it is not the site's.
    expect(gm.readStored('k')).toBeNull();
    expect(await gm.preloadStored(['k'])).toBe(true);
    expect(gm.readStored('k')).toBe('{"saved":true}');
    expect(storage.size).toBe(0);
  });

  test('a write goes to the host and is readable at once', async () => {
    const storage = pageStorage();
    const backing = new Map<string, unknown>();
    const gm = await loadWith({
      GM: {
        getValue: async (key: string, fallback: unknown) => backing.get(key) ?? fallback,
        setValue: async (key: string, value: unknown) => void backing.set(key, value),
      },
    });
    await gm.preloadStored(['k']);
    gm.writeStored('k', { n: 2 });
    expect(gm.readStored('k')).toBe('{"n":2}');
    await Promise.resolve();
    expect(backing.get('k')).toBe('{"n":2}');
    // The regression: these used to land in the site's localStorage, which is
    // what made settings per-site on Safari.
    expect(storage.size).toBe(0);
  });

  test('a key that cannot be read is empty, not an error', async () => {
    const gm = await loadWith({
      GM: {
        getValue: async () => {
          throw new Error('denied');
        },
        setValue: async () => {},
      },
    });
    expect(await gm.preloadStored(['k'])).toBe(true);
    expect(gm.readStored('k')).toBeNull();
  });
});

describe('storage on a host with neither', () => {
  test('falls back to localStorage, forgetful rather than broken', async () => {
    const storage = pageStorage();
    const gm = await loadWith({});
    gm.writeStored('k', 'v');
    expect(storage.get('lens-translate:k')).toBe('"v"');
    expect(gm.readStored('k')).toBe('"v"');
    expect(await gm.preloadStored(['k'])).toBe(false);
  });

  test('and survives a page with no storage at all', async () => {
    const gm = await loadWith({});
    expect(() => gm.writeStored('k', 'v')).not.toThrow();
    expect(gm.readStored('k')).toBeNull();
  });
});

describe('the clipboard', () => {
  // The page is replaced for these, and the layout tests that run after them
  // want the one test/setup.ts made.
  const original = { document: globalThis.document, navigator: globalThis.navigator };
  afterEach(() => {
    Object.assign(globalThis, original);
  });

  const page = (clipboard: unknown, execCommand?: () => boolean): { appended: unknown[] } => {
    const appended: unknown[] = [];
    Object.assign(globalThis, {
      navigator: { clipboard },
      document: {
        createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }),
        body: { appendChild: (node: unknown) => appended.push(node) },
        execCommand: execCommand ?? (() => false),
      },
    });
    return { appended };
  };

  test('the host comes first: it asks nothing of the page', async () => {
    const copied: Array<[string, string]> = [];
    const gm = await loadWith({
      GM_setClipboard: (text: string, type: string) => void copied.push([text, type]),
    });
    page({ writeText: () => Promise.reject(new Error('should not be reached')) });
    expect(await gm.copyText('hello')).toBe(true);
    expect(copied).toEqual([['hello', 'text']]);
  });

  test('the promise spelling counts as the host', async () => {
    const copied: string[] = [];
    const gm = await loadWith({
      GM: { setClipboard: async (text: string) => void copied.push(text) },
    });
    expect(await gm.copyText('hi')).toBe(true);
    expect(copied).toEqual(['hi']);
  });

  test('with no host call, the page clipboard', async () => {
    const written: string[] = [];
    const gm = await loadWith({});
    page({ writeText: async (text: string) => void written.push(text) });
    expect(await gm.copyText('page')).toBe(true);
    expect(written).toEqual(['page']);
  });

  test('refused by the page, the old way is tried', async () => {
    const gm = await loadWith({});
    page({ writeText: () => Promise.reject(new Error('not focused')) }, () => true);
    expect(await gm.copyText('legacy')).toBe(true);
  });

  test('and when nothing takes it, false rather than a throw', async () => {
    const gm = await loadWith({});
    page(undefined, () => false);
    expect(await gm.copyText('nowhere')).toBe(false);
  });
});

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  anonymous?: boolean;
  data?: unknown;
}

/** A GM_xmlhttpRequest that records what it was asked and answers from a script. */
function fakeRequest(answers: Array<{ status: number; body?: number[] }>): {
  sent: Sent[];
  request: (options: Record<string, unknown>) => void;
} {
  const sent: Sent[] = [];
  return {
    sent,
    request(options) {
      sent.push(options as unknown as Sent);
      const answer = answers[Math.min(sent.length - 1, answers.length - 1)];
      const body = new Uint8Array(answer?.body ?? [1, 2, 3]).buffer;
      queueMicrotask(() =>
        (options['onload'] as (response: unknown) => void)({
          status: answer?.status ?? 200,
          response: body,
          responseText: '',
          responseHeaders: 'Content-Type: image/png\r\n',
        })
      );
    },
  };
}

describe('fetching an image', () => {
  test('sends the page as Referer, with cookies, as the <img> would have', async () => {
    const { sent, request } = fakeRequest([{ status: 200 }]);
    const gm = await loadWith({ GM_xmlhttpRequest: request });

    const response = await gm.getBinary('https://i.pximg.net/a.png', 1000, {
      referer: 'https://www.pixiv.net/artworks/1',
    });

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('image/png');
    expect(Array.from(response.bytes)).toEqual([1, 2, 3]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe('GET');
    expect(sent[0]?.headers).toEqual({ Referer: 'https://www.pixiv.net/artworks/1' });
    expect(sent[0]?.anonymous).toBe(false);
  });

  test('without a page to name, sends no Referer rather than an empty one', async () => {
    const { sent, request } = fakeRequest([{ status: 200 }]);
    const gm = await loadWith({ GM_xmlhttpRequest: request });
    await gm.getBinary('https://example.com/a.png', 1000);
    expect(sent[0]?.headers).toEqual({});
  });

  test('the Lens POST is not given cookies or a Referer', async () => {
    const { sent, request } = fakeRequest([{ status: 200 }]);
    const gm = await loadWith({ GM_xmlhttpRequest: request });
    await gm.postBinary({
      url: 'https://lensfrontend-pa.googleapis.com/v1/crupload',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: new Uint8Array([9]) as never,
      timeoutMs: 1000,
    });
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.headers).toEqual({ 'Content-Type': 'application/x-protobuf' });
    expect(sent[0]?.anonymous).toBeUndefined();
  });
});

describe('the body encoding ladder', () => {
  test('a 400 buys one retry as a binary string, and the shape that works is kept', async () => {
    const { sent, request } = fakeRequest([{ status: 400 }, { status: 200 }, { status: 200 }]);
    const gm = await loadWith({ GM_xmlhttpRequest: request });
    const post = () =>
      gm.postBinary({
        url: 'https://lensfrontend-pa.googleapis.com/v1/crupload',
        headers: {},
        body: Uint8Array.from([0, 128, 255]) as never,
        timeoutMs: 1000,
      });

    expect((await post()).status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.data).toBeInstanceOf(Uint8Array);
    // Every byte value survives as a code unit, which is what makes the string
    // shape lossless.
    expect(sent[1]?.data).toBe('\u0000\u0080ÿ');

    await post();
    expect(sent).toHaveLength(3);
    expect(typeof sent[2]?.data).toBe('string');
  });

  test('any other status is a real answer and is not retried', async () => {
    const { sent, request } = fakeRequest([{ status: 403 }]);
    const gm = await loadWith({ GM_xmlhttpRequest: request });
    await expect(
      gm.postBinary({
        url: 'https://lensfrontend-pa.googleapis.com/v1/crupload',
        headers: {},
        body: Uint8Array.from([1]) as never,
        timeoutMs: 1000,
      })
    ).rejects.toThrow(/HTTP 403/);
    expect(sent).toHaveLength(1);
  });
});
