import { icon } from './icons.js';
import type { IconName } from './icons.js';
import { isOurs, uiRoot } from './root.js';

/**
 * A small menu next to the button.
 *
 * The button does one thing, and the actions that belong to a particular
 * picture - searching it, copying what it says, undoing it - have nowhere else
 * to live: the userscript menu is not about any picture, and on a phone does
 * not exist. This is drawn in the same shadow root as everything else, so a
 * page's stylesheet cannot restyle it, and it closes the way a menu does: on a
 * press elsewhere and on Escape.
 *
 * On a narrow or touch screen it is a sheet along the bottom edge instead of a
 * popup beside the button: a popup there is a column of small targets under
 * the thumb that opened it, and the one item with a text field would be
 * exactly where the keyboard comes up.
 */

export interface MenuField {
  value: string;
  placeholder: string;
  /** What sending is called, for a screen reader: the button is only an arrow. */
  sendLabel: string;
  submit(text: string): void;
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** Not called for an item with a `field`; that one submits instead. */
  run(): void;
  /** Shown but inert: a hint about something that is not available right now. */
  disabled?: boolean;
  /** A rule above this item, where one kind of action ends and another starts. */
  divider?: boolean;
  /**
   * A text field under the item. Pressing the item, the arrow beside the field
   * or Enter inside it all send whatever the field holds, empty included.
   */
  field?: MenuField;
}

/**
 * When the UI lays itself out for a thumb.
 *
 * The stylesheet asks the same question in the same words; this copy is for
 * the one decision CSS cannot make, which is whether to compute a position
 * beside the button at all.
 */
export const COMPACT_QUERY = '(max-width: 640px), (pointer: coarse)';
export const isCompact = (): boolean => window.matchMedia(COMPACT_QUERY).matches;

let menu: HTMLElement | null = null;
let teardown: (() => void) | null = null;

export function closeMenu(): void {
  teardown?.();
  teardown = null;
  menu?.remove();
  menu = null;
}

export const isMenuOpen = (): boolean => menu !== null;

function buildItem(item: MenuItem): HTMLElement {
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.className = 'lt-menu-item';
  entry.setAttribute('role', 'menuitem');
  entry.innerHTML = item.icon ? icon(item.icon) : '<span class="lt-icon"></span>';
  const label = document.createElement('span');
  label.textContent = item.label;
  entry.appendChild(label);
  if (item.disabled) entry.disabled = true;

  const field = item.field;
  if (!field) {
    entry.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      item.run();
    });
    return entry;
  }

  const group = document.createElement('div');
  group.className = 'lt-menu-ask';
  const row = document.createElement('div');
  row.className = 'lt-field-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'lt-input';
  input.value = field.value;
  input.placeholder = field.placeholder;
  input.setAttribute('aria-label', field.placeholder);
  input.enterKeyHint = 'send';
  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'lt-btn lt-primary lt-square';
  send.setAttribute('aria-label', field.sendLabel);
  send.innerHTML = icon('send');
  row.append(input, send);
  group.append(entry, row);

  // Synchronous, straight from the event: opening a tab is only allowed while
  // the press that asked for it is still being handled.
  const submit = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    const text = input.value;
    closeMenu();
    field.submit(text);
  };
  entry.addEventListener('click', submit);
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) submit(event);
  });
  return group;
}

/**
 * Where the menu's corner goes, in viewport coordinates - on a screen wide
 * enough to have a corner to put it at.
 *
 * `opener` is the control that opens it. A press on it must not count as
 * "elsewhere": the menu would close on the press and the same click would open
 * it again, so a button that is meant to toggle could only ever reopen.
 */
export function openMenu(
  at: { top: number; left: number },
  items: MenuItem[],
  opener?: Element
): void {
  closeMenu();
  const compact = isCompact();

  const element = document.createElement('div');
  element.className = compact ? 'lt-menu lt-sheet' : 'lt-menu';
  element.setAttribute('role', 'menu');
  for (const item of items) {
    if (item.divider) {
      const rule = document.createElement('div');
      rule.className = 'lt-menu-rule';
      element.appendChild(rule);
    }
    element.appendChild(buildItem(item));
  }

  // What is typed into the field is for the field. A reader turns the page on
  // an arrow key or a space, and its listeners are further up the same path.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    element.addEventListener(type, (event) => {
      if ((event as KeyboardEvent).key !== 'Escape') event.stopPropagation();
    });
  }

  let outer: HTMLElement = element;
  if (compact) {
    // A sheet needs something behind it that takes the press meant to dismiss
    // it: without a scrim that press lands on the page, and on a reader the
    // page turns as the menu closes.
    //
    // And it closes on the click, not on the press. Closed on `pointerdown`
    // the scrim is gone by the time the finger lifts, so the click that
    // follows is delivered to whatever was underneath - the very thing the
    // scrim is there to prevent.
    const scrim = document.createElement('div');
    scrim.className = 'lt-scrim';
    scrim.appendChild(element);
    scrim.addEventListener('click', (event) => {
      if (event.target !== scrim) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    });
    outer = scrim;
  }
  uiRoot().appendChild(outer);
  menu = outer;

  if (!compact) {
    // Placed after it exists, so it can be measured and kept on screen.
    const box = element.getBoundingClientRect();
    const left = Math.max(4, Math.min(at.left, window.innerWidth - box.width - 4));
    const top = Math.max(4, Math.min(at.top, window.innerHeight - box.height - 4));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  const away = (event: Event): void => {
    // Inside the menu is the menu's own business; the shadow root retargets
    // the event, so the path is what says where it really landed.
    const path = event.composedPath();
    if (path.includes(element) || (opener && path.includes(opener))) return;
    closeMenu();
  };
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closeMenu();
  };
  const scrolled = (event: Event): void => {
    // The sheet's own list scrolling is not the page moving out from under it.
    if (!isOurs(event.target)) closeMenu();
  };
  // A sheet's scrim covers everything else and dismisses on its own click.
  if (!compact) document.addEventListener('pointerdown', away, true);
  document.addEventListener('keydown', escape, true);
  // A popup is anchored to a button the scroll carries away. A sheet is
  // anchored to the screen - and the browser scrolls the page by itself to
  // bring a focused field above the keyboard, which is not a reason to close
  // the sheet the field is in. Nothing here closes on resize either: an
  // address bar sliding away fires one with nobody having done anything.
  if (!compact) window.addEventListener('scroll', scrolled, true);
  window.addEventListener('blur', closeMenu);
  teardown = () => {
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', escape, true);
    window.removeEventListener('scroll', scrolled, true);
    window.removeEventListener('blur', closeMenu);
  };

  // On a touch screen focus is where the keyboard goes, and nothing here
  // should summon it before the field is tapped. A button does not.
  element.querySelector<HTMLButtonElement>('.lt-menu-item:not(:disabled)')?.focus({ preventScroll: true });
}
