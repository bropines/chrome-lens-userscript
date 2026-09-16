import { FIELDS, coerce, getSettings, resetSettings, saveSettings } from '../settings.js';
import type { Field } from '../settings.js';
import type { Settings } from '../types.js';
import { uiRoot } from './root.js';

type SavedHandler = (settings: Settings) => void;

let panel: HTMLDivElement | null = null;

function buildField(field: Field, settings: Settings): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'lt-row';

  const label = document.createElement('span');
  label.className = 'lt-label';
  label.textContent = field.label;
  row.appendChild(label);

  let input: HTMLInputElement | HTMLSelectElement;
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
  if (body) for (const field of FIELDS) body.appendChild(buildField(field, settings));

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
