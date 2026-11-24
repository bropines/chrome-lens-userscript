import { cacheStats } from '../cache.js';
import { hostFacts, panelCommands } from '../gm.js';
import { storedStats } from '../store.js';
import { onLocaleChange, t, useLanguage } from '../i18n/index.js';
import type { Key } from '../i18n/index.js';
import {
  DEFAULTS,
  FIELDS,
  TABS,
  formPatch,
  exportSettings,
  fieldChoices,
  fieldHint,
  fieldLabel,
  fieldMatches,
  getSettings,
  importSettings,
  saveSettings,
  settingsDiffer,
  shown,
} from '../settings.js';
import type { Field, FormValue, Tab } from '../settings.js';
import { hostOf, setSiteMode, siteRules } from '../sites.js';
import type { SiteMode } from '../sites.js';
import type { Settings } from '../types.js';
import { VERSION } from '../version.js';
import { moveButton, parseButtons, placeButton, serializeButtons, togglePinned } from './buttons.js';
import type { ButtonEntry, ButtonId } from './buttons.js';
import { icon } from './icons.js';
import type { IconName } from './icons.js';
import { isCompact } from './menu.js';
import { createPreview } from './preview.js';
import { applyPopupOpacity, uiRoot } from './root.js';
import { SCHEMATIC_H, SCHEMATIC_W, hasSchematic, schematic } from './schematics.js';
import { chordFromEvent, formatChord, serializeChord } from './shortcuts.js';

/** What the window needs from the front end that opened it. */
export interface SettingsContext {
  onSaved(settings: Settings): void;
  /** What this site is set to, and a way to change it at once. */
  site(): SiteMode;
  setSite(mode: SiteMode): void;
}

const REPO = 'https://github.com/bropines/chrome-lens-userscript';

/** The icon each button of the row is drawn with, here and over the picture. */
export const BUTTON_ICONS: Record<ButtonId, IconName> = {
  translate: 'translate',
  search: 'search',
  ask: 'sparkles',
  area: 'area',
  objects: 'objects',
  text: 'text',
  copy: 'copy',
  edit: 'edit',
  settings: 'settings',
  menu: 'more',
};

let panel: HTMLDivElement | null = null;
/** Set while the window is open: ask it to close, minding unsaved changes. */
let requestClose: (() => void) | null = null;
let stopListening: (() => void) | null = null;
/** A shortcut field is waiting for keys, and Escape belongs to it. */
let recording = false;

/**
 * A live sample of the outline.
 *
 * The number on its own says nothing - the point of the outline is legibility
 * over the residue the server's inpainting leaves behind, so the preview draws
 * that residue and the text on top of it.
 */
