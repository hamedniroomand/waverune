/**
 * Build the npm package into `dist/`.
 *
 * 1. Bundle `src/index.ts` and `src/bin.ts` with Bun for the Node target.
 *    Shared code lands in one chunk, so the CLI and the library do not carry
 *    two copies of the codec. `node:*` imports stay external.
 * 2. Emit the declaration files with `tsc` from `tsconfig.build.json`.
 * 3. Rewrite the `~/` alias in the declaration files to relative paths,
 *    because `tsc` copies import specifiers as written.
 *
 * Run with `bun scripts/build.ts`. Bun is the build tool. The output runs on
 * Node without Bun.
 */
import { rm } from 'node:fs/promises';

import { fixDtsAliases } from './fix-dts-aliases';

const ROOT = new URL('../', import.meta.url);
const DIST = new URL('dist/', ROOT).pathname;

await rm(DIST, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [new URL('src/index.ts', ROOT).pathname, new URL('src/bin.ts', ROOT).pathname],
  outdir: DIST,
  target: 'node',
  format: 'esm',
  splitting: true,
  sourcemap: 'none',
  naming: {
    entry: '[name].[ext]',
    chunk: 'chunk-[hash].[ext]',
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const output of result.outputs) {
  console.log(`  ${output.path.replace(ROOT.pathname, '')}  ${output.size} bytes`);
}

const tsc = Bun.spawnSync(['bunx', 'tsc', '-p', 'tsconfig.build.json'], {
  cwd: ROOT.pathname,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (tsc.exitCode !== 0) process.exit(tsc.exitCode);

const rewritten = await fixDtsAliases(DIST);
console.log(`  declarations: ${rewritten} file(s) rewritten`);
