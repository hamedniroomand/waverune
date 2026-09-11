/**
 * The shared helpers of the benchmark runners.
 *
 * Every runner writes one JSON file under `bench/results/` and prints a short
 * summary. The JSON carries the environment, the source hash, the
 * configuration and every trial, so the reliability report can cite it.
 */
export { benchArgs, effectiveConfig, makeWatermarker, type BenchOptions } from './args';
export { environment } from './environment';
export { elapsed, fmt, markdownTable } from './format';
export { RESULTS_DIR, writeResult } from './results';
export { HASHED_GLOBS, sourceHash, sourceHashAtRef } from './source-hash';
