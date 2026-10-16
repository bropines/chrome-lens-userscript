import { uiRoot } from './root.js';

/**
 * A small menu next to the button.
 *
 * The button does one thing, and the actions that belong to a particular
 * picture - copying what it says, undoing it - have nowhere else to live: the
 * userscript menu is not about any picture, and on a phone does not exist. This
 * is drawn in the same shadow root as everything else, so a page's stylesheet
 * cannot restyle it, and it closes the way a menu does: on a click elsewhere,
 * on Escape, and when the page scrolls out from under it.
 */

export interface MenuItem {
  label: string;
  run(): void;
  /** Shown but inert: a hint about something that is not available right now. */
  disabled?: boolean;
}

let menu: HTMLDivElement | null = null;
let teardown: (() => void) | null = null;

export function closeMenu(): void {
  teardown?.();
  teardown = null;
  menu?.remove();
  menu = null;
}

export const isMenuOpen = (): boolean => menu !== null;

/**
 * Where the menu's corner goes, in viewport coordinates.
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

  const element = document.createElement('div');
  element.className = 'lt-menu';
  element.setAttribute('role', 'menu');

  for (const item of items) {
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'lt-menu-item';
    entry.setAttribute('role', 'menuitem');
    entry.textContent = item.label;
    if (item.disabled) entry.disabled = true;
    entry.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      item.run();
    });
    element.appendChild(entry);
  }

  uiRoot().appendChild(element);
  menu = element;

  // Placed after it exists, so it can be measured and kept on screen.
  const box = element.getBoundingClientRect();
  const left = Math.max(4, Math.min(at.left, window.innerWidth - box.width - 4));
  const top = Math.max(4, Math.min(at.top, window.innerHeight - box.height - 4));
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;

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
  document.addEventListener('pointerdown', away, true);
  document.addEventListener('keydown', escape, true);
  window.addEventListener('scroll', closeMenu, true);
  window.addEventListener('blur', closeMenu);
  teardown = () => {
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', escape, true);
    window.removeEventListener('scroll', closeMenu, true);
    window.removeEventListener('blur', closeMenu);
  };

  element.querySelector<HTMLButtonElement>('.lt-menu-item:not(:disabled)')?.focus();
}
