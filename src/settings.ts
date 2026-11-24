import { readStored, writeStored } from './gm.js';
import { t, tMaybe } from './i18n/index.js';
import type { Key } from './i18n/index.js';
import { LOCALES, ownName } from './i18n/locale.js';
import { languageOptions } from './languages.js';
import { DEFAULT_BUTTONS, parseButtons, serializeButtons } from './ui/buttons.js';
import { MAX_OPACITY, MIN_OPACITY, OPACITY_STEP, clampOpacity } from './ui/opacity.js';
import { normalizeChord } from './ui/shortcuts.js';
import type { Settings } from './types.js';

const STORAGE_KEY = 'lens-translate:settings';

/** Every key this module reads, for a host that has to be asked for them ahead of time. */
export const SETTINGS_KEYS: string[] = [STORAGE_KEY];

const MB = 1024 * 1024;

export const DEFAULTS: Settings = {
  targetLang: 'ru',
  sourceLang: '',
  ocrLang: '',
  region: 'US',
  timeZone: 'America/New_York',
  // The key Chromium ships with; also used by owocr and chrome-lens-ocr.
  apiKey: 'AIzaSyDr2UxVnv_U85AbhhY8XSHSIavUW0DC-sY',
  timeoutMs: 60000,
  minImageSize: 50,
  // Chromium's image budget: components/lens/lens_features.cc
  maxArea: 1500000,
  maxSide: 1600,
  tileLongImages: 'auto',
  jpegQuality: 0.4,
  showButton: true,
  videoButton: false,
  autoTranslate: false,
  autoVisible: 0.5,
  autoMinPx: 200,
  autoTextCheck: true,
  autoPerMinute: 20,
  buttonMode: 'auto',
  hotkey: 'alt',
  keyTranslateAll: 'Alt+Shift+KeyT',
  keyTranslate: '',
  keySearch: '',
  keyAsk: '',
  keyArea: '',
  keyCopy: '',
  keyUndoAll: '',
  peekKey: 'off',
  fontFamily: '',
  fontWeight: 400,
  textColor: '',
  outlineColor: '',
  fillColor: '',
  drawBackground: true,
  patchPadding: 1,
  verticalText: 'auto',
  renderMode: 'canvas',
  enabled: true,
  minReadablePx: 12,
  supersample: 2,
  maxCanvasSide: 8000,
  mangaMinPx: 14,
  cacheBytes: 32 * MB,
  storeBytes: 32 * MB,
  persistCache: true,
  mangaMode: false,
  mangaBoxGrowth: 1.45,
  outlineScale: 1,
  eraseMode: 'patch',
  hullPadding: 0.45,
  reflowHorizontal: 'auto',
  bubbleShape: true,
  fitToBox: true,
  lineSpacing: 1.25,
  textAlign: 'auto',
  uiMode: 'simple',
  aiPrompt: 'What is in this picture?',
  frames: true,
  popupOpacity: MAX_OPACITY,
  language: 'auto',
  coverOpacity: 100,
  buttons: DEFAULT_BUTTONS,
  mainAction: 'translate',
  longPressAction: 'peek',
  repeatLast: false,
  buttonSize: 'm',
  buttonCorner: 'tr',
  idleOpacity: 100,
  hideDelayMs: 300,
  extrasDelayMs: 550,
  buttonLabels: false,
  holdMs: 350,
  concurrency: 2,
  rememberQuestion: false,
  searchLang: '',
  searchTheme: 'auto',
  backgroundTabs: false,
};

/**
 * The tabs of the settings window, in order.
 *
 * `sites` and `about` hold no field: one is the per-site rules, which are not
 * settings and are not saved with them, the other is what the script knows
 * about itself. They are listed here so the order is in one place.
 */
export const TABS = [
  'general',
  'translation',
  'search',
  'appearance',
  'buttons',
  'behaviour',
  'sites',
  'advanced',
  'about',
] as const;

