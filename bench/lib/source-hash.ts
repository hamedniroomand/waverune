/**
 * A hash over every file that can change a measurement.
 *
 * A git revision alone does not identify an uncommitted working tree. Two
 * result files with the same hash came from the same code.
 */

const ROOT = new URL('../../', import.meta.url).pathname;

/**
 * The files whose content decides what a benchmark measured.
 *
 * `package.json` is left out on purpose. A version bump or a dev-dependency
 * change does not change what a benchmark measures.
 */
export const HASHED_GLOBS = ['src/**/*.ts', 'tests/helpers/*.ts', 'bench/**/*.ts', 'tsconfig.json'];

/** Hash the working tree. */
export async function sourceHash(): Promise<string> {
  const paths = new Set<string>();
  for (const pattern of HASHED_GLOBS) {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: ROOT })) paths.add(path);
  }
  return hashFiles([...paths].toSorted(), (path) => Bun.file(`${ROOT}${path}`).bytes());
}

/**
 * Hash the files as committed at a git ref.
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
