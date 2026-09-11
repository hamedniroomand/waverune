/**
 * Rewrite the `~/` import alias inside emitted `.d.ts` files.
 *
 * `tsc` emits import specifiers as they appear in the source. The alias
 * resolves in this repository through `tsconfig.json`, but a consumer's
 * compiler does not know it. This script turns every `'~/x/y'` into the
 * relative path from the declaration file to `dist/x/y`.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const ALIAS = /(['"])~\/([^'"]+)\1/g;

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.name.endsWith('.d.ts')) files.push(path);
  }
  return files;
}

/**
 * Rewrite aliases in every declaration file under `distDir`.
 *
 * @param distDir - the directory that holds the emitted declarations.
 * @returns the number of files that changed.
 */
export async function fixDtsAliases(distDir: string): Promise<number> {
  let changed = 0;
  for (const file of await walk(distDir)) {
    const source = await readFile(file, 'utf8');
    const rewritten = source.replace(ALIAS, (_match, quote: string, target: string) => {
      let rel = relative(dirname(file), join(distDir, target)).split('\\').join('/');
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return `${quote}${rel}${quote}`;
    });
    if (rewritten !== source) {
      await writeFile(file, rewritten);
      changed++;
    }
  }
  return changed;
}

if (import.meta.main) {
  const dir = process.argv[2] ?? new URL('../dist/', import.meta.url).pathname;
  console.log(`rewrote ${await fixDtsAliases(dir)} file(s)`);
}
