import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * Per-site rules against a host whose storage is a map.
 *
 * `$` stands in for the host, as in gm.test.ts. sites.ts keeps its rules in
 * module state, so each scenario takes a fresh copy of it.
 */

type Sites = typeof import('../src/sites.js');

let copy = 0;
async function load(stored: Map<string, unknown>): Promise<Sites> {
  mock.module('$', () => ({
    GM: undefined,
    GM_getValue: (key: string, fallback: unknown) => stored.get(key) ?? fallback,
    GM_setValue: (key: string, value: unknown) => void stored.set(key, value),
    GM_info: undefined,
    GM_registerMenuCommand: undefined,
    GM_setClipboard: undefined,
    GM_xmlhttpRequest: undefined,
    unsafeWindow: undefined,
  }));
  copy += 1;
  // A fresh gm.ts too: sites.ts imports it, and it captured the previous host.
  await import(`../src/gm.ts?sites=${copy}`);
  return (await import(`../src/sites.ts?sites=${copy}`)) as Sites;
}

describe('per-site rules', () => {
  let stored: Map<string, unknown>;
  beforeEach(() => {
    stored = new Map();
  });

  test('a site nobody has said anything about is the default', async () => {
    const sites = await load(stored);
    expect(sites.siteMode('example.com')).toBe('default');
  });

  test('a choice is remembered, and survives a reload of the script', async () => {
    const first = await load(stored);
    first.setSiteMode('off', 'example.com');
    first.setSiteMode('auto', 'reader.example.org');
    expect(first.siteMode('example.com')).toBe('off');

    // Same storage, new evaluation: what a page reload does.
    const second = await load(stored);
    expect(second.siteMode('example.com')).toBe('off');
    expect(second.siteMode('reader.example.org')).toBe('auto');
    expect(second.siteMode('other.example')).toBe('default');
  });

  test('choosing the default removes the rule instead of storing it', async () => {
    const sites = await load(stored);
    sites.setSiteMode('off', 'example.com');
    sites.setSiteMode('default', 'example.com');
    expect(JSON.parse(String(stored.get(sites.SITES_KEY)))).toEqual({});
  });

  test('www is the same site', async () => {
    const sites = await load(stored);
    sites.setSiteMode('off', sites.hostOf('WWW.Example.com'));
    expect(sites.siteMode(sites.hostOf('example.com'))).toBe('off');
    expect(sites.hostOf('www.example.com')).toBe('example.com');
    // Only a leading one.
    expect(sites.hostOf('awww.example.com')).toBe('awww.example.com');
  });

  test('a subdomain is a different site', async () => {
    const sites = await load(stored);
    sites.setSiteMode('off', 'example.com');
    expect(sites.siteMode('reader.example.com')).toBe('default');
  });

  test('stored rubbish is no rule, rather than an error', async () => {
    stored.set('lens-translate:sites', '{not json');
    const sites = await load(stored);
    expect(sites.siteMode('example.com')).toBe('default');

    stored.set('lens-translate:sites', JSON.stringify({ 'a.com': 'surprise', 'b.com': 'off' }));
    const again = await load(stored);
    expect(again.siteMode('a.com')).toBe('default');
    expect(again.siteMode('b.com')).toBe('off');
  });

  test('an object an older host handed back is read as well as a string', async () => {
    stored.set('lens-translate:sites', { 'c.com': 'auto' });
    const sites = await load(stored);
    expect(sites.siteMode('c.com')).toBe('auto');
  });
});