function drawOutlinePreview(canvas: HTMLCanvasElement, scale: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  const size = 22;
  ctx.clearRect(0, 0, width, height);

  // Both polarities, because the answer differs: a dark bubble means light text
  // outlined in dark, and an outline tuned on a white page can swallow the text
  // whole on a black one.
  const halves = [
    { x: 0, bg: '#f2f0ea', fg: '#141414', label: 'light' },
    { x: width / 2, bg: '#141414', fg: '#f4f4f4', label: 'dark' },
  ];

  for (const half of halves) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(half.x, 0, width / 2, height);
    ctx.clip();

    ctx.fillStyle = half.bg;
    ctx.fillRect(half.x, 0, width / 2, height);

    // Stand-in for leftover glyph edges: what the outline has to survive.
    ctx.strokeStyle = half.fg;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    for (let i = 0; i < 16; i += 1) {
      const x = half.x + 6 + ((i * 41) % (width / 2 - 14));
      const y = 8 + ((i * 29) % (height - 18));
      ctx.strokeRect(x, y, 9, 13);
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 4);
      ctx.lineTo(x + 7, y + 10);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.font = `${size}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    // A sample of a script, not a message: it is the same in every language.
    const sample = half.label === 'light' ? 'Пример текста' : 'sample text';
    const x = half.x + (width / 2 - ctx.measureText(sample).width) / 2;
    const y = height / 2;

    // Same stroke the renderer uses, so the sample is the real thing.
    const outline = size * 0.02 * 2 * scale;
    if (outline > 0) {
      ctx.strokeStyle = half.bg;
      ctx.lineWidth = outline * 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(sample, x, y);
    }
    ctx.fillStyle = half.fg;
    ctx.fillText(sample, x, y);
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(128,128,128,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.stroke();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(className: string, text: string, act?: string): HTMLButtonElement {
  const element = el('button', className, text);
  element.type = 'button';
  if (act) element.dataset['act'] = act;
  return element;
}

/** Tell the form a value was changed by something other than typing in it. */
const changed = (input: HTMLElement): void => {
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Draw one of the small pictures from ./schematics.ts into an <svg>.
 *
 * Built node by node: the shapes are data, and markup assembled from data is
 * the habit that ends with somebody's string in `innerHTML`. A tone becomes a
 * class, and the stylesheet gives the class the theme's colour.
 */
function drawSchematic(svg: SVGSVGElement, key: keyof Settings, value: string): void {
  svg.textContent = '';
  for (const shape of schematic(key, value)) {
    const node = document.createElementNS(SVG, shape.kind);
    node.setAttribute('class', `lt-sch-${shape.tone}`);
    const set = (attributes: Record<string, number>): void => {
      for (const [name, number] of Object.entries(attributes)) node.setAttribute(name, String(number));
    };
    if (shape.kind === 'rect') {
      set({ x: shape.x, y: shape.y, width: shape.w, height: shape.h, rx: shape.r });
    } else if (shape.kind === 'line') {
      set({ x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 });
    } else if (shape.kind === 'ellipse') {
      set({ cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry });
    } else if (shape.kind === 'polygon') {
      node.setAttribute('points', shape.points.map(([x, y]) => `${x},${y}`).join(' '));
    } else {
      set({ x: shape.x, y: shape.y });
      node.textContent = shape.text;
    }
    svg.appendChild(node);
  }
}

/** A select with a picture of the chosen value beside it. */
function withSchematic(field: Field, select: HTMLSelectElement): HTMLElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'lt-sch');
  svg.setAttribute('viewBox', `0 0 ${SCHEMATIC_W} ${SCHEMATIC_H}`);
  // The option's own words say the same thing to a screen reader.
  svg.setAttribute('aria-hidden', 'true');
  const refresh = (): void => drawSchematic(svg, field.key, select.value);
  select.addEventListener('input', refresh);
  select.addEventListener('change', refresh);
  refresh();

  const holder = el('span', 'lt-pick');
  holder.append(svg, select);
  return holder;
}

function readout(field: Field, value: number): string {
  if (field.unit === '%') return `${Math.round(value * 100)}%`;
  if (field.unit === 'pct') return `${Math.round(value)}%`;
  // Two decimals only where the step asks for them; 1.25x must not read 1.3x.
  return `${value.toFixed((field.step ?? 1) < 0.1 ? 2 : 1)}x`;
}

function buildRange(field: Field, settings: Settings): HTMLElement[] {
  const slider = el('input', 'lt-input');
  slider.type = 'range';
  if (field.min !== undefined) slider.min = String(field.min);
  if (field.max !== undefined) slider.max = String(field.max);
  if (field.step !== undefined) slider.step = String(field.step);
  slider.value = String(settings[field.key]);
  slider.dataset['key'] = field.key;

  const value = el('span', 'lt-readout');
  const wantsPreview = field.key === 'outlineScale';
  // The panel is a popup too, so moving this slider shows the result on the
  // very surface being looked at. Nothing is kept until Save.
  const livePopup = field.key === 'popupOpacity';
  const preview = el('canvas', 'lt-preview');
  preview.width = 460;
  preview.height = 64;

  const refresh = (): void => {
    const number = Number(slider.value);
    value.textContent = readout(field, number);
    if (wantsPreview) drawOutlinePreview(preview, number);
    if (livePopup) applyPopupOpacity(number);
  };
  slider.addEventListener('input', refresh);
  refresh();

  const holder = el('span', 'lt-slider');
  holder.append(slider, value);
  return wantsPreview ? [holder, preview] : [holder];
}

/**
 * A colour, or nothing.
 *
 * `<input type="color">` cannot be empty, and empty is the default here: it
 * means "use what Lens sampled". So the value lives in a text field that can
 * be blank, and the swatch beside it is only a way of filling it in.
 */
function buildColor(field: Field, settings: Settings): HTMLElement[] {
  const text = el('input', 'lt-input');
  text.type = 'text';
  text.value = String(settings[field.key]);
  text.placeholder = t('color.auto');
  text.dataset['key'] = field.key;
  text.maxLength = 7;
  text.spellcheck = false;

  const swatch = el('input', 'lt-swatch');
  swatch.type = 'color';
  swatch.setAttribute('aria-label', t('color.pick'));
  const sync = (): void => {
    const set = /^#[0-9a-f]{6}$/i.test(text.value.trim());
    if (set) swatch.value = text.value.trim();
    // A colour input always shows some colour; faded, it is not the answer.
    swatch.classList.toggle('lt-unset', !set);
  };
  sync();
  text.addEventListener('input', sync);
  swatch.addEventListener('input', () => {
    text.value = swatch.value;
    changed(text);
  });

  const holder = el('span', 'lt-color');
  holder.append(swatch, text);
  return [holder];
}

/**
 * A field that is filled in by pressing the keys themselves.
 *
 * Typing "Alt+Shift+KeyT" is nobody's idea of setting a shortcut. The value is
 * kept in a hidden input as the stored spelling, and the button shows it the
 * way it reads; pressing the button listens for one chord, Escape gives up and
 * Backspace clears.
 */
function buildChord(field: Field, settings: Settings): HTMLElement[] {
  const value = el('input');
  value.type = 'hidden';
  value.value = String(settings[field.key]);
  value.dataset['key'] = field.key;

  const record = button('lt-btn lt-chord', '');
  const clear = button('lt-btn lt-ghost lt-square', '');
  clear.innerHTML = icon('close', 16);
  clear.setAttribute('aria-label', t('chord.clear'));

  let listening = false;
  const show = (): void => {
    record.textContent = listening ? t('chord.record') : formatChord(value.value) || t('chord.none');
    record.classList.toggle('lt-recording', listening);
    clear.hidden = !value.value;
  };
  const stop = (): void => {
    listening = false;
    recording = false;
    show();
  };
  const set = (next: string): void => {
    value.value = next;
    stop();
    changed(value);
  };

  record.addEventListener('click', () => {
    listening = !listening;
    recording = listening;
    show();
  });
  record.addEventListener('blur', () => {
    if (listening) stop();
  });
  record.addEventListener('keydown', (event) => {
    if (!listening) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') return stop();
    if (event.key === 'Backspace' || event.key === 'Delete') return set('');
    const chord = chordFromEvent(event);
    if (chord) set(serializeChord(chord));
    return undefined;
  });
  clear.addEventListener('click', () => set(''));
  show();

  const holder = el('span', 'lt-chord-row');
  holder.append(value, record, clear);
  return [holder];
}

/**
 * The buttons over a picture, as a list to tick and to put in order.
 *
 * Dragging is by pointer events, so a mouse, a finger and a stylus are one
 * code path; the arrows beside each row are the same operation for a keyboard
 * and for anyone who would rather not drag on a phone. Both go through the
 * reducers in ./buttons.ts and write the result into one hidden input.
 */
function buildButtons(field: Field, settings: Settings): HTMLElement[] {
  const value = el('input');
  value.type = 'hidden';
  value.value = String(settings[field.key]);
  value.dataset['key'] = field.key;

  let entries: ButtonEntry[] = parseButtons(value.value);
  const list = el('ul', 'lt-order');
  const rows = new Map<ButtonId, HTMLLIElement>();

  const commit = (next: ButtonEntry[], focus?: { id: ButtonId; act: string }): void => {
    entries = next;
    value.value = serializeButtons(entries);
    // Moved, not rebuilt: a row being dragged holds the pointer capture, and a
    // row whose arrow was just pressed holds the focus.
    for (const entry of entries) {
      const row = rows.get(entry.id);
      if (row) list.appendChild(row);
    }
    if (focus) rows.get(focus.id)?.querySelector<HTMLElement>(`[data-move="${focus.act}"]`)?.focus();
    changed(value);
  };

  for (const entry of entries) {
    const name = t(`act.${entry.id}` as Key);
    const row = el('li', 'lt-order-item');
    row.dataset['button'] = entry.id;

    const grip = el('span', 'lt-grip');
    grip.innerHTML = icon('grip', 16);
    grip.title = t('buttons.drag');

    const pin = el('input', 'lt-input');
    pin.type = 'checkbox';
    pin.checked = entry.pinned;
    pin.setAttribute('aria-label', t('buttons.pin', { name }));
    pin.addEventListener('change', () => commit(togglePinned(entries, entry.id)));

    const label = el('span', 'lt-order-name');
    label.innerHTML = icon(BUTTON_ICONS[entry.id], 16);
    label.append(name);

    const up = button('lt-btn lt-ghost lt-square', '');
    up.innerHTML = icon('up', 16);
    up.dataset['move'] = 'up';
    up.setAttribute('aria-label', t('buttons.up', { name }));
    up.addEventListener('click', () => commit(moveButton(entries, entry.id, -1), { id: entry.id, act: 'up' }));
    const down = button('lt-btn lt-ghost lt-square', '');
    down.innerHTML = icon('down', 16);
    down.dataset['move'] = 'down';
    down.setAttribute('aria-label', t('buttons.down', { name }));
    down.addEventListener('click', () => commit(moveButton(entries, entry.id, 1), { id: entry.id, act: 'down' }));

    let dragging = false;
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      row.classList.add('lt-dragging');
      try {
        grip.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that is already gone; the moves will simply not come.
      }
    });
    grip.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      // The place the pointer is over, by the rows as they lie right now.
      const items = [...list.children] as HTMLElement[];
      let index = items.length;
      for (const [at, item] of items.entries()) {
        const box = item.getBoundingClientRect();
        if (event.clientY < box.top + box.height / 2) {
          index = at;
          break;
        }
      }
      const current = entries.findIndex((candidate) => candidate.id === entry.id);
      // `index` counts this row too; past itself, the slot is one earlier.
      const target = index > current ? index - 1 : index;
      if (target !== current) commit(placeButton(entries, entry.id, target));
    });
    const drop = (): void => {
      dragging = false;
      row.classList.remove('lt-dragging');
    };
    grip.addEventListener('pointerup', drop);
    grip.addEventListener('pointercancel', drop);

    const moves = el('span', 'lt-order-moves');
    moves.append(up, down);
    row.append(grip, pin, label, moves);
    rows.set(entry.id, row);
    list.appendChild(row);
  }

  return [value, list];
}

function buildField(field: Field, settings: Settings): HTMLElement {
  // The row is not a <label>. It was, and a label's activation goes to its
  // first labelable descendant - which was the reset button beside the name,
  // so clicking a name or a hint reset the field and a checkbox never toggled.
  // The name is a <label for> of the control alone; a row holding several
  // buttons has no one control to name, so there it is only text.
  const compound = field.type === 'buttons' || field.type === 'chord';
  const row = el('div', 'lt-row');
  row.dataset['field'] = field.key;
  if (field.wide) row.classList.add('lt-row-wide');
  const id = `lt-field-${field.key}`;

  const label = el('span', 'lt-label');
  if (compound) label.textContent = fieldLabel(field);
  else {
    const name = el('label', 'lt-label-text', fieldLabel(field));
    name.htmlFor = id;
    label.appendChild(name);
  }
  const reset = button('lt-reset', '');
  reset.innerHTML = icon('undo', 14);
  reset.dataset['reset'] = field.key;
  reset.title = t('panel.resetField');
  reset.setAttribute('aria-label', `${t('panel.resetField')}: ${fieldLabel(field)}`);
  reset.hidden = true;
  label.appendChild(reset);
  row.appendChild(label);

  if (field.type === 'range') row.append(...buildRange(field, settings));
  else if (field.type === 'color') row.append(...buildColor(field, settings));
  else if (field.type === 'chord') row.append(...buildChord(field, settings));
  else if (field.type === 'buttons') row.append(...buildButtons(field, settings));
  else if (field.type === 'select') {
    const select = el('select', 'lt-input');
    for (const [value, text] of fieldChoices(field)) {
      const option = el('option', undefined, text);
      option.value = value;
      select.appendChild(option);
    }
    select.value = String(settings[field.key]);
    select.dataset['key'] = field.key;
    row.appendChild(hasSchematic(field.key) ? withSchematic(field, select) : select);
  } else {
    const control = el('input', 'lt-input');
    control.type = field.type;
    if (field.type === 'checkbox') {
      control.checked = Boolean(settings[field.key]);
      row.classList.add('lt-row-check');
    } else {
      if (field.step !== undefined) control.step = String(field.step);
      if (field.min !== undefined) control.min = String(field.min);
      if (field.max !== undefined) control.max = String(field.max);
      // Bytes are stored, megabytes are shown: nobody wants to type 33554432.
      control.value = shown(field, settings[field.key]);
    }
    control.dataset['key'] = field.key;
    row.appendChild(control);
  }

  const control = compound ? null : row.querySelector<HTMLElement>(`[data-key="${field.key}"]`);
  if (control) control.id = id;

  const hint = fieldHint(field);
  if (hint) {
    const note = el('span', 'lt-hint', hint);
    // Described by, not labelled by: the name stays short when read out.
    note.id = `${id}-hint`;
    control?.setAttribute('aria-describedby', note.id);
    row.appendChild(note);
  }
  return row;
}

/** What a control reads as right now: its text, or a checkbox's state. */
function readControl(field: Field, input: HTMLInputElement | HTMLSelectElement): FormValue {
  return field.type === 'checkbox' ? (input as HTMLInputElement).checked : input.value;
}

/** Every control's reading at the moment it was drawn, to tell an edit from a look. */
type Baseline = WeakMap<Element, FormValue>;

function controlsOf(root: HTMLElement): Array<readonly [Field, HTMLInputElement | HTMLSelectElement]> {
  const found: Array<readonly [Field, HTMLInputElement | HTMLSelectElement]> = [];
  for (const field of FIELDS) {
    const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-key="${field.key}"]`);
    if (input) found.push([field, input]);
  }
  return found;
}

