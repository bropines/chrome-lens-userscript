import type { DetectedObject, NormalizedBox, OcrParagraph } from '../types.js';
import { boxAfterRelease, boxToRect, centreOf, dragToBox, joinPicked, objectsStillValid, pickables } from './geometry.js';
import type { ObjectSource, Point, Rect } from './geometry.js';
import { t } from '../i18n/index.js';
import { icon } from './icons.js';
import type { IconName } from './icons.js';
import { uiRoot } from './root.js';

/**
 * The things done *on* a picture rather than *to* it: marking out an area,
 * tapping one of the objects Lens found, picking words out of what it read.
 *
 * All three are the same two pieces. A layer the exact size and place of the
 * picture, drawn in our shadow root above the page, which takes every pointer
 * that lands on it - and a bar along the bottom of the screen that says what
 * to do and holds the buttons. Only one is open at a time.
 *
 * Pointer events throughout, never mouse or touch ones: a finger, a stylus and
 * a mouse are then one code path. `touch-action: none` is what stops the page
 * scrolling under a finger that is dragging out a rectangle - and only there,
 * and on a word of the text tool, because a picture taller than the screen
 * still has to be scrolled with the other tools open (see styles.css).
 */

export interface ToolOptions {
  /**
   * Where the picture is on screen right now, or null when it has gone.
   * Asked again whenever the page moves, on the front end's periodic sweep
   * and at the start of every press; the layer follows the answer.
   */
  rect(): Rect | null;
}

interface BarButton {
  label: string;
  icon?: IconName;
  primary?: boolean;
  disabled?: boolean;
  run(): void;
}

interface BarContent {
  text: string;
  busy?: boolean;
  input?: { placeholder: string };
  buttons?: BarButton[];
}

interface Frame {
  layer: HTMLDivElement;
  /** The size the layer was last given, which is the picture's size on screen. */
  size(): Rect;
  /**
   * Measure the picture again and follow it; false when it has gone, and the
   * tool with it. A layout shift moves a picture without a scroll or a resize,
   * so nothing else would have said the cached rectangle is stale.
   */
  refresh(): boolean;
  setBar(content: BarContent): HTMLInputElement | null;
}

let active: { close(): void; reposition(): void } | null = null;

export function closeTool(): void {
  active?.close();
  active = null;
}

export const isToolOpen = (): boolean => active !== null;

/** The page scrolled or resized: put the layer back over the picture. */
export function repositionTool(): void {
  active?.reposition();
}

function openFrame(options: ToolOptions, kind: string, onLayout: () => void): Frame | null {
  closeTool();
  const first = options.rect();
  if (!first) return null;

  const root = uiRoot();
  const layer = document.createElement('div');
  layer.className = `lt-tool lt-tool-${kind}`;
  const bar = document.createElement('div');
  bar.className = 'lt-bar';
  bar.setAttribute('role', 'toolbar');

  let current = first;
  const place = (rect: Rect): void => {
    current = rect;
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
  };
  place(first);

  const escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closeTool();
  };
  document.addEventListener('keydown', escape, true);
  // Typing a question is not the page's business; see the same lines in menu.ts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    bar.addEventListener(type, (event) => {
      if ((event as KeyboardEvent).key !== 'Escape') event.stopPropagation();
    });
  }

  root.append(layer, bar);
  // The bar has the bottom of the screen now; the stylesheet moves messages
  // out from under it for as long as this is set.
  root.host.setAttribute('data-tool', kind);
  active = {
    close: () => {
      document.removeEventListener('keydown', escape, true);
      root.host.removeAttribute('data-tool');
      layer.remove();
      bar.remove();
    },
    reposition: () => {
      refresh();
    },
  };
  const mine = active;

  const refresh = (): boolean => {
    if (active !== mine) return false;
    const rect = options.rect();
    // The picture left the page; what was being pointed at is gone with it.
    if (!rect) {
      closeTool();
      return false;
    }
    place(rect);
    onLayout();
    return true;
  };

  // What has been typed belongs to the tool, not to one drawing of the bar:
  // the bar is rebuilt whenever its state changes, and a question typed and
  // then lost to a stray tap on the picture has to be typed again on a phone.
  let typed = '';

  const setBar = (content: BarContent): HTMLInputElement | null => {
    bar.textContent = '';
    const text = document.createElement('div');
    text.className = 'lt-bar-text';
    if (content.busy) text.innerHTML = icon('loader', 16);
    text.append(content.text);
    bar.appendChild(text);

    let input: HTMLInputElement | null = null;
    if (content.input) {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'lt-input';
      input.placeholder = content.input.placeholder;
      input.setAttribute('aria-label', content.input.placeholder);
      input.value = typed;
      const field = input;
      field.addEventListener('input', () => {
        typed = field.value;
      });
      bar.appendChild(input);
    }

    const row = document.createElement('div');
    row.className = 'lt-bar-buttons';
    for (const button of content.buttons ?? []) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = button.primary ? 'lt-btn lt-primary' : 'lt-btn';
      element.innerHTML = button.icon ? icon(button.icon, 16) : '';
      element.append(button.label);
      element.disabled = button.disabled === true;
      // Straight from the click, with nothing awaited first: this is where a
      // tab is asked for, and a browser only grants one during the press.
      element.addEventListener('click', () => button.run());
      row.appendChild(element);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'lt-btn lt-ghost lt-square';
    close.setAttribute('aria-label', t('tool.close'));
    close.innerHTML = icon('close', 16);
    close.addEventListener('click', closeTool);
    row.appendChild(close);
    bar.appendChild(row);
    return input;
  };

  return { layer, size: () => current, refresh, setBar };
}

