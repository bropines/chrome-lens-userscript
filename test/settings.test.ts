import { describe, expect, mock, test } from 'bun:test';
import { EN } from '../src/i18n/en.js';

/**
 * The settings schema, and what is done with a settings file somebody hands in.
 *
 * `$` stands in for the host, as in gm.test.ts, because settings.ts reads its
 * store through gm.ts. The module keeps what it read, so a scenario that needs
 * different stored values takes a fresh copy.
 */

type SettingsModule = typeof import('../src/settings.js');

let copy = 0;
async function load(stored = new Map<string, unknown>()): Promise<SettingsModule> {
  mock.module('$', () => ({
    GM: undefined,
    GM_getValue: (key: string, fallback: unknown) => stored.get(key) ?? fallback,
    GM_setValue: (key: string, value: unknown) => void stored.set(key, value),
    GM_info: undefined,
    GM_openInTab: undefined,
    GM_registerMenuCommand: undefined,
    GM_setClipboard: undefined,
    GM_xmlhttpRequest: undefined,
    unsafeWindow: undefined,
  }));
  copy += 1;
  await import(`../src/gm.ts?settings=${copy}`);
  return (await import(`../src/settings.ts?settings=${copy}`)) as SettingsModule;
}

const KEY = 'lens-translate:settings';
const dictionary = EN as Record<string, string>;