export type Tab = (typeof TABS)[number];

export type FieldKind = 'text' | 'number' | 'checkbox' | 'select' | 'range' | 'color' | 'chord' | 'buttons';

/**
 * One setting as the window draws it, and as an imported file is checked
 * against it.
 *
 * It carries no words. A field's label is `set.<key>.label`, its hint
 * `set.<key>.hint` and a choice `set.<key>.opt.<value>` in the dictionary, so
 * the schema and its translations cannot disagree about which fields exist -
 * the tests walk this list and ask the dictionary for each.
 */
export interface Field<K extends keyof Settings = keyof Settings> {
  key: K;
  type: FieldKind;
  tab: Tab;
  /**
   * Shown in the simple interface too. Everything else is still in force
   * there, at whatever it was last set to - only out of the way.
   */
  essential?: boolean;
  step?: number;
  min?: number;
  max?: number;
  /**
   * How a range's value reads out: 'x' for a multiplier, '%' for a fraction,
   * 'pct' for a value that is already a whole number of percent.
   */
  unit?: 'x' | '%' | 'pct';
  /** Stored value = shown value times this. Bytes are stored, megabytes typed. */
  scale?: number;
  /** A select's values; each one's label is in the dictionary. */
  options?: readonly string[];
  /** A select whose labels are not ours to translate: the names of languages. */
  choices?: () => ReadonlyArray<readonly [string, string]>;
  /** Takes the full width where short fields sit two to a row. */
  wide?: boolean;
}

const interfaceLanguages = (): Array<readonly [string, string]> => [
  ['auto', t('lang.auto')],
  ['en', ownName('en')],
  ...LOCALES.map((code) => [code, ownName(code)] as const),
];