// --- An area ----------------------------------------------------------------

export interface RegionToolOptions extends ToolOptions {
  /** `text` is whatever was typed, trimmed; it may be empty for either mode. */
  onSearch(box: NormalizedBox, mode: 'visual' | 'ai', text: string): void;
}

export function openRegionTool(options: RegionToolOptions): boolean {
  let box: NormalizedBox | null = null;
  const selection = document.createElement('div');
  selection.className = 'lt-sel';
  selection.hidden = true;

  const draw = (): void => {
    if (!frame || !box) return;
    const rect = boxToRect(box, frame.size());
    selection.style.left = `${rect.left}px`;
    selection.style.top = `${rect.top}px`;
    selection.style.width = `${rect.width}px`;
    selection.style.height = `${rect.height}px`;
  };

  const frame = openFrame(options, 'region', draw);
  if (!frame) return false;
  frame.layer.appendChild(selection);

  const idle = (): void => {
    frame.setBar({ text: t('tool.regionIdle') });
  };
  const chosen = (): void => {
    const chosenBox = box;
    if (!chosenBox) return;
    const input: HTMLInputElement | null = frame.setBar({
      text: t('tool.regionChosen'),
      input: { placeholder: t('tool.regionQuestion') },
      buttons: [
        {
          label: t('tool.search'),
          icon: 'search',
          primary: true,
          run: () => send('visual'),
        },
        { label: t('tool.askAi'), icon: 'sparkles', run: () => send('ai') },
      ],
    });
    const send = (mode: 'visual' | 'ai'): void => {
      const text = input?.value.trim() ?? '';
      closeTool();
      options.onSearch(chosenBox, mode, text);
    };
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) send('visual');
    });
  };
  idle();

  let start: Point | null = null;
  /** The area as it stood before this press, which a tap must leave alone. */
  let before: NormalizedBox | null = null;
  const pictureOnScreen = (): Rect => frame.size();

  frame.layer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    // Measured now rather than trusted from the last scroll: the box is a
    // fraction of this rectangle, and a stale one crops the wrong part.
    if (!frame.refresh()) return;
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
    before = box;
    try {
      // So the drag keeps reporting when it runs off the picture's edge, which
      // is how "up to the edge" is drawn.
      frame.layer.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone; the move events will simply stop.
    }
  });
  frame.layer.addEventListener('pointermove', (event) => {
    if (!start) return;
    const dragged = dragToBox(start, { x: event.clientX, y: event.clientY }, pictureOnScreen());
    if (!dragged) return;
    box = dragged;
    selection.hidden = false;
    draw();
  });
  const finish = (event: PointerEvent): void => {
    if (!start) return;
    // A tap, or a drag too small to have been meant, leaves the last area
    // standing: losing a carefully drawn box to a stray touch is worse.
    const released = boxAfterRelease(start, { x: event.clientX, y: event.clientY }, pictureOnScreen(), before);
    start = null;
    box = released.box;
    if (!box) return;
    selection.hidden = false;
    draw();
    if (released.changed) chosen();
  };
  frame.layer.addEventListener('pointerup', finish);
  frame.layer.addEventListener('pointercancel', () => {
    if (!start) return;
    start = null;
    box = before;
    selection.hidden = !box;
    draw();
  });
  return true;
}

// --- Lens's objects ---------------------------------------------------------

export interface ObjectsToolOptions<S extends ObjectSource> extends ToolOptions {
  /**
   * The upload to take objects from, or null when there was none to be had
   * (the caller has said why). Asked once on opening and again whenever the
   * one held has gone stale.
   */
  load(): Promise<S | null>;
  /** Called straight from the tap, so a tab can still be asked for. */
  onPick(source: S, id: string): void;
}

