import { collect } from './detect.js';
import { hostFacts, probe } from './gm.js';
import { getSettings } from './settings.js';
import { LENS_ENDPOINT } from './lens/client.js';

/**
 * Why the script could not reach Lens, answered on the device.
 *
 * "Network error" is what every failure looks like from inside a userscript:
 * the host reports one word, and it covers a transport that never sent the
 * request, a domain the device is blocking, and a phone that is simply offline.
 * On a desktop the answer is the browser's own network log; on a phone there is
 * no console to open, so the script has to ask the questions itself.
 *
 * Two hosts, two transports, four requests. The Lens endpoint says whether the
 * thing that matters is reachable; the control says whether anything is. GM
 * against fetch says whether the host's own transport is the broken part - the
 * failure AdGuard for Android produced, where the request never left the device
 * at all and its DNS log stayed empty.
 */

/**
 * A second Google host, chosen because it answers CORS.
 *
 * It has to, for web fonts to work at all, which makes it the rare control a
 * page fetch can actually read. And being a `googleapis.com` sibling sharpens
 * the answer: if this one replies and the Lens one does not, what is blocked is
 * that subdomain, not Google.
 */
const CONTROL_URL = 'https://fonts.googleapis.com/css?family=Roboto';

/** Short: nobody waits a minute for a diagnostic, and a hang is an answer too. */
const PROBE_TIMEOUT_MS = 12000;

const TRANSPORTS = ['gm', 'fetch'] as const;

function targets(): ReadonlyArray<readonly [string, Parameters<typeof probe>[1]]> {
  const settings = getSettings();
  return [
    [
      'lens',
      {
        url: LENS_ENDPOINT,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-protobuf',
          'X-Goog-Api-Key': settings.apiKey,
        },
      },
    ],
    ['control', { url: CONTROL_URL, method: 'GET', headers: {} }],
  ];
}

/** A request that came back at all, whatever it came back with. */
const answered = (result: string): boolean => result.startsWith('HTTP');

function verdict(results: Map<string, string>): string {
  const gmLens = answered(results.get('gm -> lens') ?? '');
  const fetchLens = answered(results.get('fetch -> lens') ?? '');
  const anyControl =
    answered(results.get('gm -> control') ?? '') ||
    answered(results.get('fetch -> control') ?? '');

  if (gmLens && fetchLens) {
    return 'Lens is reachable both ways. If translating still fails, the problem is past the transport - send this report with the exact error the toast shows.';
  }
  if (fetchLens) {
    return "Lens is reachable, but this host's own transport is not. That is handled: the script falls back to fetch, which costs one failed attempt per page and sends an Origin header GM_xmlhttpRequest would not.";
  }
  if (gmLens) {
    return "Lens is reachable through the host's transport, which is the path the script prefers anyway.";
  }
  if (anyControl) {
    return 'Nothing reaches Lens, but the control host answers. Something on this device is blocking lensfrontend-pa.googleapis.com specifically - check the DNS filtering and the HTTPS filtering exclusions, and search the activity log for "googleapis".';
  }
  return 'Nothing reaches anything, the control host included. The device has no working connection from this page.';
}

/**
 * What the detector sees here, which is the question a missing button asks.
 *
 * Whether the script runs on this page at all, whether it found anything, and
 * whether what it found is big enough - three answers that cannot be had from
 * a device with no console, and that between them explain every button that
 * failed to appear.
 */
function pageFacts(context: DiagnoseContext): string[] {
  const minSize = getSettings().minImageSize;
  const found = collect(minSize);

  const counts = new Map<string, number>();
  let biggest = '';
  let biggestArea = 0;
  for (const target of found) {
    counts.set(target.kind, (counts.get(target.kind) ?? 0) + 1);
    const rect = target.element.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > biggestArea) {
      biggestArea = area;
      biggest = `${target.kind} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    }
  }

  const tally = [...counts].map(([kind, n]) => `${n} ${kind}`).join(', ') || 'nothing';
  return [
    `page: ${window.location.href.slice(0, 80)}`,
    `button: ${context.pinned ? 'pinned' : 'on hover'}, minimum size ${minSize}px`,
    `found: ${tally}`,
    `biggest: ${biggest || '-'}`,
    `images in document: ${document.images.length}`,
  ];
}

export interface DiagnoseContext {
  pinned: boolean;
}

export async function diagnose(context: DiagnoseContext): Promise<string> {
  const lines = [...hostFacts(), ...pageFacts(context), ''];
  const results = new Map<string, string>();

  for (const [label, target] of targets()) {
    for (const transport of TRANSPORTS) {
      const key = `${transport} -> ${label}`;
      const result = await probe(transport, target, PROBE_TIMEOUT_MS);
      results.set(key, result);
      lines.push(`${key.padEnd(16)} ${result}`);
    }
  }

  lines.push('', verdict(results));
  return lines.join('\n');
}
