/**
 * Compile standalone executables with `bun build --compile`.
 *
 * Each file embeds the Bun runtime, so it runs on a machine without Node or
 * Bun. The files are tens of megabytes each. They go to GitHub Release assets,
 * never into the npm package.
 *
 * Usage: bun scripts/build-binaries.ts [target ...]
 * With no arguments the script builds every target below into `release/`.
 */
import { mkdir, rm } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = `${ROOT}release/`;

const TARGETS: Record<string, string> = {
  'bun-darwin-arm64': 'waverune-darwin-arm64',
  'bun-darwin-x64': 'waverune-darwin-x64',
  'bun-linux-x64': 'waverune-linux-x64',
  'bun-linux-arm64': 'waverune-linux-arm64',
  'bun-windows-x64': 'waverune-windows-x64.exe',
};

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : Object.keys(TARGETS);

for (const target of targets) {
  if (!(target in TARGETS)) {
    console.error(`Unknown target "${target}". Known: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const target of targets) {
  const outfile = `${OUT}${TARGETS[target]}`;
  console.log(`building ${target} -> release/${TARGETS[target]}`);
  const proc = Bun.spawnSync(
    ['bun', 'build', `${ROOT}src/bin.ts`, '--compile', `--target=${target}`, '--outfile', outfile],
    { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' },
  );
  if (proc.exitCode !== 0) process.exit(proc.exitCode);
}
