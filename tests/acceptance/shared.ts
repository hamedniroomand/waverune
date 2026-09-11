/**
 * Pieces shared by the acceptance files. The matrix is split into one file
 * per case so `bun test --parallel` can run the cases on separate cores.
 */
import { PerceptualWatermarker } from '~/watermarkers/perceptual';

import type { Trial } from '../helpers/trial';

export const watermarker = new PerceptualWatermarker();

export function describeFailure(t: Trial): string {
  return `${t.case} ${t.fixture} key=${t.key} payload=${t.payload} ${JSON.stringify(t.params)} -> detected=${t.detected} recovered=${t.recovered} sync=${t.syncValid} crc=${t.checksumValid} shift=${t.sampleShift}`;
}

/** The trials that missed exact recovery, described for the failure message. */
export function inexact(trials: Trial[]): string[] {
  return trials.filter((t) => !t.exact).map(describeFailure);
}

/** The trials that were accepted, described for the failure message. */
export function accepted(trials: Trial[]): string[] {
  return trials.filter((t) => t.detected || t.recovered !== null).map(describeFailure);
}
