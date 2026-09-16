import { GM_getValue, GM_setValue } from '$';
import { languageOptions } from './languages.js';
import type { Settings } from './types.js';

const STORAGE_KEY = 'lens-translate:settings';

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
  jpegQuality: 0.4,
  showButton: true,
  hotkey: 'alt',
  fontFamily: '',
  drawBackground: true,
  verticalText: 'auto',
  renderMode: 'canvas',
  enabled: true,
  minReadablePx: 12,
  supersample: 2,
  cacheBytes: 32 * 1024 * 1024,
  mangaMode: false,
  mangaBoxGrowth: 1.45,
  outlineScale: 1,
  eraseMode: 'patch',
  hullPadding: 0.45,
  textAlign: 'auto',
};

type FieldKind = 'text' | 'number' | 'checkbox' | 'select' | 'range';

export interface Field<K extends keyof Settings = keyof Settings> {
  key: K;
  label: string;
  type: FieldKind;
  /** Section heading this field is filed under in the panel. */
  group: string;
  hint?: string;
  step?: string;
  min?: string;
  max?: string;
  /** How a range's value reads out: 'x' for a multiplier, '%' for a fraction. */
  unit?: 'x' | '%';
  options?: ReadonlyArray<readonly [string, string]>;
}

export const GROUPS = [
  'Languages',
  'Layout',
  'Erasing the original',
  'Legibility',
  'Behaviour',
  'Advanced',
] as const;

