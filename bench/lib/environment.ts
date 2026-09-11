import { HASHED_GLOBS, sourceHash } from './source-hash';

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
 * The module captures it at load time, so the source hash describes the code
 * that ran, even when files change during a long run. An earlier version
 * computed it at write time and attributed one long run to the wrong code.
 */
const STARTED_ENVIRONMENT = captureEnvironment();

/** The environment that produced a result file, with the write time added. */
export async function environment(): Promise<Record<string, string>> {
  return { ...(await STARTED_ENVIRONMENT), date: new Date().toISOString() };
}