describe('every setting has a place in the window', () => {
  test('each key of the defaults has exactly one field, and no field is for anything else', async () => {
    const { DEFAULTS, FIELDS } = await load();
    const keys = FIELDS.map((field) => field.key as string).sort();
    expect(keys).toEqual(Object.keys(DEFAULTS).sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('each field is on a real tab, and every tab that holds fields has some', async () => {
    const { FIELDS, TABS } = await load();
    for (const field of FIELDS) expect(TABS as readonly string[]).toContain(field.tab);
    const used = new Set(FIELDS.map((field) => field.tab));
    // Sites and About hold no setting: one is the per-site rules, the other is
    // what the script knows about itself.
    expect(TABS.filter((tab) => !used.has(tab))).toEqual(['sites', 'about']);
  });

  test('every field, choice and tab has its words in the dictionary', async () => {
    const { FIELDS, TABS } = await load();
    for (const field of FIELDS) {
      expect(dictionary[`set.${field.key}.label`]).toBeString();
      for (const value of field.options ?? []) {
        expect(`${field.key}=${value}: ${typeof dictionary[`set.${field.key}.opt.${value}`]}`).toBe(
          `${field.key}=${value}: string`
        );
      }
      // A select has its values one way or the other, never neither.
      if (field.type === 'select') expect(Boolean(field.options) !== Boolean(field.choices)).toBe(true);
    }
    for (const tab of TABS) expect(dictionary[`tab.${tab}`]).toBeString();
  });

  test('the dictionary names no setting that does not exist', async () => {
    const { DEFAULTS } = await load();
    for (const key of Object.keys(dictionary)) {
      const setting = /^set\.([A-Za-z]+)\./.exec(key)?.[1];
      if (setting) expect(Object.keys(DEFAULTS)).toContain(setting);
    }
  });

  test('every field explains itself, except where the label is the whole story', async () => {
    const { FIELDS, fieldHint } = await load();
    const bare = FIELDS.filter((field) => !fieldHint(field)).map((field) => field.key as string);
    // Selects whose choices carry the explanation, and the shortcut rows.
    expect(bare.sort()).toEqual(
      [
        'buttonCorner', 'enabled', 'eraseMode', 'hotkey', 'keyArea', 'keyAsk', 'keyCopy', 'keySearch',
        'keyTranslateAll', 'keyUndoAll', 'renderMode', 'searchTheme', 'sourceLang', 'targetLang', 'textAlign',
        'timeZone',
        'uiMode', 'verticalText',
      ].sort()
    );
  });

  test('the simple interface keeps a short list', async () => {
    const { FIELDS } = await load();
    expect(FIELDS.filter((field) => field.essential).map((field) => field.key)).toEqual([
      'uiMode', 'language', 'enabled', 'popupOpacity', 'targetLang', 'sourceLang', 'mangaMode', 'buttonMode',
    ]);
  });

  test('a default is a value its own field accepts unchanged', async () => {
    const { DEFAULTS, FIELDS, sanitize } = await load();
    for (const field of FIELDS) {
      expect(`${field.key}=${String(sanitize(field, DEFAULTS[field.key]))}`).toBe(
        `${field.key}=${String(DEFAULTS[field.key])}`
      );
    }
  });

  test('a search finds a field by its label, its hint or its key', async () => {
    const { FIELDS, fieldMatches } = await load();
    const field = FIELDS.find((candidate) => candidate.key === 'jpegQuality');
    if (!field) throw new Error('no jpegQuality field');
    expect(fieldMatches(field, 'upload')).toBe(true);
    expect(fieldMatches(field, 'CHROMIUM')).toBe(true);
    expect(fieldMatches(field, 'jpeg')).toBe(true);
    expect(fieldMatches(field, 'manga')).toBe(false);
    expect(fieldMatches(field, '  ')).toBe(true);
  });
});

describe('reading the form', () => {
  test('megabytes are typed and bytes are stored', async () => {
    const { FIELDS, coerce, shown } = await load();
    const field = FIELDS.find((candidate) => candidate.key === 'cacheBytes');
    if (!field) throw new Error('no cacheBytes field');
    expect(coerce(field, '64')).toBe(64 * 1024 * 1024);
    expect(shown(field, 32 * 1024 * 1024)).toBe('32');
    expect(coerce(field, '0')).toBe(0);
  });

  test('a number is held to its range, and an emptied field is the default, not zero', async () => {
    const { DEFAULTS, FIELDS, coerce } = await load();
    const by = (key: string) => {
      const field = FIELDS.find((candidate) => candidate.key === key);
      if (!field) throw new Error(`no ${key} field`);
      return field;
    };
    expect(coerce(by('concurrency'), '40')).toBe(6);
    expect(coerce(by('concurrency'), '0')).toBe(1);
    expect(coerce(by('holdMs'), '')).toBe(DEFAULTS.holdMs);
    expect(coerce(by('timeoutMs'), 'soon')).toBe(DEFAULTS.timeoutMs);
    expect(coerce(by('popupOpacity'), '62')).toBe(60);
  });

  test('a select of numbers stores a number', async () => {
    const { FIELDS, coerce } = await load();
    const field = FIELDS.find((candidate) => candidate.key === 'supersample');
    if (!field) throw new Error('no supersample field');
    expect(coerce(field, '3')).toBe(3);
    expect(coerce(field, '9')).toBe(2);
  });
});

describe('importing a settings file', () => {
  test('an exported file comes back as it went out', async () => {
    const { DEFAULTS, exportSettings, importSettings } = await load();
    const changed = { ...DEFAULTS, targetLang: 'de', outlineScale: 2.5, mangaMode: true, keySearch: 'Alt+KeyS' };
    const report = importSettings(JSON.parse(exportSettings(changed, '9.9.9')) as unknown);
    expect(report?.patch).toEqual(changed);
    expect(report?.unknown).toEqual([]);
    expect(report?.invalid).toEqual([]);
    expect(report?.applied.length).toBe(Object.keys(DEFAULTS).length);
  });

  test('a bare object of settings is accepted too', async () => {
    const { importSettings } = await load();
    expect(importSettings({ targetLang: 'ja' })?.patch).toEqual({ targetLang: 'ja' });
  });

  test('unknown keys are ignored and named', async () => {
    const { importSettings } = await load();
    const report = importSettings({ targetLang: 'ja', batchHotkey: true, __proto__x: 1 });
    expect(report?.patch).toEqual({ targetLang: 'ja' });
    expect(report?.unknown.sort()).toEqual(['__proto__x', 'batchHotkey']);
  });

  test('a value of the wrong type or outside its choices is refused, key by key', async () => {
    const { importSettings } = await load();
    const report = importSettings({
      mangaMode: 'yes',
      outlineScale: '2',
      eraseMode: 'laser',
      targetLang: 'klingon',
      textColor: 'red',
      apiKey: 42,
      lineSpacing: Number.NaN,
      fitToBox: false,
    });
    expect(report?.patch).toEqual({ fitToBox: false });
    expect(report?.invalid.sort()).toEqual(
      ['apiKey', 'eraseMode', 'lineSpacing', 'mangaMode', 'outlineScale', 'targetLang', 'textColor'].sort()
    );
  });

  test('values are brought into shape: ranges, colours, chords, the button list', async () => {
    const { importSettings } = await load();
    const report = importSettings({
      outlineScale: 99,
      concurrency: -3,
      textColor: '#AABBCC',
      fillColor: '',
      keyAsk: 'shift+alt+KeyQ',
      keyCopy: 'nonsense+',
      buttons: 'menu*,translate,bogus,translate*',
      supersample: 3,
      fontWeight: '700',
      cacheBytes: 5e12,
    });
    expect(report?.invalid).toEqual([]);
    expect(report?.patch).toEqual({
      outlineScale: 8,
      concurrency: 1,
      textColor: '#aabbcc',
      fillColor: '',
      keyAsk: 'Alt+Shift+KeyQ',
      keyCopy: '',
      buttons: 'menu*,translate,search,ask,area,objects,text,copy,settings',
      supersample: 3,
      fontWeight: 700,
      cacheBytes: 1024 * 1024 * 1024,
    });
  });

  test('what is not a settings file is refused whole', async () => {
    const { importSettings } = await load();
    for (const raw of [null, 'text', 7, [], {}, { 'lens-translate': '1.0.0' }, { 'lens-translate': '1', settings: [] }]) {
      expect(importSettings(raw)).toBeNull();
    }
  });
});

describe('stored settings from an older version', () => {
  test('defaults fill what is missing, and keys that no longer exist are dropped', async () => {
    const stored = new Map<string, unknown>([[KEY, JSON.stringify({ targetLang: 'uk', longGone: 1 })]]);
    const { DEFAULTS, getSettings } = await load(stored);
    const settings = getSettings() as unknown as Record<string, unknown>;
    expect(settings['targetLang']).toBe('uk');
    expect(settings['buttons']).toBe(DEFAULTS.buttons);
    expect('longGone' in settings).toBe(false);
  });

  test('a translate-all shortcut that was switched off stays off', async () => {
    const off = new Map<string, unknown>([[KEY, JSON.stringify({ batchHotkey: false })]]);
    expect((await load(off)).getSettings().keyTranslateAll).toBe('');
    const on = new Map<string, unknown>([[KEY, JSON.stringify({ batchHotkey: true })]]);
    expect((await load(on)).getSettings().keyTranslateAll).toBe('Alt+Shift+KeyT');
    // Once the new setting exists it is the one that counts.
    const both = new Map<string, unknown>([
      [KEY, JSON.stringify({ batchHotkey: false, keyTranslateAll: 'Ctrl+KeyB' })],
    ]);
    expect((await load(both)).getSettings().keyTranslateAll).toBe('Ctrl+KeyB');
  });

  test('re-wrapping was a switch: on stays on, off stays off, never stored is auto', async () => {
    const stored = (value: unknown) => new Map<string, unknown>([[KEY, JSON.stringify({ reflowHorizontal: value })]]);
    expect((await load(stored(true))).getSettings().reflowHorizontal).toBe('on');
    expect((await load(stored(false))).getSettings().reflowHorizontal).toBe('auto');
    expect((await load(stored('on'))).getSettings().reflowHorizontal).toBe('on');
    expect((await load()).getSettings().reflowHorizontal).toBe('auto');
    // And a file exported while it was a switch still imports.
    const { importSettings } = await load();
    expect(importSettings({ reflowHorizontal: true })?.patch).toEqual({ reflowHorizontal: 'on' });
    expect(importSettings({ reflowHorizontal: false })?.patch).toEqual({ reflowHorizontal: 'auto' });
    expect(importSettings({ reflowHorizontal: 'sometimes' })?.invalid).toEqual(['reflowHorizontal']);
  });

  test('saving writes one string, as every host can keep', async () => {
    const stored = new Map<string, unknown>();
    const { saveSettings } = await load(stored);
    saveSettings({ mangaMode: true });
    expect(typeof stored.get(KEY)).toBe('string');
    expect((JSON.parse(stored.get(KEY) as string) as { mangaMode: boolean }).mangaMode).toBe(true);
  });
});

describe('a form that was opened, not edited', () => {
  const by = (fields: ReadonlyArray<{ key: string }>, key: string) => {
    const field = fields.find((candidate) => candidate.key === key);
    if (!field) throw new Error(`no ${key} field`);
    return field as never;
  };

  test('legacy values nobody touched are not rewritten, and the form is not dirty', async () => {
    // 0.92 is not on the slider's 0.05 grid, and 0 is under the new minimum of 10.
    const stored = new Map<string, unknown>([[KEY, JSON.stringify({ jpegQuality: 0.92, minImageSize: 0 })]]);
    const { FIELDS, formPatch, getSettings, saveSettings, settingsDiffer } = await load(stored);
    const saved = getSettings();
    // What the controls read when drawn and now: the slider snapped, the number did not.
    const patch = formPatch([
      [by(FIELDS, 'jpegQuality'), '0.9', '0.9'],
      [by(FIELDS, 'minImageSize'), '0', '0'],
      [by(FIELDS, 'mangaMode'), false, false],
    ]);
    expect(patch).toEqual({});
    const now = { ...saved, ...patch };
    expect(settingsDiffer(now, saved)).toBe(false);
    saveSettings(now);
    const written = JSON.parse(stored.get(KEY) as string) as Record<string, unknown>;
    expect(written['jpegQuality']).toBe(0.92);
    expect(written['minImageSize']).toBe(0);
  });

  test('a field that was changed is coerced, and only that one', async () => {
    const stored = new Map<string, unknown>([[KEY, JSON.stringify({ jpegQuality: 0.92, minImageSize: 0 })]]);
    const { FIELDS, formPatch, getSettings, settingsDiffer } = await load(stored);
    const patch = formPatch([
      [by(FIELDS, 'jpegQuality'), '0.9', '0.9'],
      [by(FIELDS, 'minImageSize'), '5', '0'],
      [by(FIELDS, 'mangaMode'), true, false],
    ]);
    expect(patch).toEqual({ minImageSize: 10, mangaMode: true });
    expect(settingsDiffer({ ...getSettings(), ...patch }, getSettings())).toBe(true);
  });

  test('changed and changed back is no change', async () => {
    const { FIELDS, formPatch } = await load();
    expect(formPatch([[by(FIELDS, 'targetLang'), 'ru', 'ru']])).toEqual({});
  });
});

describe('a font stack is only a font stack', () => {
  test('what would end the CSS declaration is taken out, and the length is capped', async () => {
    const { cleanFontFamily } = await load();
    expect(cleanFontFamily('"Comic Neue", sans-serif')).toBe('"Comic Neue", sans-serif');
    expect(cleanFontFamily('Arial; background: url(x)')).toBe('Arial background: url(x)');
    expect(cleanFontFamily('a{}<b>\nc\\')).toBe('abc');
    expect(cleanFontFamily('x'.repeat(500))).toHaveLength(200);
  });

  test('an imported file cannot put a declaration into the overlay', async () => {
    const { importSettings } = await load();
    const report = importSettings({ fontFamily: 'serif; position: fixed; inset: 0 }</style><script>' });
    const font = report?.patch.fontFamily ?? '';
    expect(font).not.toMatch(/[;{}<>]/);
    expect(report?.applied).toEqual(['fontFamily']);
  });

  test('typed into the form, the same', async () => {
    const { FIELDS, coerce } = await load();
    const field = FIELDS.find((candidate) => candidate.key === 'fontFamily');
    if (!field) throw new Error('no fontFamily field');
    expect(coerce(field, ' Georgia;\n color: red ')).toBe('Georgia color: red');
  });

  test('a value an earlier import left in the store is cleaned on the way out', async () => {
    const stored = new Map<string, unknown>([[KEY, JSON.stringify({ fontFamily: 'serif; color: red' })]]);
    expect((await load(stored)).getSettings().fontFamily).toBe('serif color: red');
  });

  test('an imported chord is held to what the form would record', async () => {
    const { importSettings } = await load();
    const report = importSettings({ keyTranslate: 'KeyT', keySearch: 'Ctrl+KeyS' });
    expect(report?.patch).toEqual({ keyTranslate: '', keySearch: 'Ctrl+KeyS' });
  });
});
