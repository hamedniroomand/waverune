/**
 * The acceptance matrix.
 *
 * This file declares every case in the required support envelope: the
 * fixtures, sample rates, keys, payloads, offsets, durations and attack
 * parameters, with the required outcome. `tests/acceptance.test.ts` runs the
 * required cases. `bench/` runs the measurement cases and writes the results
 * that the reliability report cites.
 *
 * The matrix was fixed before any algorithm tuning in this milestone. A case
 * that cannot pass is reported as unmet, never removed or relabelled.
 */
import type { AudioBuffer } from '~/types';

import { lcg } from './lcg';
import { musicLike, speechLike } from './signals';

export type SignalClass = 'tonal' | 'broadband';

export interface Fixture {
  id: string;
  signal: SignalClass;
  seconds: number;
  sampleRate: number;
}

export const SAMPLE_RATE = 44100;

/** The hop at 44.1 kHz, `round(44100 * 0.01)`. The offsets below refer to it. */
export const HOP_44K = 441;

/** One payload block at 44.1 kHz: 150 frames of 441 samples, 1.5 s. */
export const BLOCK_SAMPLES_44K = 150 * HOP_44K;

export const FIXTURES: Record<string, Fixture> = {
  'tonal-4s-44k': { id: 'tonal-4s-44k', signal: 'tonal', seconds: 4, sampleRate: 44100 },
  'broadband-4s-44k': {
    id: 'broadband-4s-44k',
    signal: 'broadband',
    seconds: 4,
    sampleRate: 44100,
  },
  'tonal-6s-44k': { id: 'tonal-6s-44k', signal: 'tonal', seconds: 6, sampleRate: 44100 },
  'broadband-6s-44k': {
    id: 'broadband-6s-44k',
    signal: 'broadband',
    seconds: 6,
    sampleRate: 44100,
  },
  'tonal-6s-48k': { id: 'tonal-6s-48k', signal: 'tonal', seconds: 6, sampleRate: 48000 },
  'broadband-6s-48k': {
    id: 'broadband-6s-48k',
    signal: 'broadband',
    seconds: 6,
    sampleRate: 48000,
  },
};

const BUILDERS: Record<SignalClass, (seconds: number, sr: number) => AudioBuffer> = {
  tonal: speechLike,
  broadband: musicLike,
};

/** Build one fixture from its declaration. The builders are deterministic. */
export function buildFixture(id: string): AudioBuffer {
  const fixture = FIXTURES[id];
  if (!fixture) throw new Error(`Unknown fixture ${id}`);
  return BUILDERS[fixture.signal](fixture.seconds, fixture.sampleRate);
}

/** The 20 deterministic key and payload pairs for clean recovery. */
export const CLEAN_PAIRS = { seed: 0x5eed1234, count: 20 };

/** The fixtures of the clean-recovery and WAV round-trip cases. */
export const CLEAN_FIXTURES = ['tonal-4s-44k', 'broadband-4s-44k'];

/** The WAV encoding of the round-trip case. */
export const WAV_ROUND_TRIP = { bitDepth: 16 as const };

/** The key and payload of every six-second robustness case. */
export const ROBUSTNESS = { key: 'robustness', payload: 0xcafe_1234n };

/** The fixtures of the gain and prefix-removal cases. */
export const ROBUSTNESS_FIXTURES = ['tonal-6s-44k', 'broadband-6s-44k'];

export const GAINS = [0.5, 2.0];

export interface PrefixCase {
  samples: number;
  label: string;
  group: 'sub-ms' | 'ms' | 'hop-aligned' | 'between-hops-seeded' | 'beyond-block';
}

/**
 * Prefix removal in samples at 44.1 kHz.
 *
 * Each case removes the prefix and keeps the rest of the six-second fixture.
 * At least four seconds remain in every case. The largest removal is 88200
 * samples, 2.0 s.
 *
 * The seeded groups come from `lcg(0x0ff5e7)` for the between-hops cases,
 * `1 + v % 440`, and from `lcg(0xb10c)` for the beyond-block cases,
 * `66151 + v % 22049` with multiples of 441 skipped. The values are written
 * out so the manifest is readable without the generator. `matrixSeedsMatch`
 * checks them.
 */
