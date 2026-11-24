import type { Edits, TranslationBlock } from '../types.js';
import { SCALE_MAX, SCALE_MIN, argbToHex, cleanEdit, cleanEdits } from '../render/edits.js';
import type { LooseEdit } from '../render/edits.js';
import { t } from '../i18n/index.js';
import type { Key } from '../i18n/index.js';
import { icon } from './icons.js';
import { uiRoot } from './root.js';

/**
 * The quick editor: the translated picture, a box over each paragraph, and a
 * few things to change about the one that is picked.
 *
 * It edits nothing but data. Every change is a `BlockEdit` (`render/edits.ts`)
 * and the picture is drawn again by the real renderer a moment later, so what
 * the window shows is exactly what Apply puts on the page. Nothing here knows
 * how a paragraph is laid out; it only knows where the source was.
 *
 * The boxes are the source paragraphs moved and scaled by the edit, rotated as
 * the source was. They are where to point, not a drawing of the text: the
 * renderer may give the words more room than the box, and the box still says
 * which paragraph is which.
 */

export interface EditorOptions {
  blocks: readonly TranslationBlock[];
  edits: Edits | undefined;
  /** Draw the picture with these edits. */
  render(edits: Edits | undefined): Promise<Blob>;
  /** Called during the press, with the picture still to come - see copyPicture. */
  copy(picture: Promise<Blob>): void;
  save(picture: Blob): void;
  /** Apply was pressed; the edits are cleaned already. */
  apply(edits: Edits | undefined): void;
  /** The window is gone, applied or not. */
  closed(): void;
}

let close: (() => void) | null = null;

/** A change to an edit; `undefined` takes a field out. */
type Patch = LooseEdit;

export function closeEditor(): void {
  close?.();
}

export const isEditorOpen = (): boolean => close !== null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (className: string, label: string, glyph?: Parameters<typeof icon>[0]): HTMLButtonElement => {
  const node = el('button', className);
  node.type = 'button';
  if (glyph) node.innerHTML = icon(glyph, 16);
  // Words as text, never markup: a locale is a file from the network.
  node.appendChild(el('span', undefined, label));
  return node;
};

/** How long after the last change the picture is drawn again. */
const REDRAW_MS = 160;
/** A press that moves less than this is a tap, which picks; more is a drag. */
const DRAG_PX = 5;