export function openObjectsTool<S extends ObjectSource>(options: ObjectsToolOptions<S>): boolean {
  const dots: Array<{ object: DetectedObject; dot: HTMLElement; outline: HTMLElement }> = [];

  const layout = (): void => {
    if (!frame) return;
    const size = frame.size();
    for (const { object, dot, outline } of dots) {
      if (!object.geometry) continue;
      const centre = centreOf(object.geometry, size);
      dot.style.left = `${centre.x}px`;
      dot.style.top = `${centre.y}px`;
      const rect = boxToRect(object.geometry, size);
      outline.style.left = `${rect.left}px`;
      outline.style.top = `${rect.top}px`;
      outline.style.width = `${rect.width}px`;
      outline.style.height = `${rect.height}px`;
    }
  };

  const frame = openFrame(options, 'objects', layout);
  if (!frame) return false;
  const mine = active;

  const clear = (): void => {
    for (const { dot, outline } of dots) {
      dot.remove();
      outline.remove();
    }
    dots.length = 0;
  };

  const show = (text: string): void => {
    clear();
    frame.setBar({ text, busy: true });
    void options.load().then((source) => {
      // Closed, or replaced by another tool, while Lens was thinking.
      if (active !== mine) return;
      if (!source) return closeTool();
      const list = source.objects;
      const found = list.filter((object) => object.geometry);
      if (!found.length) {
        frame.setBar({ text: t('tool.noObjects') });
        return undefined;
      }
      found.forEach((object, index) => {
        const outline = document.createElement('div');
        outline.className = 'lt-objbox';
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'lt-dot';
        dot.setAttribute('aria-label', t('tool.objectLabel', { n: index + 1 }));
        dot.addEventListener('click', () => {
          // The session expired while the dots were up, or was reopened by
          // another search: the server has forgotten these ids, and searching
          // with one would describe nothing. Find the objects again instead -
          // they may not even be in the same places.
          if (!objectsStillValid(source, list)) {
            show(t('tool.objectsAgain'));
            return;
          }
          closeTool();
          options.onPick(source, object.id);
        });
        // The outline comes after its dot so `:hover + .lt-objbox` can show it.
        frame.layer.append(dot, outline);
        dots.push({ object, dot, outline });
      });
      layout();
      frame.setBar({ text: t('tool.objectsHint', { count: found.length }) });
      return undefined;
    });
  };

  show(t('tool.objectsLooking'));
  return true;
}

// --- Words out of the text --------------------------------------------------

export interface TextToolOptions extends ToolOptions {
  /** Resolves null when there was no reading it; the caller has said why. */
  paragraphs: Promise<OcrParagraph[] | null>;
  onSearch(text: string): void;
  onCopy(text: string): void;
}

export function openTextTool(options: TextToolOptions): boolean {
  let items = pickables([]);
  const picked = new Set<number>();
  const words: HTMLElement[] = [];

  const layout = (): void => {
    if (!frame) return;
    const size = frame.size();
    items.forEach((item, index) => {
      const element = words[index];
      if (!element) return;
      const rect = boxToRect(item.geometry, size);
      element.style.left = `${rect.left}px`;
      element.style.top = `${rect.top}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
      element.style.transform = item.geometry.angle ? `rotate(${item.geometry.angle}deg)` : '';
    });
  };

  const frame = openFrame(options, 'text', layout);
  if (!frame) return false;
  frame.setBar({ text: t('tool.reading'), busy: true });
  const mine = active;

  const bar = (): void => {
    const text = joinPicked(items, picked);
    frame.setBar({
      text: picked.size ? text : t('tool.wordsHint'),
      buttons: [
        {
          label: picked.size === items.length ? t('tool.none') : t('tool.all'),
          run: () => {
            const all = picked.size !== items.length;
            items.forEach((_, index) => set(index, all));
            bar();
          },
        },
        { label: t('tool.copy'), icon: 'copy', disabled: !picked.size, run: () => options.onCopy(text) },
        {
          label: t('tool.search'),
          icon: 'search',
          primary: true,
          disabled: !picked.size,
          run: () => {
            closeTool();
            options.onSearch(text);
          },
        },
      ],
    });
  };

  const set = (index: number, on: boolean): void => {
    if (on) picked.add(index);
    else picked.delete(index);
    words[index]?.classList.toggle('lt-on', on);
  };

  /** The word under a point. Asked of the shadow root: the document only sees the host. */
  const wordAt = (x: number, y: number): number => {
    const hit = uiRoot().elementFromPoint(x, y);
    return hit ? words.indexOf(hit as HTMLElement) : -1;
  };

  // One press paints: the first word it lands on decides whether the stroke
  // picks or unpicks, and every word it then crosses gets the same. A tap is a
  // stroke one word long, so there is no second gesture to learn.
  let painting: boolean | null = null;
  frame.layer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const index = wordAt(event.clientX, event.clientY);
    if (index < 0) return;
    event.preventDefault();
    painting = !picked.has(index);
    set(index, painting);
    try {
      frame.layer.setPointerCapture(event.pointerId);
    } catch {
      // See the region tool.
    }
  });
  frame.layer.addEventListener('pointermove', (event) => {
    if (painting === null) return;
    const index = wordAt(event.clientX, event.clientY);
    if (index >= 0) set(index, painting);
  });
  for (const type of ['pointerup', 'pointercancel']) {
    frame.layer.addEventListener(type, () => {
      if (painting === null) return;
      painting = null;
      bar();
    });
  }

  void options.paragraphs.then((paragraphs) => {
    if (active !== mine) return;
    if (!paragraphs) return closeTool();
    items = pickables(paragraphs);
    if (!items.length) {
      frame.setBar({ text: t('tool.noText') });
      return undefined;
    }
    for (const item of items) {
      const element = document.createElement('div');
      element.className = 'lt-word';
      element.title = item.text;
      frame.layer.appendChild(element);
      words.push(element);
    }
    layout();
    bar();
    return undefined;
  });
  return true;
}