export const FIELDS: ReadonlyArray<Field> = [
  { key: 'enabled', group: 'Behaviour', label: 'Translation enabled', type: 'checkbox' },
  {
    key: 'renderMode', group: 'Behaviour',
    label: 'Render as',
    type: 'select',
    options: [
      ['canvas', 'canvas - a picture laid over the image (default)'],
      ['overlay', 'overlay - crisp text, can drift on dynamic pages'],
    ],
  },
  { key: 'targetLang', group: 'Languages', label: 'Translate to', type: 'select', options: languageOptions() },
  {
    key: 'sourceLang', group: 'Languages',
    label: 'Translate from',
    type: 'select',
    options: languageOptions('Detect automatically'),
  },
  {
    key: 'ocrLang', group: 'Languages',
    label: 'OCR language hint',
    type: 'select',
    options: languageOptions('Follow the target'),
  },
  {
    key: 'verticalText', group: 'Layout',
    label: 'Vertical CJK text',
    type: 'select',
    options: [
      ['auto', 'auto - vertical only for CJK targets'],
      ['keep', 'keep - always vertical, like Chromium'],
      ['horizontal', 'horizontal - always reflow'],
    ],
  },
  {
    key: 'textAlign',
    group: 'Layout',
    label: 'Text alignment',
    type: 'select',
    options: [
      ['auto', 'auto - follow the source, like Chromium'],
      ['left', 'left'],
      ['center', 'center'],
      ['right', 'right'],
    ],
  },
  {
    key: 'mangaMode', group: 'Layout',
    label: 'Manga mode',
    type: 'checkbox',
    hint: 'always reflow vertical text, widen the layout area, bigger minimum size',
  },
  {
    key: 'mangaBoxGrowth', group: 'Layout',
    label: 'Bubble fill (manga mode)',
    type: 'number',
    step: '0.05',
    hint: 'how far past the detected text box to lay out; 1 = exactly the box',
  },
  { key: 'drawBackground', group: 'Erasing the original', label: 'Erase the original text', type: 'checkbox' },
  {
    key: 'eraseMode', group: 'Erasing the original',
    label: 'How to erase',
    type: 'select',
    options: [
      ['patch', "patch - the server's inpainting, like Chromium"],
      ['hull', 'hull - cover the whole text area with its background colour'],
    ],
  },
  {
    key: 'hullPadding', group: 'Erasing the original',
    label: 'Cover margin',
    type: 'range',
    min: '0',
    max: '2',
    step: '0.05',
    unit: '%',
    hint: 'how far past the text the cover extends, relative to line height',
  },
  {
    key: 'outlineScale', group: 'Legibility',
    label: 'Text outline',
    type: 'range',
    min: '0',
    max: '8',
    step: '0.1',
    unit: 'x',
    hint: 'thickens the outline behind translated text; 0 removes it',
  },
  { key: 'fontFamily', group: 'Layout', label: 'Font family', type: 'text', hint: 'blank = the page font' },
  { key: 'showButton', group: 'Behaviour', label: 'Show the hover button', type: 'checkbox' },
  {
    key: 'hotkey', group: 'Behaviour',
    label: 'Modifier + click',
    type: 'select',
    options: [
      ['alt', 'Alt + click'],
      ['ctrl', 'Ctrl + click'],
      ['shift', 'Shift + click'],
      ['none', 'off'],
    ],
  },
  {
    key: 'minReadablePx', group: 'Legibility',
    label: 'Minimum text size (px)',
    type: 'number',
    hint: 'enlarges text that would render too small to read; 0 disables',
  },
  {
    key: 'supersample', group: 'Legibility',
    label: 'Render sharpness',
    type: 'select',
    options: [
      ['1', '1x - smallest images'],
      ['2', '2x - sharper when zoomed (default)'],
      ['3', '3x - sharpest, heaviest'],
    ],
  },
  {
    key: 'cacheBytes', group: 'Behaviour',
    label: 'Cache size (MB)',
    type: 'number',
    step: '4',
    hint: 'remembers what Lens said, so re-translating costs nothing; 0 disables',
  },
  { key: 'minImageSize', group: 'Behaviour', label: 'Ignore images under (px)', type: 'number' },
  { key: 'jpegQuality', group: 'Advanced', label: 'Upload quality (0..1)', type: 'number', step: '0.05' },
  { key: 'timeoutMs', group: 'Advanced', label: 'Request timeout (ms)', type: 'number', step: '1000' },
  { key: 'region', group: 'Advanced', label: 'Client region', type: 'text' },
  { key: 'timeZone', group: 'Advanced', label: 'Client time zone', type: 'text' },
  { key: 'apiKey', group: 'Advanced', label: 'API key', type: 'text', hint: 'only change if you have your own' },
];

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (!cache) {
    let stored: Partial<Settings> = {};
    try {
      const raw = GM_getValue<unknown>(STORAGE_KEY, null);
      if (typeof raw === 'string') stored = JSON.parse(raw) as Partial<Settings>;
      else if (raw && typeof raw === 'object') stored = raw as Partial<Settings>;
    } catch {
      stored = {};
    }
    // Merge over defaults so settings written by an older version keep working
    // when new keys appear.
    cache = { ...DEFAULTS, ...stored };
  }
  return cache;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch };
  GM_setValue(STORAGE_KEY, cache);
  return cache;
}

export function resetSettings(): Settings {
  cache = { ...DEFAULTS };
  GM_setValue(STORAGE_KEY, cache);
  return cache;
}

/** Turn a form value back into the type the setting is declared with. */
export function coerce(field: Field, raw: string | boolean): Settings[keyof Settings] {
  if (field.key === 'cacheBytes') {
    const megabytes = Number(raw);
    return (Number.isFinite(megabytes) && megabytes >= 0
      ? Math.round(megabytes * 1024 * 1024)
      : DEFAULTS.cacheBytes) as Settings[keyof Settings];
  }
  if (field.key === 'supersample') {
    const value = Number(raw);
    return (value >= 1 && value <= 3 ? value : DEFAULTS.supersample) as Settings[keyof Settings];
  }
  if (field.type === 'checkbox') return Boolean(raw) as Settings[keyof Settings];
  if (field.type === 'number' || field.type === 'range') {
    const value = Number(raw);
    return (Number.isFinite(value) ? value : DEFAULTS[field.key]) as Settings[keyof Settings];
  }
  return String(raw).trim() as Settings[keyof Settings];
}