export const FIELDS: ReadonlyArray<Field> = [
  // General
  { key: 'uiMode', tab: 'general', essential: true, type: 'select', options: ['simple', 'pro'] },
  { key: 'language', tab: 'general', essential: true, type: 'select', choices: interfaceLanguages },
  { key: 'enabled', tab: 'general', essential: true, type: 'checkbox' },
  { key: 'autoTranslate', tab: 'general', essential: true, type: 'checkbox' },
  {
    key: 'popupOpacity', tab: 'general', essential: true, type: 'range',
    min: MIN_OPACITY, max: MAX_OPACITY, step: OPACITY_STEP, unit: 'pct',
  },

  // Translation
  { key: 'targetLang', tab: 'translation', essential: true, type: 'select', choices: () => languageOptions() },
  {
    key: 'sourceLang', tab: 'translation', essential: true, type: 'select',
    choices: () => languageOptions(t('lang.detect')),
  },
  { key: 'ocrLang', tab: 'translation', type: 'select', choices: () => languageOptions(t('lang.followTarget')) },
  { key: 'mangaMode', tab: 'translation', essential: true, type: 'checkbox' },
  { key: 'renderMode', tab: 'translation', type: 'select', options: ['canvas', 'overlay'] },
  { key: 'concurrency', tab: 'translation', type: 'number', min: 1, max: 6, step: 1 },

  // Search
  { key: 'aiPrompt', tab: 'search', type: 'text', wide: true },
  { key: 'rememberQuestion', tab: 'search', type: 'checkbox' },
  { key: 'backgroundTabs', tab: 'search', type: 'checkbox' },
  {
    key: 'searchLang', tab: 'search', type: 'select',
    choices: () => languageOptions(t('lang.sameAsTranslation')),
  },
  { key: 'searchTheme', tab: 'search', type: 'select', options: ['auto', 'light', 'dark'] },

  // Appearance
  { key: 'fontFamily', tab: 'appearance', type: 'text', wide: true },
  { key: 'fontWeight', tab: 'appearance', type: 'select', options: ['300', '400', '500', '600', '700', '800'] },
  { key: 'textAlign', tab: 'appearance', type: 'select', options: ['auto', 'left', 'center', 'right'] },
  { key: 'textColor', tab: 'appearance', type: 'color' },
  { key: 'outlineColor', tab: 'appearance', type: 'color' },
  { key: 'outlineScale', tab: 'appearance', type: 'range', min: 0, max: 8, step: 0.1, unit: 'x', wide: true },
  { key: 'minReadablePx', tab: 'appearance', type: 'number', min: 0, max: 64, step: 1 },
  { key: 'verticalText', tab: 'appearance', type: 'select', options: ['auto', 'keep', 'horizontal'] },
  { key: 'reflowHorizontal', tab: 'appearance', type: 'select', options: ['off', 'auto', 'on'] },
  { key: 'bubbleShape', tab: 'appearance', type: 'checkbox' },
  { key: 'fitToBox', tab: 'appearance', type: 'checkbox' },
  { key: 'lineSpacing', tab: 'appearance', type: 'range', min: 0.8, max: 2, step: 0.05, unit: 'x' },
  { key: 'mangaBoxGrowth', tab: 'appearance', type: 'number', min: 1, max: 3, step: 0.05 },
  { key: 'mangaMinPx', tab: 'appearance', type: 'number', min: 0, max: 64, step: 1 },
  { key: 'drawBackground', tab: 'appearance', type: 'checkbox' },
  { key: 'eraseMode', tab: 'appearance', type: 'select', options: ['patch', 'hull'] },
  { key: 'fillColor', tab: 'appearance', type: 'color' },
  { key: 'hullPadding', tab: 'appearance', type: 'range', min: 0, max: 2, step: 0.05, unit: '%' },
  { key: 'patchPadding', tab: 'appearance', type: 'range', min: 0, max: 3, step: 0.05, unit: 'x' },
  { key: 'supersample', tab: 'appearance', type: 'select', options: ['1', '2', '3'] },
  { key: 'coverOpacity', tab: 'appearance', type: 'range', min: 20, max: 100, step: 5, unit: 'pct' },

  // Buttons
  { key: 'showButton', tab: 'buttons', type: 'checkbox' },
  { key: 'videoButton', tab: 'buttons', type: 'checkbox' },
  { key: 'buttonMode', tab: 'buttons', essential: true, type: 'select', options: ['auto', 'hover', 'pinned'] },
  { key: 'buttons', tab: 'buttons', type: 'buttons', wide: true },
  { key: 'mainAction', tab: 'buttons', type: 'select', options: ['translate', 'search', 'ask', 'area', 'menu'] },
  {
    key: 'longPressAction', tab: 'buttons', type: 'select',
    options: ['peek', 'translate', 'search', 'ask', 'area', 'menu', 'none'],
  },
  { key: 'repeatLast', tab: 'buttons', type: 'checkbox' },
  { key: 'buttonLabels', tab: 'buttons', type: 'checkbox' },
  { key: 'buttonSize', tab: 'buttons', type: 'select', options: ['s', 'm', 'l'] },
  { key: 'buttonCorner', tab: 'buttons', type: 'select', options: ['tr', 'tl', 'br', 'bl'] },
  { key: 'idleOpacity', tab: 'buttons', type: 'range', min: 20, max: 100, step: 5, unit: 'pct' },
  { key: 'hideDelayMs', tab: 'buttons', type: 'number', min: 0, max: 5000, step: 50 },
  { key: 'extrasDelayMs', tab: 'buttons', type: 'number', min: 0, max: 5000, step: 50 },
  { key: 'holdMs', tab: 'buttons', type: 'number', min: 150, max: 2000, step: 50 },

  // Behaviour
  { key: 'hotkey', tab: 'behaviour', type: 'select', options: ['alt', 'ctrl', 'shift', 'none'] },
  { key: 'peekKey', tab: 'behaviour', type: 'select', options: ['off', 'backquote', 'shift', 'control'] },
  { key: 'keyTranslateAll', tab: 'behaviour', type: 'chord' },
  { key: 'keyTranslate', tab: 'behaviour', type: 'chord' },
  { key: 'keySearch', tab: 'behaviour', type: 'chord' },
  { key: 'keyAsk', tab: 'behaviour', type: 'chord' },
  { key: 'keyArea', tab: 'behaviour', type: 'chord' },
  { key: 'keyCopy', tab: 'behaviour', type: 'chord' },
  { key: 'keyUndoAll', tab: 'behaviour', type: 'chord' },
  { key: 'minImageSize', tab: 'behaviour', type: 'number', min: 10, max: 2000, step: 10 },
  { key: 'autoVisible', tab: 'behaviour', type: 'range', min: 0.2, max: 1, step: 0.05, unit: '%' },
  { key: 'autoMinPx', tab: 'behaviour', type: 'number', min: 50, max: 2000, step: 10 },
  { key: 'autoTextCheck', tab: 'behaviour', type: 'checkbox' },
  { key: 'autoPerMinute', tab: 'behaviour', type: 'number', min: 1, max: 120, step: 1 },
  { key: 'frames', tab: 'behaviour', type: 'checkbox' },

  // Advanced
  { key: 'jpegQuality', tab: 'advanced', type: 'range', min: 0.1, max: 1, step: 0.05, unit: '%' },
  { key: 'maxArea', tab: 'advanced', type: 'number', min: 100000, max: 16000000, step: 100000 },
  { key: 'maxSide', tab: 'advanced', type: 'number', min: 400, max: 8000, step: 100 },
  { key: 'tileLongImages', tab: 'advanced', type: 'select', options: ['auto', 'off'] },
  { key: 'timeoutMs', tab: 'advanced', type: 'number', min: 5000, max: 300000, step: 1000 },
  { key: 'cacheBytes', tab: 'advanced', type: 'number', min: 0, max: 1024, step: 4, scale: MB },
  { key: 'persistCache', tab: 'advanced', type: 'checkbox' },
  { key: 'storeBytes', tab: 'advanced', type: 'number', min: 0, max: 1024, step: 4, scale: MB },
  { key: 'maxCanvasSide', tab: 'advanced', type: 'number', min: 2000, max: 16000, step: 500 },
  { key: 'region', tab: 'advanced', type: 'text' },
  { key: 'timeZone', tab: 'advanced', type: 'text' },
  { key: 'apiKey', tab: 'advanced', type: 'text', wide: true },
];

