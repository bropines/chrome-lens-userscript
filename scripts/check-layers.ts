/**
 * The engine must not import the application.
 *
 * `src/engine.ts` is what a second consumer installs, and the thing that makes
 * it installable is negative: nothing reachable from it may touch `$`, a GM
 * function, the settings store or our own UI. That property held exactly once,
 * on the day it was arranged. Three imports had already crossed the line
 * before anyone looked - a detector that knew our shadow host's id, the same
 * detector reaching into the renderer for our cover marker, and the DOM
 * renderer drawing its layer into our settings panel's shadow root - and each
 * was a one-line convenience at the time.
 *
 * So it is checked rather than intended. This walks the import closure of the
 * entry point and fails if it reaches anything above the line, which is a
 * build error the moment such an import is written rather than a surprise for
 * whoever tries to reuse this next.
 */

import { readFileSync } from 'node:fs';
import { dirname, posix, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRY = 'src/engine.ts';

/** Modules that are this userscript's own, and may never be reached from the entry. */
const APPLICATION = [
  'src/main.ts',
  'src/gm.ts',
  'src/settings.ts',
  'src/languages.ts',
  'src/diagnose.ts',
  'src/ui/',
];

/** Every `from '...'` and bare `import '...'`, which is all this file needs to see. */
function importsOf(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

const visited = new Set<string>();
const problems: string[] = [];

function visit(file: string, via: string[]): void {
  if (visited.has(file)) return;
  visited.add(file);

  const offence = APPLICATION.find((path) => file === path || file.startsWith(path));
  if (offence) {
    problems.push(`${file} is the application, reached by ${[...via, file].join(' -> ')}`);
    return;
  }

  let source: string;
  try {
    source = readFileSync(resolve(ROOT, file), 'utf8');
  } catch {
    problems.push(`${file} does not exist, imported by ${via[via.length - 1] ?? ENTRY}`);
    return;
  }

  for (const specifier of importsOf(source)) {
    if (!specifier.startsWith('.')) {
      // A bare specifier in the engine is either `$` - the userscript host,
      // which is the whole thing this boundary exists to keep out - or a
      // dependency a consumer would have to install to use it.
      problems.push(`${file} imports '${specifier}', which is not part of the engine`);
      continue;
    }
    // Written as the runtime path, which TypeScript resolves back to source.
    const target = specifier.replace(/\.js$/, '.ts').replace(/\?raw$/, '');
    visit(posix.normalize(relative(ROOT, resolve(dirname(resolve(ROOT, file)), target))
      .split('\\').join('/')), [...via, file]);
  }
}

visit(ENTRY, []);

if (problems.length > 0) {
  console.error(`${ENTRY} reaches outside the engine:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nThe engine is what another script installs; it cannot depend on this one.');
  process.exit(1);
}

console.log(`engine closure clean: ${visited.size} modules reachable from ${ENTRY}`);
