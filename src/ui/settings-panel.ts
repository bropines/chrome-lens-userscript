import { FIELDS, GROUPS, coerce, getSettings, resetSettings, saveSettings } from '../settings.js';
import type { Field } from '../settings.js';
import type { Settings } from '../types.js';
import { uiRoot } from './root.js';

type SavedHandler = (settings: Settings) => void;

let panel: HTMLDivElement | null = null;

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

function buildField(field: Field, settings: Settings): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'lt-row';

  const label = document.createElement('span');
  label.className = 'lt-label';
  label.textContent = field.label;
  row.appendChild(label);

  let input: HTMLInputElement | HTMLSelectElement;
  if (field.type === 'range') {
    const slider = document.createElement('input');
    slider.type = 'range';
    if (field.min) slider.min = field.min;
    if (field.max) slider.max = field.max;
    if (field.step) slider.step = field.step;
    slider.value = String(settings[field.key]);

    const readout = document.createElement('span');
    readout.className = 'lt-readout';
    const wantsPreview = field.key === 'outlineScale';
    const preview = document.createElement('canvas');
    preview.className = 'lt-preview';
    preview.width = 460;
    preview.height = 64;

    const refresh = (): void => {
      const value = Number(slider.value);
      readout.textContent =
        field.unit === '%' ? `${Math.round(value * 100)}%` : `${value.toFixed(1)}x`;
      if (wantsPreview) drawOutlinePreview(preview, value);
    };
    slider.addEventListener('input', refresh);
    refresh();

    const holder = document.createElement('span');
    holder.className = 'lt-slider';
    holder.append(slider, readout);
    slider.className = 'lt-input';
    slider.dataset['key'] = field.key;
    row.appendChild(holder);
    if (wantsPreview) row.appendChild(preview);

    if (field.hint) {
      const hint = document.createElement('span');
      hint.className = 'lt-hint';
      hint.textContent = field.hint;
      row.appendChild(hint);
    }
    return row;
  }

  if (field.type === 'select') {
    const select = document.createElement('select');
    for (const [value, text] of field.options ?? []) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    }
    select.value = String(settings[field.key]);
    input = select;
  } else {
    const control = document.createElement('input');
    control.type = field.type;
    if (field.step) control.step = field.step;
    if (field.type === 'checkbox') {
      control.checked = Boolean(settings[field.key]);
      row.classList.add('lt-row-check');
    } else {
      // Bytes are stored, megabytes are shown: nobody wants to type 33554432.
      control.value =
        field.key === 'cacheBytes'
          ? String(Math.round((settings.cacheBytes / (1024 * 1024)) * 10) / 10)
          : String(settings[field.key]);
    }
    input = control;
  }
  input.className = 'lt-input';
  input.dataset['key'] = field.key;
  row.appendChild(input);

  if (field.hint) {
    const hint = document.createElement('span');
    hint.className = 'lt-hint';
    hint.textContent = field.hint;
    row.appendChild(hint);
  }
  return row;
}

function collect(root: HTMLElement): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[data-key="${field.key}"]`
    );
    if (!input) continue;
    const raw =
      field.type === 'checkbox' ? (input as HTMLInputElement).checked : input.value;
    patch[field.key] = coerce(field, raw);
  }
  return patch as Partial<Settings>;
}

export function closeSettings(): void {
  panel?.remove();
  panel = null;
}

export function openSettings(onSaved?: SavedHandler): void {
  if (panel) {
    closeSettings();
    return;
  }
  const settings = getSettings();

  const backdrop = document.createElement('div');
  backdrop.className = 'lt-panel-backdrop';
  backdrop.innerHTML = `
    <div class="lt-panel" role="dialog" aria-label="Lens Translate settings">
      <header class="lt-panel-head">
        <strong>Lens Translate</strong>
        <button class="lt-x" type="button" aria-label="Close">&times;</button>
      </header>
      <div class="lt-panel-body"></div>
      <footer class="lt-panel-foot">
        <button class="lt-btn lt-ghost" type="button" data-act="reset">Reset</button>
        <span class="lt-spacer"></span>
        <button class="lt-btn lt-ghost" type="button" data-act="cancel">Cancel</button>
        <button class="lt-btn lt-primary" type="button" data-act="save">Save</button>
      </footer>
    </div>`;
  panel = backdrop;

  const body = backdrop.querySelector<HTMLDivElement>('.lt-panel-body');
  if (body) {
    for (const group of GROUPS) {
      const fields = FIELDS.filter((field) => field.group === group);
      if (!fields.length) continue;
      const heading = document.createElement('div');
      heading.className = 'lt-group';
      heading.textContent = group;
      body.appendChild(heading);
      for (const field of fields) body.appendChild(buildField(field, settings));
    }
  }

  backdrop.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    // Clicking the backdrop closes; clicking inside the card must not.
    if (target === backdrop) return closeSettings();
    if (target.classList.contains('lt-x')) return closeSettings();

    const action = target.dataset['act'];
    if (action === 'cancel') return closeSettings();
    if (action === 'save') {
      const saved = saveSettings(collect(backdrop));
      closeSettings();
      onSaved?.(saved);
    } else if (action === 'reset') {
      const fresh = resetSettings();
      closeSettings();
      onSaved?.(fresh);
      openSettings(onSaved);
    }
    return undefined;
  });

  const onKey = (event: KeyboardEvent): void => {
    if (!panel) {
      document.removeEventListener('keydown', onKey, true);
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeSettings();
      document.removeEventListener('keydown', onKey, true);
    }
  };
  document.addEventListener('keydown', onKey, true);

  uiRoot().appendChild(backdrop);
  backdrop.querySelector<HTMLElement>('.lt-input')?.focus();
}