export const PREFIX_CASES: PrefixCase[] = [
  { samples: 1, label: '1 sample', group: 'sub-ms' },
  { samples: 44, label: '~1 ms (0.998 ms)', group: 'ms' },
  { samples: 110, label: '2.5 ms (0.249 hop), the reproduced failure', group: 'ms' },
  { samples: 220, label: '~5 ms (4.99 ms, 0.499 hop)', group: 'ms' },
  { samples: 441, label: '1 hop', group: 'hop-aligned' },
  { samples: 882, label: '2 hops', group: 'hop-aligned' },
  { samples: 1323, label: '3 hops', group: 'hop-aligned' },
  { samples: 12, label: 'seeded, 0.027 hop', group: 'between-hops-seeded' },
  { samples: 58, label: 'seeded, 0.132 hop', group: 'between-hops-seeded' },
  { samples: 141, label: 'seeded, 0.320 hop', group: 'between-hops-seeded' },
  { samples: 379, label: 'seeded, 0.859 hop', group: 'between-hops-seeded' },
  { samples: 66150, label: '1 block (1.5 s), hop-aligned', group: 'beyond-block' },
  { samples: 66260, label: '1 block + 110 samples', group: 'beyond-block' },
  { samples: 79366, label: 'seeded, 1.800 s', group: 'beyond-block' },
  { samples: 82077, label: 'seeded, 1.861 s', group: 'beyond-block' },
  { samples: 84280, label: 'seeded, 1.911 s', group: 'beyond-block' },
  { samples: 88200, label: '2.0 s, retains exactly 4.0 s', group: 'beyond-block' },
];

/** The smallest remaining duration that a required prefix case can leave. */
export const PREFIX_MIN_REMAINING_SECONDS = 4;

function sameSet(x: number[], y: number[]): boolean {
  const a = x.toSorted((p, q) => p - q);
  const b = y.toSorted((p, q) => p - q);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Regenerate the seeded offsets and compare them with the written values. */
export function matrixSeedsMatch(): boolean {
  const a = lcg(0x0ff5e7);
  const between: number[] = [];
  while (between.length < 4) {
    const v = 1 + (a() % 440);
    if (!between.includes(v)) between.push(v);
  }
  const b = lcg(0xb10c);
  const beyond: number[] = [];
  while (beyond.length < 3) {
    const v = 66151 + (b() % (88200 - 66151));
    if (v % HOP_44K !== 0 && !beyond.includes(v)) beyond.push(v);
  }
  const declaredBetween = PREFIX_CASES.filter((c) => c.group === 'between-hops-seeded').map(
    (c) => c.samples,
  );
  const declaredBeyond = PREFIX_CASES.filter((c) => c.label.startsWith('seeded, 1.')).map(
    (c) => c.samples,
  );
  return sameSet(between, declaredBetween) && sameSet(beyond, declaredBeyond);
}

/**
 * The deterministic rejection set that CI runs.
 *
 * Every trial must end with `detected` false and `payload` null. The set
 * covers unmarked audio under several keys, marked audio under wrong keys,
 * digital silence, and audio far below full scale.
 */
export const REJECTION = {
  /** Unmarked fixtures, each detected under every key here. */
  cleanFixtures: ['tonal-4s-44k', 'broadband-4s-44k', 'tonal-6s-44k', 'broadband-6s-44k'],
  cleanKeys: ['waverune', 'secret', 'robustness', 'k1', 'nobody-embedded-this'],
  /** The six-second robustness fixtures, marked with the robustness key, detected under these keys. */
  wrongKeys: [
    'wrong',
    'robustnes',
    'Robustness',
    'robustness ',
    'key-1',
    'key-2',
    'key-3',
    'key-4',
  ],
  /** Digital silence, in seconds at 44.1 kHz, detected under these keys. */
  silenceSeconds: [4, 6],
  silenceKeys: ['waverune', 'robustness'],
  /** The clean four-second fixtures scaled by this gain, detected under the clean keys. */
  lowEnergyGain: 1e-4,
  /** A fixture marked with pair i, detected with the key of pair j, for i != j. */
  crossPairs: { seed: 0x5eed1234, count: 6 },
};

/** The sample-rate conversions that the resampling evaluation measures. */
export const RESAMPLE_CASES: { fromHz: number; toHz: number }[] = [
  { fromHz: 44100, toHz: 48000 },
  { fromHz: 48000, toHz: 44100 },
  { fromHz: 44100, toHz: 32000 },
  { fromHz: 44100, toHz: 16000 },
  { fromHz: 48000, toHz: 16000 },
];

/** The deterministic pairs that every resampling case embeds. */
export const RESAMPLE_PAIRS = { seed: 0x7e5a, count: 5 };

/** The fixed-duration excerpt grid that the crop benchmark measures. */
export const EXCERPT_GRID = {
  durationsSeconds: [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0],
  startsSeconds: [0, 0.35, 0.73, 1.5, 2.2],
};

/** The clipping severities, as fractions of the marked signal's own peak. */
export const CLIP_FRACTIONS = [0.9, 0.7, 0.5, 0.3];

/** The additive-noise targets in dB SNR, with the fixed seed. */
export const NOISE = { snrDb: [100, 80, 40, 30, 20, 10], seed: 777 };

export const QUANTIZE_BITS = [12, 8, 6];
