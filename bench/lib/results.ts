export const RESULTS_DIR = new URL('../results/', import.meta.url).pathname;

function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString(16);
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  return value;
}

/** Write one result file under `bench/results/` and return its path. */
export async function writeResult(name: string, tag: string, body: unknown): Promise<string> {
  const path = `${RESULTS_DIR}${name}-${tag}.json`;
  await Bun.write(path, `${JSON.stringify(body, jsonSafe, 2)}\n`);
  return path;
}