export const fieldLabel = (field: Field): string => t(`set.${field.key}.label` as Key);
export const fieldHint = (field: Field): string | undefined => tMaybe(`set.${field.key}.hint`);

/** A select's choices as `[value, label]`, in the language of the moment. */
export function fieldChoices(field: Field): ReadonlyArray<readonly [string, string]> {
  if (field.choices) return field.choices();
  return (field.options ?? []).map(
    (value) => [value, tMaybe(`set.${field.key}.opt.${value}`) ?? value] as const
  );
}

/**
 * Whether a field answers a search, by what a person would type to find it:
 * its label, its hint, or the setting's own name for someone who has seen an
 * exported file.
 */
export function fieldMatches(field: Field, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [fieldLabel(field), fieldHint(field) ?? '', field.key].some((text) =>
    text.toLowerCase().includes(needle)
  );
}

let cache: Settings | null = null;

/**
 * Defaults, with whatever was stored laid over them.
 *
 * Only keys that still exist are taken, so a setting an older version wrote
 * and this one dropped does not ride along for ever - and into every exported
 * file. Values are taken as they are: what an older version considered valid
 * is not second-guessed here.
 */
function merge(stored: Record<string, unknown>): Settings {
  const merged: Record<string, unknown> = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (Object.hasOwn(stored, key) && stored[key] !== undefined) merged[key] = stored[key];
  }
  // The translate-all shortcut used to be a switch. Someone who had turned it
  // off must not find it bound again because the setting changed shape.
  if (stored['batchHotkey'] === false && !Object.hasOwn(stored, 'keyTranslateAll')) {
    merged['keyTranslateAll'] = '';
  }
  // The one exception to taking values as they are: this one is written into
  // CSS, and an earlier version's import let anything through to the store.
  merged['fontFamily'] =
    typeof merged['fontFamily'] === 'string' ? cleanFontFamily(merged['fontFamily']) : DEFAULTS.fontFamily;
  // Re-wrapping was a switch, off by default, and saving wrote every key - so a
  // stored false is what everyone who ever saved anything has, and it says
  // they left the default alone, not that they refused something: turning it
  // off took no action. It reads as the new default. A stored true was chosen
  // and stays on.
  if (typeof merged['reflowHorizontal'] === 'boolean') {
    merged['reflowHorizontal'] = merged['reflowHorizontal'] ? 'on' : 'auto';
  }
  return merged as unknown as Settings;
}

