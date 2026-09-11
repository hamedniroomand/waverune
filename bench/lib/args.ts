import { parseArgs } from 'node:util';

import {
  DEFAULT_CONFIG,
  PerceptualWatermarker,
  type PerceptualConfig,
} from '~/watermarkers/perceptual';

export interface BenchOptions {
  /** The `alignmentSteps` override. */
  steps: number;
  /** The suffix of the result file name. */
  tag: string;
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
}

/** Parse the shared benchmark flags plus any runner-specific flags. */
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
