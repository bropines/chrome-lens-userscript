/**
 * Every file in `locales/` must say what English says, key for key.
 *
 * A locale is downloaded by people who cannot tell a missing string from a
 * broken script, and the script itself forgives everything - an unknown key is
 * dropped, a mangled placeholder falls back to English - so a file can rot for
 * releases without anyone seeing an error. This is where it is an error.
 *
 *   bun run locales:check              check every file, exit 1 on any problem
 *   bun run locales:check --template   print English as JSON, to start a new file from
 *
 * The rules themselves are `localeProblems` in src/i18n/locale.ts, which the
 * tests run too; this is only the walk over the directory.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EN } from '../src/i18n/en.ts';
import { LOCALES, localeProblems } from '../src/i18n/locale.ts';

if (process.argv.includes('--template')) {
  console.log(JSON.stringify(EN, null, 2));
  process.exit(0);
}

const dir = resolve(import.meta.dirname, '..', 'locales');
const problems: string[] = [];
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));

for (const code of LOCALES) {
  if (!files.includes(`${code}.json`)) problems.push(`${code}: locales/${code}.json does not exist`);
}
for (const file of files) {
  const code = file.replace(/\.json$/, '');
  if (!(LOCALES as readonly string[]).includes(code)) {
    problems.push(`${code}: not listed in LOCALES (src/i18n/locale.ts), so nobody can choose it`);
    continue;
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
    problems.push(...localeProblems(code, raw, EN));
  } catch (error) {
    problems.push(`${code}: ${(error as Error).message}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s) in locales/`);
  process.exit(1);
}
console.log(`locales clean: ${files.length} files, ${Object.keys(EN).length} keys each`);
