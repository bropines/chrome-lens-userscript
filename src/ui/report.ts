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
    <div class="lt-panel lt-panel-report" role="dialog" aria-label="Lens Translate diagnostics">
      <header class="lt-panel-head">
        <strong>Diagnostics</strong>
        <button class="lt-x" type="button" aria-label="Close">&times;</button>
      </header>
      <pre class="lt-report"></pre>
      <footer class="lt-panel-foot">
        <button class="lt-btn lt-ghost" type="button" data-act="settings">Settings</button>
        <span class="lt-spacer"></span>
        <button class="lt-btn lt-ghost" type="button" data-act="copy">Copy</button>
        <button class="lt-btn lt-primary" type="button" data-act="close">Close</button>
      </footer>
    </div>`;
  panel = backdrop;
  body = backdrop.querySelector<HTMLPreElement>('.lt-report');
  if (body) body.textContent = text;

  backdrop.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target === backdrop || target.classList.contains('lt-x')) return closeReport();

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
          target.textContent = 'Copied';
          window.setTimeout(() => (target.textContent = 'Copy'), 1500);
        },
        () => {
          const range = document.createRange();
          range.selectNodeContents(body as Node);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          target.textContent = 'Selected - copy it';
        }
      );
    }
    return undefined;
  });

  uiRoot().appendChild(backdrop);
}
