import { t } from '../i18n/index.js';
import type { Key } from '../i18n/index.js';
import { icon } from './icons.js';
import { uiRoot } from './root.js';

/**
 * A panel for text the user needs to get off the phone.
 *
 * Selecting text out of a shadow root on a touch screen is a fight, so the
 * report comes with a button that copies the whole thing.
 */

let panel: HTMLDivElement | null = null;
let body: HTMLPreElement | null = null;
let onSettings: (() => void) | null = null;

/**
 * What the report's Settings button does.
 *
 * Registered rather than imported so this module stays a panel and not a menu.
 * It matters because the report is reachable when nothing else is: if the
 * button never appeared, the gear did not either, and settings would otherwise
 * be out of reach on the one device where that happens.
 */
export function onReportSettings(open: () => void): void {
  onSettings = open;
}

export function closeReport(): void {
  panel?.remove();
  panel = null;
  body = null;
}

export function openReport(text: string): void {
  if (body) {
    body.textContent = text;
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'lt-panel-backdrop';
  backdrop.innerHTML = `
    <div class="lt-panel lt-panel-report" role="dialog">
      <header class="lt-panel-head">
        <strong data-t="report.title"></strong>
        <button class="lt-x" type="button" data-act="close">${icon('close')}</button>
      </header>
      <pre class="lt-report"></pre>
      <footer class="lt-panel-foot">
        <button class="lt-btn lt-ghost" type="button" data-act="settings" data-t="report.settings"></button>
        <span class="lt-spacer"></span>
        <button class="lt-btn lt-ghost" type="button" data-act="copy" data-t="report.copy"></button>
        <button class="lt-btn lt-primary" type="button" data-act="close" data-t="report.close"></button>
      </footer>
    </div>`;
  // Words go in as text, never as markup: a translation is a file from the
  // network, and nothing in it is allowed to be an element.
  backdrop.querySelector('.lt-panel')?.setAttribute('aria-label', t('report.aria'));
  backdrop.querySelector('.lt-x')?.setAttribute('aria-label', t('report.close'));
  for (const element of backdrop.querySelectorAll<HTMLElement>('[data-t]')) {
    element.textContent = t(element.dataset['t'] as Key);
  }
  panel = backdrop;
  body = backdrop.querySelector<HTMLPreElement>('.lt-report');
  if (body) body.textContent = text;

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) return closeReport();
    // An icon inside a button is what the click lands on, not the button.
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!target) return undefined;

    const action = target.dataset['act'];
    if (action === 'close') return closeReport();
    if (action === 'settings') {
      closeReport();
      onSettings?.();
      return undefined;
    }
    if (action === 'copy' && body) {
      const report = body.textContent ?? '';
      // The clipboard API needs a secure context and a permission the page may
      // not have; a selection is something the user can always act on.
      void navigator.clipboard?.writeText(report).then(
        () => {
          target.textContent = t('report.copied');
          window.setTimeout(() => (target.textContent = t('report.copy')), 1500);
        },
        () => {
          const range = document.createRange();
          range.selectNodeContents(body as Node);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          target.textContent = t('report.selected');
        }
      );
    }
    return undefined;
  });

  uiRoot().appendChild(backdrop);
}