export function getSettings(): Settings {
  if (!cache) {
    let stored: Record<string, unknown> = {};
    try {
      const raw = readStored(STORAGE_KEY);
      const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>;
    } catch {
      stored = {};
    }
    cache = merge(stored);
  }
  return cache;
}

/** Read the store again, after something that was not there the first time arrived. */
export function reloadSettings(): Settings {
  cache = null;
  return getSettings();
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch };
  writeStored(STORAGE_KEY, cache);
  return cache;
}

export function resetSettings(): Settings {
  cache = { ...DEFAULTS };
  writeStored(STORAGE_KEY, cache);
  return cache;
}

type Value = Settings[keyof Settings];

const COLOUR = /^#[0-9a-f]{6}$/i;

function clampTo(field: Field, value: number): number {
  const scale = field.scale ?? 1;
  let out = value;
  if (field.min !== undefined) out = Math.max(field.min * scale, out);
  if (field.max !== undefined) out = Math.min(field.max * scale, out);
  return out;
}

/**
 * A value of the right type for the field, or undefined when it cannot be one.
 *
 * `raw` is a stored value or one on its way to being stored - a number for a
 * number, never the megabytes or the percent sign the form shows. This is the
 * one place that decides what a setting may hold, so the form and an imported
 * file are held to the same thing.
 */
export function sanitize(field: Field, raw: unknown): Value | undefined {
  const fallback = DEFAULTS[field.key];
  switch (field.type) {
    case 'checkbox':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'number':
    case 'range': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
      if (field.key === 'popupOpacity') return clampOpacity(raw);
      return clampTo(field, raw);
    }
    case 'select': {
      // An exported file from before this was a choice still imports.
      if (field.key === 'reflowHorizontal' && typeof raw === 'boolean') return (raw ? 'on' : 'auto') as Settings[keyof Settings];
      const text = String(raw);
      if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
      if (!fieldChoices(field).some(([value]) => value === text)) return undefined;
      return typeof fallback === 'number' ? Number(text) : (text as Value);
    }
    case 'color':
      if (typeof raw !== 'string') return undefined;
      return raw === '' || COLOUR.test(raw) ? raw.toLowerCase() : undefined;
    case 'chord':
      // An unreadable chord is no chord, which is a value: the shortcut is off.
      return typeof raw === 'string' ? normalizeChord(raw) : undefined;
    case 'buttons':
      return typeof raw === 'string' ? serializeButtons(parseButtons(raw)) : undefined;
    case 'text':
      if (typeof raw !== 'string') return undefined;
      return field.key === 'fontFamily' ? cleanFontFamily(raw) : raw.trim();
  }
}

/** Longer than any real font stack; past it the value is not a list of fonts. */
const FONT_FAMILY_MAX = 200;

/**
 * A font stack that can only be a font stack.
 *
 * It is written into the DOM renderer's `cssText`, so a `;` there ends the
 * declaration and starts another one of the file's choosing, and braces or
 * angle brackets have no business in a family name at all. An imported file is
 * somebody else's, which is how that value would arrive.
 */
