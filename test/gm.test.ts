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
  GM_openInTab: undefined,
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
    // Nothing to wait for: a synchronous read is the stored value from the start.
    expect(gm.storageReady()).toBe(true);
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
    expect(gm.storageReady()).toBe(false);
    expect(await gm.preloadStored(['k'])).toBe(true);
    expect(gm.storageReady()).toBe(true);
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
function fakeRequest(answers: Array<{ status: number; body?: number[]; headers?: string }>): {
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
          responseHeaders: answer?.headers ?? 'Content-Type: image/png\r\n',
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

  test('a redirect the host did not follow is followed by hand', async () => {
    const page = Array.from(new TextEncoder().encode('<html><center>302 Found</center></html>'));
    const { sent, request } = fakeRequest([
      { status: 302, body: page, headers: 'Location: /real.png\r\nContent-Type: text/html\r\n' },
      { status: 200 },
    ]);
    const gm = await loadWith({ GM_xmlhttpRequest: request });
    const response = await gm.getBinary('https://cdn.example/a.png', 1000);
    expect(sent.map((s) => s.url)).toEqual(['https://cdn.example/a.png', 'https://cdn.example/real.png']);
    expect(Array.from(response.bytes)).toEqual([1, 2, 3]);
    expect('location' in response).toBe(false);
  });

  test('a redirect page reported as a 200 with no headers is not taken for the picture', async () => {
    const page = Array.from(new TextEncoder().encode('  <html>302 Found</html>'));
    const { request } = fakeRequest([{ status: 200, body: page, headers: '' }]);
    const gm = await loadWith({ GM_xmlhttpRequest: request });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    try {
      await expect(gm.getBinary('https://cdn.example/a.png', 1000)).rejects.toThrow('a web page, not a picture');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('a page with nowhere to go is retried as a fetch, which follows redirects', async () => {
    const page = Array.from(new TextEncoder().encode('<html>302 Found</html>'));
    const { request } = fakeRequest([{ status: 200, body: page, headers: '' }]);
    const gm = await loadWith({ GM_xmlhttpRequest: request });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([7, 8]), { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch;
    try {
      const response = await gm.getBinary('https://cdn.example/a.png', 1000);
      expect(Array.from(response.bytes)).toEqual([7, 8]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('noFetchFallback: a failed host request is not retried as a page fetch', async () => {
    const gm = await loadWith({
      GM_xmlhttpRequest: (options: Record<string, unknown>) =>
        queueMicrotask(() =>
          (options['onerror'] as (response: unknown) => void)({ status: 0, error: 'blocked' })
        ),
    });
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      return new Response(new Uint8Array([1]));
    }) as unknown as typeof fetch;
    try {
      const url = 'https://raw.githubusercontent.com/x/y/main/locales/ru.json';
      await expect(gm.getBinary(url, 1000, { anonymous: true, noFetchFallback: true })).rejects.toThrow('blocked');
      expect(fetched).toBe(0);
      // Control: without the option the page fetch is the next rung.
      const response = await gm.getBinary(url, 1000, { anonymous: true });
      expect(Array.from(response.bytes)).toEqual([1]);
      expect(fetched).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('noFetchFallback: a web page where a file was asked for is not retried as a fetch either', async () => {
    const page = Array.from(new TextEncoder().encode('<html>blocked</html>'));
    const { request } = fakeRequest([{ status: 200, body: page, headers: 'Content-Type: text/html\r\n' }]);
    const gm = await loadWith({ GM_xmlhttpRequest: request });
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      return new Response(new Uint8Array([1]));
    }) as unknown as typeof fetch;
    try {
      await expect(
        gm.getBinary('https://raw.githubusercontent.com/a.json', 1000, { noFetchFallback: true })
      ).rejects.toThrow('web page');
      expect(fetched).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('a redirect loop ends', async () => {
    const { request } = fakeRequest([{ status: 302, body: [], headers: 'Location: /again\r\n' }]);
    const gm = await loadWith({ GM_xmlhttpRequest: request });
    await expect(gm.getBinary('https://cdn.example/a.png', 1000)).rejects.toThrow('more than 5 times');
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
    expect(sent[0]?.anonymous).toBe(true);
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

  test('when both binary shapes are refused, the request goes as text, and that is kept', async () => {
    // AdGuard for Android: its local API refuses a binary body either way.
    const answer = Array.from(new TextEncoder().encode(btoa('\u0012\u0003abc')));
    const { sent, request } = fakeRequest([{ status: 400 }, { status: 400 }, { status: 200, body: answer }]);
    const gm = await loadWith({ GM_xmlhttpRequest: request });
    const built: number[] = [];
    const post = () =>
      gm.postBinary({
        url: 'https://lensfrontend-pa.googleapis.com/v1/crupload',
        headers: { 'Content-Type': 'application/x-protobuf' },
        body: Uint8Array.from([0, 128, 255]) as never,
        timeoutMs: 1000,
        text: {
          async build(fits) {
            const body = '{"x":"' + 'A'.repeat(70_000) + '"}';
            built.push(fits(body) ? 1 : 0, fits('{"x":1}') ? 1 : 0);
            return { url: 'https://lensfrontend-pa.googleapis.com/v1/crupload?%24alt=proto', headers: { 'Content-Type': 'application/json' }, body: '{"x":1}' };
          },
          decode: (bytes) => Uint8Array.from(atob(new TextDecoder().decode(bytes)), (c) => c.charCodeAt(0)) as never,
        },
      });

    const response = await post();
    expect(response.status).toBe(200);
    expect([...response.bytes]).toEqual([0x12, 0x03, 0x61, 0x62, 0x63]);
    expect(sent).toHaveLength(3);
    expect(sent[2]?.data).toBe('{"x":1}');
    expect(sent[2]?.url).toContain('%24alt=proto');
    expect((sent[2] as unknown as Record<string, unknown>)['binary']).toBeUndefined();
    // Over the host's limit does not fit; a small body does.
    expect(built).toEqual([0, 1]);

    await post();
    expect(sent).toHaveLength(4);
    expect(sent[3]?.data).toBe('{"x":1}');
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

describe('opening a tab for results that arrive later', () => {
  interface FakeTab {
    closed: boolean;
    opener: unknown;
    navigated: string[];
    close(): void;
    location: { replace(url: string): void };
  }

  // The other files' tests run in this process, and one of them decides where
  // to install IndexedDB by whether there is a window.
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  /** A page whose window.open is a spy handing back a controllable tab. */
  function pageWindow(blocked = false): { opened: string[]; tab: FakeTab } {
    const tab: FakeTab = {
      closed: false,
      opener: {},
      navigated: [],
      close() {
        tab.closed = true;
      },
      // No document, as a tab that has gone cross-origin has none to give:
      // this is the path that falls back to assigning the location.
      location: { replace: (url: string) => void tab.navigated.push(url) },
    };
    const opened: string[] = [];
    Object.assign(globalThis, {
      window: {
        open: (url: string) => {
          opened.push(url);
          return blocked ? null : tab;
        },
      },
    });
    return { opened, tab };
  }

  test('a host with GM_openInTab is used, in the foreground, and only once the address is known', async () => {
    const page = pageWindow();
    const calls: unknown[][] = [];
    const gm = await loadWith({
      GM_openInTab: (...args: unknown[]) => {
        calls.push(args);
        return { closed: false };
      },
    });

    expect(gm.opensTabsItself()).toBe(true);
    const tab = gm.prepareTab(true);
    // Nothing is opened ahead of time: the host needs no gesture to spend.
    expect(calls).toHaveLength(0);
    expect(page.opened).toHaveLength(0);

    expect(tab.go('https://www.google.com/search?q=1')).toBe(true);
    // false is "not in the background" under both signatures; an option bag
    // would be truthy, which Greasemonkey reads as the opposite.
    expect(calls).toEqual([['https://www.google.com/search?q=1', false]]);
    expect(page.opened).toHaveLength(0);
  });

  test('the GM4 spelling serves when it is the only one', async () => {
    pageWindow();
    const calls: unknown[][] = [];
    const gm = await loadWith({ GM: { openInTab: (...args: unknown[]) => void calls.push(args) } });
    // Nothing returned is not a refusal: some hosts return nothing at all.
    expect(gm.prepareTab(false).go('https://example.com/r')).toBe(true);
    expect(calls).toEqual([['https://example.com/r', false]]);
  });

  test('a host opener that refuses or throws answers false, so the caller shows a link', async () => {
    const page = pageWindow();
    const refused = await loadWith({ GM_openInTab: () => null });
    expect(refused.prepareTab(true).go('https://example.com/r')).toBe(false);
    const broken = await loadWith({
      GM_openInTab: () => {
        throw new Error('not implemented');
      },
    });
    expect(broken.prepareTab(true).go('https://example.com/r')).toBe(false);
    // And neither reached for window.open after the gesture was spent.
    expect(page.opened).toHaveLength(0);
  });

  test('with no host opener a blank tab is opened at once and navigated later', async () => {
    const page = pageWindow();
    const gm = await loadWith({});
    expect(gm.opensTabsItself()).toBe(false);

    const tab = gm.prepareTab(true);
    // Synchronously, inside what would be the click handler.
    expect(page.opened).toEqual(['about:blank']);
    expect(page.tab.opener).toBeNull();

    expect(tab.go('https://www.google.com/search?q=2')).toBe(true);
    expect(page.tab.navigated).toEqual(['https://www.google.com/search?q=2']);
  });

  test('without preopen nothing is opened and go answers false', async () => {
    const page = pageWindow();
    const gm = await loadWith({});
    expect(gm.prepareTab(false).go('https://example.com/r')).toBe(false);
    expect(page.opened).toHaveLength(0);
  });

  test('a blocked popup answers false', async () => {
    pageWindow(true);
    const gm = await loadWith({});
    expect(gm.prepareTab(true).go('https://example.com/r')).toBe(false);
  });

  test('cancel closes the waiting tab, and a closed tab answers false', async () => {
    const page = pageWindow();
    const gm = await loadWith({});
    const tab = gm.prepareTab(true);
    tab.cancel();
    expect(page.tab.closed).toBe(true);
    expect(tab.go('https://example.com/r')).toBe(false);
    expect(page.tab.navigated).toHaveLength(0);
  });
});
