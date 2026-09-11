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
const HASHED_GLOBS = [
  'src/**/*.ts',
  'tests/helpers/*.ts',
  'bench/*.ts',
  'package.json',
  'tsconfig.json',
];

/**
 * A SHA-256 over the source, the fixtures and the benchmark code.
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
  const hasher = new Bun.CryptoHasher('sha256');
  for (const path of [...paths].toSorted()) {
    hasher.update(`${path}\n`);
    hasher.update(await Bun.file(`${ROOT}${path}`).bytes());
    hasher.update('\n');
  }
  return hasher.digest('hex');
}

/** The environment that produced a result file. */
export async function environment(): Promise<Record<string, string>> {
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
    date: new Date().toISOString(),
  };
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