export function cleanFontFamily(raw: string): string {
  return raw
    .replace(/[;{}<>\\\r\n\t\f\v]/g, '')
    .trim()
    .slice(0, FONT_FAMILY_MAX)
    .trim();
}

/** What a control holds as the form reads it: its text, or a checkbox's state. */
export type FormValue = string | boolean;

/**
 * The settings a form actually changed.
 *
 * Each entry is a field, what its control reads now and what it read when it
 * was drawn. Only a control that reads differently is coerced: coercing the
 * lot rewrote values nobody touched - a stored 0.92 snapped to a slider's 0.9,
 * a 0 that an older version allowed clamped up to the new minimum - and made
 * an untouched form look edited.
 */
export function formPatch(
  entries: Iterable<readonly [Field, FormValue, FormValue]>
): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const [field, now, initial] of entries) {
    if (now === initial) continue;
    patch[field.key] = coerce(field, now);
  }
  return patch as Partial<Settings>;
}

/** Whether two sets of values differ in any setting the window shows. */
export function settingsDiffer(a: Settings, b: Settings): boolean {
  return FIELDS.some((field) => a[field.key] !== b[field.key]);
}

/** Turn a form value back into the type the setting is declared with. */
export function coerce(field: Field, raw: string | boolean): Value {
  let candidate: unknown = raw;
  if (field.type === 'checkbox') candidate = Boolean(raw);
  else if (field.type === 'number' || field.type === 'range') {
    // An emptied number field is not zero; it is nothing, and so the default.
    candidate = String(raw).trim() === '' ? Number.NaN : Number(raw) * (field.scale ?? 1);
    if (field.scale && Number.isFinite(candidate)) candidate = Math.round(candidate as number);
  }
  return sanitize(field, candidate) ?? DEFAULTS[field.key];
}

/** A stored value as the form shows it. */
export function shown(field: Field, value: Value): string {
  if (field.scale && typeof value === 'number') return String(Math.round((value / field.scale) * 10) / 10);
  return String(value);
}

// --- export and import ------------------------------------------------------

/** What marks a file as ours, so somebody else's JSON is refused by name. */
const EXPORT_MARK = 'lens-translate';

export function exportSettings(settings: Settings, version: string): string {
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULTS).sort()) ordered[key] = settings[key as keyof Settings];
  return `${JSON.stringify({ [EXPORT_MARK]: version, settings: ordered }, null, 2)}\n`;
}

export interface ImportReport {
  /** The settings that were understood, ready to lay over the current ones. */
  patch: Partial<Settings>;
  applied: string[];
  /** Keys this version has no setting for. */
  unknown: string[];
  /** Known keys whose value is not one the setting can hold. */
  invalid: string[];
}

/**
 * Read an exported file - or a bare object of settings, for one written by
 * hand - and keep what can be used.
 *
 * Null when it is not an object of settings at all. Everything else is a
 * partial success and says so: a file from a newer version imports what this
 * one knows and names the rest, which is more use than refusing the lot.
 */
export function importSettings(raw: unknown): ImportReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const outer = raw as Record<string, unknown>;
  const inner = Object.hasOwn(outer, EXPORT_MARK) ? outer['settings'] : outer;
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return null;

  const report: ImportReport = { patch: {}, applied: [], unknown: [], invalid: [] };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inner as Record<string, unknown>)) {
    const field = FIELDS.find((candidate) => candidate.key === key);
    if (!field) {
      report.unknown.push(key);
      continue;
    }
    const clean = sanitize(field, value);
    if (clean === undefined) {
      report.invalid.push(key);
      continue;
    }
    patch[key] = clean;
    report.applied.push(key);
  }
  report.patch = patch as Partial<Settings>;
  return report.applied.length || report.unknown.length || report.invalid.length ? report : null;
}