export function openEditor(options: EditorOptions): void {
  closeEditor();
  const { blocks } = options;
  // A working copy: nothing reaches the page until Apply.
  let edits: Edits = { ...(cleanEdits(options.edits, blocks.length) ?? {}) };
  let picked = -1;

  const backdrop = el('div', 'lt-panel-backdrop lt-editor-backdrop');
  const panel = el('div', 'lt-panel lt-editor');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('editor.title'));

  const head = el('header', 'lt-panel-head');
  head.appendChild(el('strong', undefined, t('editor.title')));
  const x = el('button', 'lt-x');
  x.type = 'button';
  x.innerHTML = icon('close');
  x.setAttribute('aria-label', t('editor.cancel'));
  head.appendChild(x);

  const body = el('div', 'lt-editor-body');
  const stage = el('div', 'lt-editor-stage');
  const frame = el('div', 'lt-editor-frame');
  const picture = el('img', 'lt-editor-img');
  picture.alt = '';
  picture.draggable = false;
  frame.appendChild(picture);
  stage.appendChild(frame);

  // --- the paragraph boxes ---------------------------------------------------

  const boxes = blocks.map((block, index) => {
    if (!block.geometry) return null;
    const box = el('button', 'lt-editor-box');
    box.type = 'button';
    box.setAttribute('aria-label', t('editor.paragraph', { n: index + 1 }));
    box.dataset['index'] = String(index);
    frame.appendChild(box);
    return box;
  });

  const placeBox = (index: number): void => {
    const box = boxes[index];
    const geometry = blocks[index]?.geometry;
    if (!box || !geometry) return;
    const edit = edits[index];
    const scale = edit?.scale ?? 1;
    const w = geometry.w * scale;
    const h = geometry.h * scale;
    box.style.left = `${(geometry.cx + (edit?.dx ?? 0) - w / 2) * 100}%`;
    box.style.top = `${(geometry.cy + (edit?.dy ?? 0) - h / 2) * 100}%`;
    box.style.width = `${w * 100}%`;
    box.style.height = `${h * 100}%`;
    box.style.transform = geometry.angle ? `rotate(${geometry.angle}deg)` : '';
    box.classList.toggle('lt-picked', index === picked);
    box.classList.toggle('lt-edited', edit !== undefined);
    box.classList.toggle('lt-off', Boolean(edit?.hidden || edit?.original));
  };
  const placeAll = (): void => boxes.forEach((_, index) => placeBox(index));

  // --- what can be changed about the picked one ------------------------------

  const side = el('div', 'lt-editor-side');
  const hint = el('p', 'lt-hint lt-editor-hint', t('editor.hint'));
  const fields = el('div', 'lt-editor-fields');

  const textLabel = el('label', 'lt-editor-field');
  textLabel.appendChild(el('span', 'lt-label', t('editor.text')));
  const text = el('textarea', 'lt-input lt-editor-text');
  text.rows = 3;
  text.spellcheck = true;
  textLabel.appendChild(text);

  const sizeRow = el('label', 'lt-editor-field');
  const sizeHead = el('span', 'lt-label', t('editor.size'));
  const sizeValue = el('span', 'lt-editor-value');
  sizeHead.appendChild(sizeValue);
  const size = el('input', 'lt-editor-range');
  size.type = 'range';
  size.min = String(Math.round(SCALE_MIN * 100));
  size.max = String(Math.round(SCALE_MAX * 100));
  size.step = '5';
  sizeRow.append(sizeHead, size);

  const colourRow = el('div', 'lt-editor-colours');
  const colour = (key: 'color' | 'outline', label: Key) => {
    const wrap = el('div', 'lt-editor-colour');
    const name = el('span', 'lt-label', t(label));
    const input = el('input', 'lt-editor-swatch');
    input.type = 'color';
    input.setAttribute('aria-label', t(label));
    const auto = button('lt-btn lt-ghost lt-small', t('editor.auto'));
    wrap.append(name, input, auto);
    colourRow.appendChild(wrap);
    input.addEventListener('input', () => change({ [key]: input.value }));
    auto.addEventListener('click', () => change({ [key]: undefined }));
    return { input, auto };
  };
  const fill = colour('color', 'editor.color');
  const outline = colour('outline', 'editor.outline');

  const toggles = el('div', 'lt-editor-toggles');
  const hide = button('lt-btn lt-ghost lt-small', t('editor.hide'));
  const original = button('lt-btn lt-ghost lt-small', t('editor.original'));
  const resetOne = button('lt-btn lt-ghost lt-small', t('editor.reset'), 'undo');
  toggles.append(hide, original, resetOne);

  fields.append(textLabel, sizeRow, colourRow, toggles);
  side.append(hint, fields);
  body.append(stage, side);

  const foot = el('footer', 'lt-panel-foot lt-editor-foot');
  const resetAll = button('lt-btn lt-ghost', t('editor.resetAll'));
  const copy = button('lt-btn lt-ghost', t('editor.copy'), 'copy');
  const save = button('lt-btn lt-ghost', t('editor.save'), 'download');
  const cancel = button('lt-btn lt-ghost', t('editor.cancel'));
  const apply = button('lt-btn lt-primary', t('editor.apply'));
  foot.append(resetAll, copy, save, el('span', 'lt-spacer'), cancel, apply);

  panel.append(head, body, foot);
  backdrop.appendChild(panel);

  /** Show the picked paragraph's values in the fields. */
  const showPicked = (): void => {
    const block = blocks[picked];
    fields.hidden = !block;
    hint.hidden = Boolean(block);
    if (!block) return;
    const edit = edits[picked];
    const style = block.lines[0];
    // Typing is not interrupted by its own redraw.
    if (document.activeElement !== text && uiRoot().activeElement !== text) {
      text.value = edit?.text ?? block.translation;
    }
    const percent = Math.round((edit?.scale ?? 1) * 100);
    size.value = String(percent);
    sizeValue.textContent = `${percent}%`;
    fill.input.value = edit?.color ?? (style ? argbToHex(style.textColor) : '#000000');
    outline.input.value = edit?.outline ?? (style ? argbToHex(style.bgColor) : '#ffffff');
    fill.auto.disabled = !edit?.color;
    outline.auto.disabled = !edit?.outline;
    hide.setAttribute('aria-pressed', String(Boolean(edit?.hidden)));
    original.setAttribute('aria-pressed', String(Boolean(edit?.original)));
    resetOne.disabled = !edit;
    const off = Boolean(edit?.original);
    for (const control of [text, size, fill.input, outline.input, hide]) control.disabled = off;
  };

  const pick = (index: number): void => {
    picked = index;
    placeAll();
    showPicked();
  };

  // --- drawing ---------------------------------------------------------------

  let shownUrl = '';
  let drawn = 0;
  let timer = 0;
  let latest: Promise<Blob> | null = null;

  const redraw = (): Promise<Blob> => {
    window.clearTimeout(timer);
    timer = 0;
    const ticket = ++drawn;
    frame.classList.add('lt-busy');
    const snapshot = cleanEdits(edits, blocks.length);
    const job = options.render(snapshot);
    latest = job;
    job.then(
      (blob) => {
        if (ticket !== drawn || !close) return;
        if (shownUrl) URL.revokeObjectURL(shownUrl);
        shownUrl = URL.createObjectURL(blob);
        picture.src = shownUrl;
        frame.classList.remove('lt-busy');
      },
      () => {
        if (ticket === drawn) frame.classList.remove('lt-busy');
      }
    );
    return job;
  };
  const redrawSoon = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void redraw(), REDRAW_MS);
  };
  /** The picture as it is now: the pending drawing if there is one, else a new one. */
  const current = (): Promise<Blob> => (timer || !latest ? redraw() : latest);

  const change = (patch: Patch, now = false): void => {
    if (picked < 0) return;
    const merged: Patch = { ...edits[picked], ...patch };
    for (const key of Object.keys(patch) as Array<keyof Patch>) {
      if (patch[key] === undefined) delete merged[key];
    }
    const clean = cleanEdit(merged);
    if (clean) edits[picked] = clean;
    else delete edits[picked];
    placeBox(picked);
    showPicked();
    if (now) void redraw();
    else redrawSoon();
  };

  text.addEventListener('input', () => {
    const block = blocks[picked];
    if (!block) return;
    // Typing the translation back is the same as never having changed it.
    change({ text: text.value === block.translation ? undefined : text.value });
  });
  size.addEventListener('input', () => change({ scale: Number(size.value) / 100 }));
  hide.addEventListener('click', () => change({ hidden: !edits[picked]?.hidden || undefined }, true));
  original.addEventListener('click', () => {
    const was = edits[picked]?.original;
    if (was) {
      delete edits[picked];
      change({}, true);
    } else change({ original: true }, true);
  });
  resetOne.addEventListener('click', () => {
    if (picked < 0) return;
    delete edits[picked];
    text.blur();
    change({}, true);
  });
  resetAll.addEventListener('click', () => {
    edits = {};
    text.blur();
    placeAll();
    showPicked();
    void redraw();
  });

  // --- pointing and dragging ------------------------------------------------

  let press: { index: number; id: number; x: number; y: number; dx: number; dy: number; moved: boolean } | null =
    null;
  frame.addEventListener('pointerdown', (event) => {
    const box = (event.target as HTMLElement).closest<HTMLElement>('.lt-editor-box');
    if (!box) {
      if (event.target === picture) pick(-1);
      return;
    }
    const index = Number(box.dataset['index']);
    event.preventDefault();
    box.setPointerCapture?.(event.pointerId);
    press = {
      index,
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: edits[index]?.dx ?? 0,
      dy: edits[index]?.dy ?? 0,
      moved: false,
    };
    if (picked !== index) pick(index);
  });
  frame.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.id) return;
    const moveX = event.clientX - press.x;
    const moveY = event.clientY - press.y;
    if (!press.moved && Math.hypot(moveX, moveY) < DRAG_PX) return;
    press.moved = true;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const merged = { ...edits[press.index], dx: press.dx + moveX / rect.width, dy: press.dy + moveY / rect.height };
    const clean = cleanEdit(merged);
    if (clean) edits[press.index] = clean;
    else delete edits[press.index];
    // Only the box follows the finger; the picture is drawn when it lets go.
    placeBox(press.index);
  });
  const release = (event: PointerEvent): void => {
    if (!press || event.pointerId !== press.id) return;
    const moved = press.moved;
    press = null;
    if (moved) {
      showPicked();
      void redraw();
    }
  };
  frame.addEventListener('pointerup', release);
  frame.addEventListener('pointercancel', release);
  // Arrow keys move a picked box a little, for whoever is not using a pointer.
  frame.addEventListener('keydown', (event) => {
    if (picked < 0 || !event.key.startsWith('Arrow')) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.02 : 0.004;
    const edit = edits[picked];
    const dx = (edit?.dx ?? 0) + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0);
    const dy = (edit?.dy ?? 0) + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
    change({ dx, dy });
  });
  frame.addEventListener('focusin', (event) => {
    const box = (event.target as HTMLElement).closest<HTMLElement>('.lt-editor-box');
    if (box && Number(box.dataset['index']) !== picked) pick(Number(box.dataset['index']));
  });

  // --- the way out ------------------------------------------------------------

  copy.addEventListener('click', () => options.copy(current()));
  save.addEventListener('click', () => void current().then((blob) => options.save(blob)));
  apply.addEventListener('click', () => {
    options.apply(cleanEdits(edits, blocks.length));
    finish();
  });
  cancel.addEventListener('click', () => finish());
  x.addEventListener('click', () => finish());
  // On the scrim's click, not its press: closed on the press, the release
  // lands on the page (see AGENTS.md, Searching).
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) finish();
  });

  const escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    event.preventDefault();
    finish();
  };
  document.addEventListener('keydown', escape, true);
  // Typing a correction is not the page's business, nor are our own shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    panel.addEventListener(type, (event) => {
      if ((event as KeyboardEvent).key !== 'Escape') event.stopPropagation();
    });
  }

  function finish(): void {
    if (!close) return;
    close = null;
    window.clearTimeout(timer);
    document.removeEventListener('keydown', escape, true);
    backdrop.remove();
    if (shownUrl) URL.revokeObjectURL(shownUrl);
    options.closed();
  }
  close = finish;

  uiRoot().appendChild(backdrop);
  placeAll();
  showPicked();
  void redraw();
}
