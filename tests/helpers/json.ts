/**
 * Parse JSON printed by the CLI as a known shape. The test then asserts the
 * fields, so an unexpected shape fails there rather than in a type check.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export function parseJson<T>(text: string): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return JSON.parse(text) as T;
}
