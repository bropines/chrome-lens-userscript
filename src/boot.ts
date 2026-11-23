import { preloadStored } from './gm.js';
import { start } from './main.js';
import { isFramed, sleepUntilPicture, topHostname } from './frame.js';
import { SETTINGS_KEYS, getSettings, reloadSettings } from './settings.js';
import { SITES_KEY, hostOf, reloadSites, siteMode } from './sites.js';

/**
 * The entry point: start now in the top window, or sleep in a frame.
 *
 * The header no longer says `@noframes`, so this runs in every frame of every
 * page - which is exactly the cost `@noframes` was there to avoid. Everything a
 * frame does before it wakes is here and in frame.ts, and it is deliberately
 * small: read two stored values, decide whether this frame may ever wake, and
 * leave three listeners that look at one element each.
 */

if (!isFramed()) {
  start({ framed: false, hovered: null });
} else {
  void (async (): Promise<void> => {
    // A frame decides whether to exist from the settings, so on a host whose
    // storage is promise-only they have to arrive first; everywhere else this
    // resolves at once and changes nothing.
    if (await preloadStored([...SETTINGS_KEYS, SITES_KEY])) {
      reloadSettings();
      reloadSites();
    }
    if (!getSettings().frames) return;
    // The frame's own hostname is what its rules are kept under, which is what
    // a person switching a site off from inside that frame would have written.
    if (siteMode() === 'off') return;
    // And a frame on a page that was switched off is part of that page. The top
    // is not always knowable from in here (see topHostname); unknown is not off.
    const top = topHostname();
    if (top && siteMode(hostOf(top)) === 'off') return;
    sleepUntilPicture(
      () => getSettings().minImageSize,
      (hovered) => start({ framed: true, hovered })
    );
  })();
}
