/**
 * The package version, for `waverune --version`.
 *
 * Kept as a constant rather than a JSON import so that every build target
 * (npm bundle, standalone executable, browser) inlines it the same way.
 * `tests/version.test.ts` fails when it drifts from `package.json`.
 */
export const VERSION = '0.3.1';
