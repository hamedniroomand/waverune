/**
 * Shared helpers for the benchmark runners.
 *
 * Every runner writes one JSON file under `bench/results/` and prints a short
 * summary. The JSON carries the environment, the source revision, the
 * configuration and every trial, so the reliability report can cite it.
 */
import { parseArgs } from 'node:util';

import {
  DEFAULT_CONFIG,
  PerceptualWatermarker,
  type PerceptualConfig,
} from '~/watermarkers/perceptual';

export const RESULTS_DIR = new URL('./results/', import.meta.url).pathname;

export interface BenchOptions {
  /** Overrides `alignmentSteps`. */
  steps: number;
  /** A suffix for the result file name. */
  tag: string;
  /** Extra positional arguments. */
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
}

/** Parse the shared benchmark flags plus any runner-specific string flags. */
export function benchArgs(
  extra: Record<string, { type: 'string' | 'boolean' }> = {},
): BenchOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      steps: { type: 'string' },
      tag: { type: 'string' },
      ...extra,
    },
  });
  const steps = values.steps === undefined ? DEFAULT_CONFIG.alignmentSteps : Number(values.steps);
  if (!Number.isInteger(steps) || steps < 1) throw new Error(`--steps must be a positive integer`);
  const tag = values.tag ?? `steps${steps}`;
  return { steps, tag, positionals, values };
}

export function makeWatermarker(steps: number): PerceptualWatermarker {
  return new PerceptualWatermarker({ alignmentSteps: steps });
}

export function effectiveConfig(steps: number): PerceptualConfig {
  return { ...DEFAULT_CONFIG, alignmentSteps: steps };
}

const ROOT = new URL('../', import.meta.url).pathname;

/** The files whose content decides what a benchmark measured. */
// package.json is left out on purpose: a version bump or a dev-dependency
// change does not alter what a benchmark measures.
const HASHED_GLOBS = ['src/**/*.ts', 'tests/helpers/*.ts', 'bench/*.ts', 'tsconfig.json'];

/**
 * A SHA-256 over the source, the fixtures, the benchmark code and tsconfig.
 *
 * A git revision alone does not identify an uncommitted working tree. The
 * hash covers every file that can change a measurement, in sorted path
 * order, so two result files with the same hash came from the same code.
 */
export async function sourceHash(): Promise<string> {
  const paths = new Set<string>();
  for (const pattern of HASHED_GLOBS) {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: ROOT })) paths.add(path);
  }
  return hashFiles([...paths].toSorted(), (path) => Bun.file(`${ROOT}${path}`).bytes());
}

/**
 * The same hash for the files as committed at a git ref.
 *
 * Use it to attribute a result file to a commit, or to check that a working
 * tree matches one: `bun bench/source-hash.ts v0.2.0`.
 */
export async function sourceHashAtRef(ref: string): Promise<string> {
  const listing = Bun.spawnSync(['git', 'ls-tree', '-r', '--name-only', ref], { cwd: ROOT });
  if (listing.exitCode !== 0) throw new Error(`git ls-tree failed for ${ref}`);
  const globs = HASHED_GLOBS.map((g) => new Bun.Glob(g));
  const paths = listing.stdout
    .toString()
    .split('\n')
    .filter((p) => p.length > 0 && globs.some((g) => g.match(p)))
    .toSorted();
  return hashFiles(paths, (path) => {
    const show = Bun.spawnSync(['git', 'show', `${ref}:${path}`], { cwd: ROOT });
    if (show.exitCode !== 0) throw new Error(`git show failed for ${ref}:${path}`);
    return Promise.resolve(new Uint8Array(show.stdout));
  });
}

async function hashFiles(
  paths: string[],
  read: (path: string) => Promise<Uint8Array>,
): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  for (const path of paths) {
    hasher.update(`${path}\n`);
    hasher.update(await read(path));
    hasher.update('\n');
  }
  return hasher.digest('hex');
}

/** Capture the environment once, when the runner starts. */
async function captureEnvironment(): Promise<Record<string, string>> {
  const rev = Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim();
  const dirty = Bun.spawnSync(['git', 'status', '--porcelain']).stdout.toString().trim().length > 0;
  return {
    bun: Bun.version,
    platform: `${process.platform} ${process.arch}`,
    osRelease: (await import('node:os')).release(),
    gitRevision: rev,
    workingTree: dirty ? 'modified' : 'clean',
    sourceHash: await sourceHash(),
    sourceHashCovers: HASHED_GLOBS.join(', '),
    startedAt: new Date().toISOString(),
  };
}

/**
 * The environment at the moment the runner started.
 *
 * Captured eagerly at module load, so the source hash describes the code
 * that actually ran, even when files change during a long run. An earlier
 * version computed it at write time and mis-attributed one long run.
 */
const STARTED_ENVIRONMENT = captureEnvironment();

/** The environment that produced a result file, as captured at start. */
export async function environment(): Promise<Record<string, string>> {
  return { ...(await STARTED_ENVIRONMENT), date: new Date().toISOString() };
}

/** Write one result file and return its path. */
export async function writeResult(name: string, tag: string, body: unknown): Promise<string> {
  const path = `${RESULTS_DIR}${name}-${tag}.json`;
  await Bun.write(path, `${JSON.stringify(body, jsonSafe, 2)}\n`);
  return path;
}

function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString(16);
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  return value;
}

/** Render rows as a GitHub-flavoured markdown table. */
function line(cells: (string | number | boolean)[]): string {
  return `| ${cells.map(String).join(' | ')} |`;
}

export function markdownTable(headers: string[], rows: (string | number | boolean)[][]): string {
  return [line(headers), `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(line)].join(
    '\n',
  );
}

export function fmt(n: number, digits = 3): string {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n);
}

export function elapsed(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(1)} s`;
}