/** Remember how every control reads now, after the browser has had its say (a slider snaps). */
function recordBaseline(root: HTMLElement, baseline: Baseline): void {
  for (const [field, input] of controlsOf(root)) baseline.set(input, readControl(field, input));
}

/** The fields that were edited since the form was drawn, and only those. */
function collect(root: HTMLElement, baseline: Baseline): Partial<Settings> {
  return formPatch(
    controlsOf(root).map(([field, input]) => {
      const now = readControl(field, input);
      return [field, now, baseline.get(input) ?? now] as const;
    })
  );
}

/**
 * Take the window down.
 *
 * `revert` puts back what the window was previewing live - the popup's
 * opacity and the interface language - as stored, which after a save is the
 * new value and after a cancel the old one. The one caller that passes false
 * is the redraw for a language that has just arrived: that close is the window
 * reopening in the language picked in it, and reverting there would undo the
 * very choice being drawn.
 */
function closeNow(revert = true): void {
  stopListening?.();
  stopListening = null;
  requestClose = null;
  recording = false;
  panel?.remove();
  panel = null;
  if (!revert) return;
  // A slider moved and then cancelled leaves its preview behind otherwise;
  // after a save this is the new value, so it is right either way.
  applyPopupOpacity(getSettings().popupOpacity);
  useLanguage(getSettings().language);
}

/** Close the window whatever is in it. Unsaved changes are dropped. */
export function closeSettings(): void {
  closeNow();
}

interface Restore {
  draft: Settings;
  tab: Tab;
}

export function openSettings(context: SettingsContext, restore?: Restore): void {
  if (panel) {
    // The gear is a toggle; a second press asks to close, as Escape would.
    requestClose?.();
    return;
  }

  const backdrop = el('div', 'lt-panel-backdrop');
  panel = backdrop;
  const dialog = el('div', 'lt-panel lt-settings');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', t('panel.aria'));

  const head = el('header', 'lt-panel-head');
  const search = el('input', 'lt-input lt-search');
  search.type = 'search';
  search.placeholder = t('panel.search');
  search.setAttribute('aria-label', t('panel.search'));
  const x = button('lt-x', '', 'cancel');
  x.innerHTML = icon('close');
  x.setAttribute('aria-label', t('panel.close'));
  head.append(el('strong', undefined, t('panel.title')), search, x);

  const tabs = el('nav', 'lt-tabs');
  tabs.setAttribute('role', 'tablist');
  const body = el('div', 'lt-panel-body');
  const main = el('div', 'lt-settings-main');
  main.append(tabs, body);

  const foot = el('footer', 'lt-panel-foot');
  const guard = el('span', 'lt-guard', t('panel.unsaved'));
  guard.hidden = true;
  const discard = button('lt-btn lt-ghost', t('panel.discard'), 'discard');
  discard.hidden = true;
  const keep = button('lt-btn', t('panel.keepEditing'), 'keep');
  keep.hidden = true;
  const cancel = button('lt-btn lt-ghost', t('panel.cancel'), 'cancel');
  const save = button('lt-btn lt-primary', t('panel.save'), 'save');
  foot.append(guard, el('span', 'lt-spacer'), discard, keep, cancel, save);

  dialog.append(head, main, foot);
  backdrop.appendChild(dialog);

  /** Every value as the form has it now, on screen or not. */
  let draft: Settings = restore?.draft ?? getSettings();
  let active: Tab = restore?.tab ?? 'general';
  /** Said once under the backup buttons: what an import took and what it left. */
  let importNote = '';

  /**
   * How each control read when it was drawn. A field is in the form's answer
   * only when its control reads differently now; otherwise the value it was
   * drawn from stands, exactly as stored, however the control showed it.
   */
  const baseline: Baseline = new WeakMap();
  const current = (): Settings => ({ ...draft, ...collect(backdrop, baseline) });
  const isDirty = (): boolean => settingsDiffer(current(), getSettings());

  /**
   * The sample translation on the Appearance tab. One for the life of the
   * window, put back into the pane each time `fill` rebuilds it, so a reset
   * does not blank the picture and wait for it to come back.
   */
  const preview = createPreview();
  const refreshPreview = (delay?: number): void => preview.schedule(current, delay);

  const setGuard = (on: boolean): void => {
    guard.hidden = !on;
    discard.hidden = !on;
    keep.hidden = !on;
    cancel.hidden = on;
  };

  /**
   * The reset button of each field, shown only where there is something to
   * reset. Compared as coerced values, so "1.0" in a number field is still the
   * default 1.
   */
  const markChanged = (): void => {
    const now = current();
    for (const reset of body.querySelectorAll<HTMLElement>('[data-reset]')) {
      const key = reset.dataset['reset'] as keyof Settings;
      reset.hidden = now[key] === DEFAULTS[key];
    }
    for (const pane of body.querySelectorAll<HTMLElement>('[data-pane]')) {
      const tabReset = pane.querySelector<HTMLElement>('[data-act="reset-tab"]');
      if (tabReset) tabReset.hidden = !pane.querySelector('[data-reset]:not([hidden])');
    }
  };

  /**
   * Show one tab, or - while something is typed in the search box - every
   * field that answers it, under the name of the tab it lives on.
   */
  const applyFilter = (): void => {
    const query = search.value.trim();
    let any = false;
    for (const pane of body.querySelectorAll<HTMLElement>('[data-pane]')) {
      let matches = 0;
      for (const row of pane.querySelectorAll<HTMLElement>('[data-field]')) {
        const field = FIELDS.find((candidate) => candidate.key === row.dataset['field']);
        const hit = !query || (field !== undefined && fieldMatches(field, query));
        row.hidden = !hit;
        if (hit) matches += 1;
      }
      for (const extra of pane.querySelectorAll<HTMLElement>('.lt-extra')) extra.hidden = Boolean(query);
      pane.hidden = query ? matches === 0 : pane.dataset['pane'] !== active;
      if (!pane.hidden) any = true;
    }
    dialog.classList.toggle('lt-searching', Boolean(query));
    for (const tab of tabs.querySelectorAll<HTMLElement>('[data-tab]')) {
      tab.setAttribute('aria-selected', String(!query && tab.dataset['tab'] === active));
    }
    const empty = body.querySelector<HTMLElement>('.lt-empty');
    if (empty) {
      empty.hidden = any;
      empty.textContent = t('panel.noMatches', { query });
    }
  };

  const show = (tab: Tab): void => {
    active = tab;
    search.value = '';
    applyFilter();
    body.scrollTop = 0;
    // Drawn when it is first looked at, not before; see ./preview.ts.
    refreshPreview(0);
    tabs
      .querySelector<HTMLElement>(`[data-tab="${tab}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  /**
   * The General tab, which is the one most people only ever see.
   *
   * It used to be four fields and a wall of identical buttons, three of which
   * were toggles that did not say which way they were set. Now what is true
   * right now comes first, as switches and a three-way choice for this site,
   * each saying what it means; then the interface, as two cards; then the rest.
   *
   * Everything on it is still a field drawn by `buildField` where it can be,
   * so search, reset and Save treat it like any other tab. The two exceptions
   * are the site, which is not a setting and applies at once as it always has,
   * and the interface cards, which edit a hidden select that holds the value.
   */
  const fieldOf = (key: keyof Settings): Field => FIELDS.find((field) => field.key === key)!;
  const GENERAL_OWN = new Set<keyof Settings>(['enabled', 'autoTranslate', 'uiMode', 'language', 'popupOpacity']);
  let syncSiteNow: () => void = () => {};

  const buildSiteNow = (): HTMLElement => {
    const row = el('div', 'lt-row lt-extra lt-site-now');
    row.appendChild(el('span', 'lt-label', t('general.site', { host: hostOf() })));
    const group = el('div', 'lt-segmented');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', t('general.site', { host: hostOf() }));
    const hint = el('span', 'lt-hint');
    const choices = (['off', 'default', 'auto'] as const).map((mode) => {
      const choice = button('lt-seg', t(`general.site.${mode}`));
      choice.setAttribute('role', 'radio');
      choice.addEventListener('click', () => {
        if (context.site() === mode) return;
        context.setSite(mode);
        syncSiteNow();
        redrawSites();
      });
      group.appendChild(choice);
      return [mode, choice] as const;
    });
    syncSiteNow = (): void => {
      const now = context.site();
      for (const [mode, choice] of choices) choice.setAttribute('aria-checked', String(mode === now));
      hint.textContent =
        now === 'off'
          ? t('general.site.hint.off')
          : now === 'auto'
            ? t('general.site.hint.auto')
            : current().autoTranslate
              ? t('general.site.hint.defaultAuto')
              : t('general.site.hint.default');
    };
    row.append(group, hint);
    return row;
  };

  const buildModes = (values: Settings): HTMLElement => {
    const field = fieldOf('uiMode');
    const row = el('div', 'lt-row lt-row-wide lt-modes-row');
    row.dataset['field'] = field.key;
    row.appendChild(el('span', 'lt-label', fieldLabel(field)));
    // The value lives here, as for any select; the cards only set it.
    const select = el('select', 'lt-input');
    select.hidden = true;
    for (const value of ['simple', 'pro']) {
      const option = el('option', undefined, value);
      option.value = value;
      select.appendChild(option);
    }
    select.value = values.uiMode;
    select.dataset['key'] = field.key;
    const cards = el('div', 'lt-modes');
    cards.setAttribute('role', 'radiogroup');
    cards.setAttribute('aria-label', fieldLabel(field));
    for (const [mode, glyph] of [
      ['simple', 'translate'],
      ['pro', 'layers'],
    ] as const) {
      const card = button('lt-mode', '');
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(values.uiMode === mode));
      const title = el('span', 'lt-mode-title');
      title.innerHTML = icon(glyph, 16);
      title.appendChild(el('span', undefined, t(`general.${mode}.title`)));
      card.append(title, el('span', 'lt-mode-desc', t(`general.${mode}.desc`)));
      card.addEventListener('click', () => {
        if (select.value === mode) return;
        select.value = mode;
        // The change listener redraws the window for the other interface.
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      cards.appendChild(card);
    }
    row.append(select, cards);
    return row;
  };

  /** The commands worth a button here, each with what it looks like. */
  const QUICK: ReadonlyArray<readonly [string, IconName]> = [
    ['translateAll', 'images'],
    ['undoAll', 'undo'],
    ['clearCache', 'trash'],
    ['diagnostics', 'pulse'],
  ];

  const buildQuick = (): HTMLElement | null => {
    const commands = panelCommands();
    const found = QUICK.flatMap(([id, glyph]) => {
      const command = commands.find((candidate) => candidate.id === id);
      return command ? [[command, glyph] as const] : [];
    });
    if (!found.length) return null;
    const section = el('div', 'lt-extra');
    section.appendChild(el('div', 'lt-group', t('general.quick')));
    const grid = el('div', 'lt-quick');
    for (const [command, glyph] of found) {
      const action = button('lt-btn lt-quick-btn', '');
      action.dataset['command'] = command.id;
      action.innerHTML = icon(glyph, 16);
      action.appendChild(el('span', undefined, command.label));
      if (command.id === 'clearCache') {
        const size = el('span', 'lt-quick-meta');
        const measure = (): void => {
          const memory = cacheStats();
          void storedStats().then(({ bytes }) => {
            size.textContent = t('general.cacheSize', { size: ((memory.bytes + bytes) / 1048576).toFixed(1) });
          });
        };
        measure();
        action.appendChild(size);
        action.addEventListener('click', () => {
          command.run();
          window.setTimeout(measure, 300);
        });
      } else {
        action.addEventListener('click', () => {
          // Undoing a page is invisible from behind the window, and the report
          // takes the screen. Close first.
          closeNow();
          command.run();
        });
      }
      grid.appendChild(action);
    }
    section.append(grid, el('div', 'lt-note', t('panel.actionsNote')));
    return section;
  };

  const buildGeneral = (values: Settings, fields: readonly Field[]): HTMLElement[] => {
    const parts: HTMLElement[] = [];
    const status = el('div', 'lt-card lt-status');
    status.append(buildField(fieldOf('enabled'), values), buildSiteNow(), buildField(fieldOf('autoTranslate'), values));
    parts.push(status, buildModes(values));

    const grid = el('div', 'lt-grid');
    grid.append(buildField(fieldOf('language'), values), buildField(fieldOf('popupOpacity'), values));
    parts.push(grid);

    // The simple interface has no other tabs, so what it keeps of them is here.
    const rest = fields.filter((field) => !GENERAL_OWN.has(field.key));
    if (rest.length) {
      parts.push(el('div', 'lt-group lt-extra', t('general.essentials')));
      const more = el('div', 'lt-grid');
      for (const field of rest) more.appendChild(buildField(field, values));
      parts.push(more);
    }
    const quick = buildQuick();
    if (quick) parts.push(quick);
    syncSiteNow();
    return parts;
  };

  const buildSites = (): HTMLElement => {
    const section = el('div', 'lt-extra lt-sites');
    const here = hostOf();
    const row = el('label', 'lt-row lt-row-wide');
    row.appendChild(el('span', 'lt-label', t('sites.current', { host: here })));
    const select = el('select', 'lt-input lt-site-mode');
    for (const mode of ['default', 'off', 'auto'] as const) {
      const option = el('option', undefined, t(`sites.${mode}`));
      option.value = mode;
      select.appendChild(option);
    }
    select.value = context.site();
    select.addEventListener('change', () => {
      context.setSite(select.value as SiteMode);
      redrawSites();
    });
    row.appendChild(select);
    section.appendChild(row);

    section.appendChild(el('div', 'lt-group', t('sites.others')));
    const others = Object.entries(siteRules()).filter(([host]) => host !== here);
    if (!others.length) section.appendChild(el('div', 'lt-note', t('sites.none')));
    const list = el('ul', 'lt-site-list');
    for (const [host, mode] of others.sort(([a], [b]) => a.localeCompare(b))) {
      const item = el('li', 'lt-site');
      const remove = button('lt-btn lt-ghost lt-square', '');
      remove.innerHTML = icon('close', 16);
      remove.setAttribute('aria-label', t('sites.remove', { host }));
      remove.addEventListener('click', () => {
        setSiteMode('default', host);
        redrawSites();
      });
      item.append(el('span', 'lt-site-host', host), el('span', 'lt-site-rule', t(`sites.${mode}`)), remove);
      list.appendChild(item);
    }
    section.append(list, el('div', 'lt-note', t('sites.note')));
    return section;
  };
  const redrawSites = (): void => {
    body.querySelector('.lt-sites')?.replaceWith(buildSites());
  };

  const link = (href: string, text: string): HTMLAnchorElement => {
    const anchor = el('a', 'lt-link', text);
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    return anchor;
  };

  const buildAbout = (): HTMLElement => {
    const section = el('div', 'lt-extra lt-about');
    section.appendChild(el('div', 'lt-version', t('about.version', { version: VERSION })));

    section.appendChild(el('div', 'lt-group', t('about.links')));
    const links = el('div', 'lt-actions');
    links.append(
      link(REPO, t('about.repo')),
      link(`${REPO}/issues`, t('about.issues')),
      link(`${REPO}/blob/main/docs/lens-capabilities.md`, t('about.docs'))
    );
    section.appendChild(links);

    section.appendChild(el('div', 'lt-group', t('about.host')));
    // The same facts the diagnostics report opens with, for the same reason:
    // they are what a bug report needs and what nothing else can say.
    section.appendChild(el('pre', 'lt-report lt-facts', hostFacts().join('\n')));

    section.appendChild(el('div', 'lt-group', t('about.tools')));
    const tools = el('div', 'lt-actions');
    for (const command of panelCommands()) {
      if (command.id !== 'diagnostics' && command.id !== 'clearCache') continue;
      const action = button('lt-btn', command.label);
      action.dataset['command'] = command.id;
      action.addEventListener('click', () => {
        // The report takes the screen; clearing the cache does not need it.
        if (command.id === 'diagnostics') closeNow();
        command.run();
      });
      tools.appendChild(action);
    }
    section.appendChild(tools);

    section.appendChild(el('div', 'lt-group', t('about.backup')));
    const backup = el('div', 'lt-actions');
    const file = el('input', 'lt-import-file');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      void chosen.text().then((text) => {
        let report = null;
        try {
          report = importSettings(JSON.parse(text) as unknown);
        } catch {
          report = null;
        }
        // The form as it stands, edits included: the redraw below is from this,
        // so a file that is refused does not take unsaved changes with it.
        const now = current();
        if (!report || !report.applied.length) importNote = t('about.importInvalid');
        else {
          importNote = t('about.importDone', { count: report.applied.length });
          const left = [...report.unknown, ...report.invalid];
          if (left.length) importNote += ` ${t('about.importIgnored', { keys: left.join(', ') })}`;
        }
        // Into the form, not the store: what was imported can be looked at,
        // and only Save keeps it - the same as anything typed by hand.
        fill(report?.applied.length ? { ...now, ...report.patch } : now);
      });
    });
    const importer = button('lt-btn', t('about.import'), 'import');
    importer.addEventListener('click', () => file.click());
    backup.append(
      button('lt-btn', t('about.export'), 'export'),
      importer,
      file,
      button('lt-btn lt-ghost', t('panel.resetAll'), 'reset')
    );
    section.appendChild(backup);
    if (importNote) section.appendChild(el('div', 'lt-note lt-import-note', importNote));
    section.appendChild(el('div', 'lt-note', t('about.locale')));
    return section;
  };

  /**
   * Draw the window for a set of values.
   *
   * Every field is in the page at once, a tab being only which pane is shown:
   * that is what lets the search box look across all of them, and what lets
   * Save read the whole form without knowing which tab was open.
   *
   * The simple interface draws a handful of fields on one tab and leaves the
   * rest alone: `collect` only reads inputs that exist, so a setting that is
   * not on screen is not touched by Save. Switching the interface redraws at
   * once, from what is in the form rather than what was last saved, so nothing
   * typed is lost to having looked at the other list.
   */
  function fill(values: Settings): void {
    draft = values;
    const pro = values.uiMode === 'pro';
    const scroll = body.scrollTop;
    dialog.classList.toggle('lt-pro', pro);
    search.hidden = !pro;
    if (!pro) search.value = '';
    const shownTabs: Tab[] = pro ? [...TABS] : ['general', 'about'];
    if (!shownTabs.includes(active)) active = 'general';

    tabs.textContent = '';
    body.textContent = '';
    for (const tab of shownTabs) {
      const tabButton = button('lt-tab', t(`tab.${tab}`));
      tabButton.dataset['tab'] = tab;
      tabButton.setAttribute('role', 'tab');
      tabs.appendChild(tabButton);

      const pane = el('section', 'lt-pane');
      pane.dataset['pane'] = tab;
      const fields = FIELDS.filter((field) => (pro ? field.tab === tab : tab === 'general' && field.essential));

      const paneHead = el('div', 'lt-pane-head');
      paneHead.appendChild(el('h3', undefined, t(`tab.${tab}`)));
      if (fields.length) {
        const tabReset = button('lt-btn lt-ghost lt-small', t('panel.resetTab'), 'reset-tab');
        tabReset.hidden = true;
        paneHead.appendChild(tabReset);
      }
      pane.appendChild(paneHead);
      // Above the fields and stuck there, so it is in view from any of them.
      if (pro && tab === 'appearance') pane.appendChild(preview.element);

      if (tab === 'general') pane.append(...buildGeneral(values, fields));
      else if (fields.length) {
        const grid = el('div', 'lt-grid');
        for (const field of fields) grid.appendChild(buildField(field, values));
        pane.appendChild(grid);
      }
      if (tab === 'sites') pane.appendChild(buildSites());
      if (tab === 'about') pane.appendChild(buildAbout());
      body.appendChild(pane);
    }
    const empty = el('div', 'lt-note lt-empty');
    empty.hidden = true;
    body.appendChild(empty);
    // Read back from the controls, not taken from `values`: a slider has
    // already snapped 0.92 to its step, and that is not an edit.
    recordBaseline(body, baseline);

    applyFilter();
    markChanged();
    body.scrollTop = scroll;
    refreshPreview(0);
  }
  fill(draft);

  const download = (): void => {
    const blob = new Blob([exportSettings(current(), VERSION)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = el('a');
    anchor.href = url;
    anchor.download = 'lens-translate-settings.json';
    // In the page, briefly: a click on an anchor that is in no document is not
    // a download in every browser.
    backdrop.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  requestClose = (): void => {
    if (guard.hidden && isDirty()) setGuard(true);
    else closeNow();
  };

  backdrop.addEventListener('input', (event) => {
    setGuard(false);
    markChanged();
    const target = event.target as HTMLElement;
    if (target === search) applyFilter();
    // Every edit asks; the preview itself knows which ones change the drawing.
    refreshPreview();
  });
  backdrop.addEventListener('change', (event) => {
    markChanged();
    const key = (event.target as HTMLElement).dataset['key'];
    // The interface switch changes which fields exist, so it redraws at once.
    if (key === 'uiMode') fill(current());
    // The language is shown, not just stored: a choice made in a list written
    // in the old language is checked by reading the new one. It arrives in a
    // moment (from the host's store, or GitHub the first time) and the window
    // redraws itself where it stands; Cancel puts the stored one back.
    if (key === 'language') useLanguage(current().language);
    // What "default" means for this site depends on it.
    if (key === 'autoTranslate') syncSiteNow();
    refreshPreview();
  });

  backdrop.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    // Clicking the backdrop closes; clicking inside the card must not.
    if (target === backdrop) return requestClose?.();

    const reset = target.closest<HTMLElement>('[data-reset]');
    if (reset) {
      event.preventDefault();
      const key = reset.dataset['reset'] as keyof Settings;
      fill({ ...current(), [key]: DEFAULTS[key] });
      return undefined;
    }
    const tab = target.closest<HTMLElement>('[data-tab]')?.dataset['tab'];
    if (tab) return show(tab as Tab);

    // An icon inside a button is what the click lands on, not the button.
    const actor = target.closest<HTMLElement>('[data-act]');
    const action = actor?.dataset['act'];
    if (action === 'cancel') return requestClose?.();
    if (action === 'discard') return closeNow();
    if (action === 'keep') return setGuard(false);
    if (action === 'export') return download();
    if (action === 'save') {
      const saved = saveSettings(current());
      closeNow();
      context.onSaved(saved);
    } else if (action === 'reset-tab') {
      const pane = actor?.closest<HTMLElement>('[data-pane]');
      const next: Record<string, unknown> = { ...current() };
      for (const row of pane?.querySelectorAll<HTMLElement>('[data-field]') ?? []) {
        const key = row.dataset['field'] as keyof Settings;
        next[key] = DEFAULTS[key];
      }
      fill(next as unknown as Settings);
    } else if (action === 'reset') {
      // Into the form like everything else here; Save is what makes it so. The
      // interface mode stays, or the window would fold up under the button.
      fill({ ...DEFAULTS, uiMode: current().uiMode });
    }
    return undefined;
  });

  // What is typed here is for these fields. A reader turns the page on an
  // arrow key or a space, and its listeners are further up the same path.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    backdrop.addEventListener(type, (event) => {
      if ((event as KeyboardEvent).key !== 'Escape') event.stopPropagation();
    });
  }

  const onKey = (event: KeyboardEvent): void => {
    // A shortcut being recorded takes its own Escape, as "never mind".
    if (event.key !== 'Escape' || recording) return;
    event.stopPropagation();
    // Escape from the question is "keep editing"; from the form, "close".
    if (!guard.hidden) setGuard(false);
    else requestClose?.();
  };
  document.addEventListener('keydown', onKey, true);

  // A language that arrives while the window is open redraws it where it
  // stands: same tab, same values, nothing typed lost.
  const unsubscribe = onLocaleChange(() => {
    if (panel !== backdrop) return;
    const state: Restore = { draft: current(), tab: active };
    closeNow(false);
    openSettings(context, state);
  });
  stopListening = (): void => {
    document.removeEventListener('keydown', onKey, true);
    unsubscribe();
    preview.dispose();
  };

  uiRoot().appendChild(backdrop);
  // Focus is where a phone's keyboard goes, and nobody asked for it yet.
  if (!isCompact()) body.querySelector<HTMLElement>('.lt-input')?.focus();
}
