/**
 * The real-audio corpus runner.
 *
 * The runner takes a directory of WAV files that the user supplies. It does
 * not ship any audio. For every file it records a SHA-256 hash, the format,
 * the duration and any metadata from `manifest.json` in the same directory,
 * then measures:
 *
 * - clean recovery for three deterministic pairs, and a 16-bit WAV round trip
 * - gain 0.5 and 2.0
 * - the declared prefix-removal cases that leave at least four seconds
 * - clipping at 0.9, 0.7 and 0.5 of the peak, with changed-sample counts
 * - additive noise at 40, 30 and 20 dB achieved SNR
 * - 8-bit requantization
 * - the excerpt duration grid at the declared start positions
 * - SNR and PSNR of the marked file against the original
 *
 * Files shorter than six seconds skip the six-second cases and say so.
 * Stereo files are analysed as stored; the detector reads every channel.
 *
 * `manifest.json` is optional: `{ "<file name>": { "id": ..., "license": ...,
 * "description": ..., "class": "speech" | "music" | "quiet" | "transient" | ... } }`.
 *
 * Usage: bun bench/corpus.ts <directory> [--steps N] [--tag name]
 *
 * With no directory, or an empty one, the runner exits with code 2 and
 * reports real-audio validation as outstanding.
 */
import { readdir } from 'node:fs/promises';

import { decodeWav, encodeWav } from '~/audio/wav';
import { calculateAudioMetrics } from '~/metrics';
import type { AudioBuffer } from '~/types';

import { trial, type Trial } from '../tests/helpers/acceptance';
import {
  addNoise,
  clipAtPeakFraction,
  excerpt,
  removePrefix,
  requantize,
  scale,
} from '../tests/helpers/attacks';
import { keyPayloadPairs } from '../tests/helpers/lcg';
import {
  EXCERPT_GRID,
  GAINS,
  PREFIX_CASES,
  PREFIX_MIN_REMAINING_SECONDS,
} from '../tests/helpers/matrix';
import {
  benchArgs,
  effectiveConfig,
  elapsed,
  environment,
  fmt,
  makeWatermarker,
  markdownTable,
  writeResult,
} from './lib';

const opts = benchArgs();
const dir = opts.positionals[0];
const start = performance.now();

async function outstanding(reason: string): Promise<never> {
  const path = await writeResult('corpus', opts.tag, {
    environment: await environment(),
    status: 'outstanding',
    reason,
  });
  console.error(`Real-audio validation OUTSTANDING: ${reason}`);
  console.error(`Wrote ${path}.`);
  process.exit(2);
}

const dirPath =
  dir === undefined
    ? await outstanding('no corpus directory given')
    : dir.endsWith('/')
      ? dir
      : `${dir}/`;
let names: string[] = [];
try {
  names = (await readdir(dirPath)).filter((n) => n.toLowerCase().endsWith('.wav')).toSorted();
} catch {
  await outstanding(`cannot read directory ${dirPath}`);
}
if (names.length === 0) await outstanding(`no WAV files in ${dirPath}`);

interface FileMeta {
  id?: string;
  license?: string;
  description?: string;
  class?: string;
}
type Meta = Record<string, FileMeta>;

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** Read the optional manifest without trusting its shape. */
function parseMeta(parsed: unknown): Meta {
  const meta: Meta = {};
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return meta;
  for (const [file, entry] of Object.entries(parsed)) {
    if (entry === null || typeof entry !== 'object') continue;
    const record: Record<string, unknown> = { ...entry };
    meta[file] = {
      id: readString(record, 'id'),
      license: readString(record, 'license'),
      description: readString(record, 'description'),
      class: readString(record, 'class'),
    };
  }
  return meta;
}

let meta: Meta = {};
try {
  meta = parseMeta(await Bun.file(`${dirPath}manifest.json`).json());
} catch {
  meta = {};
}

const watermarker = makeWatermarker(opts.steps);
const pairs = keyPayloadPairs(0xc0de, 3);

interface FileReport {
  file: string;
  sha256: string;
  meta: Meta[string] | null;
  sampleRate: number;
  channels: number;
  seconds: number;
  quality: { snrDb: number; psnrDb: number }[];
  trials: Trial[];
  notes: string[];
}

function scaleAll(audio: AudioBuffer, gain: number): AudioBuffer {
  return {
    sampleRate: audio.sampleRate,
    channels: audio.channels.map((c) => scale(c, gain).signal),
  };
}
function mapAll(audio: AudioBuffer, fn: (c: Float32Array) => Float32Array): AudioBuffer {
  return { sampleRate: audio.sampleRate, channels: audio.channels.map(fn) };
}

const reports: FileReport[] = [];
const failedFiles: { file: string; error: string }[] = [];
for (const name of names) {
  const bytes = await Bun.file(`${dirPath}${name}`).bytes();
  const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  let audio: AudioBuffer;
  try {
    audio = decodeWav(bytes);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    failedFiles.push({ file: name, error });
    console.error(`cannot decode ${name}: ${error}`);
    continue;
  }
  const sr = audio.sampleRate;
  const seconds = audio.channels[0].length / sr;
  const report: FileReport = {
    file: name,
    sha256,
    meta: meta[name] ?? null,
    sampleRate: sr,
    channels: audio.channels.length,
    seconds,
    quality: [],
    trials: [],
    notes: [],
  };
  const hop = Math.round(sr * 0.01);

  for (const pair of pairs) {
    const marked = watermarker.applyWatermark(audio, pair);
    const m = calculateAudioMetrics(audio.channels[0], marked.channels[0]);
    report.quality.push({ snrDb: m.snr, psnrDb: m.psnr });
    report.trials.push(
      trial(
        'clean',
        name,
        pair.key,
        pair.payload,
        {},
        watermarker.getWatermark(marked, { key: pair.key }),
      ),
    );
    report.trials.push(
      trial(
        'wav-round-trip',
        name,
        pair.key,
        pair.payload,
        { bitDepth: 16 },
        watermarker.getWatermark(decodeWav(encodeWav(marked)), { key: pair.key }),
      ),
    );
  }

  const pair = pairs[0];
  const marked = watermarker.applyWatermark(audio, pair);
  const detect = (a: AudioBuffer) => watermarker.getWatermark(a, { key: pair.key });
  for (const gain of GAINS)
    report.trials.push(
      trial('gain', name, pair.key, pair.payload, { gain }, detect(scaleAll(marked, gain))),
    );

  if (seconds >= 6) {
    for (const c of PREFIX_CASES) {
      const samples = Math.round((c.samples / 441) * hop);
      const remaining = (marked.channels[0].length - samples) / sr;
      if (remaining < PREFIX_MIN_REMAINING_SECONDS) continue;
      report.trials.push(
        trial(
          'prefix-removal',
          name,
          pair.key,
          pair.payload,
          {
            samples,
            label: c.label,
            group: c.group,
            remainingSeconds: Number(remaining.toFixed(3)),
          },
          detect(mapAll(marked, (ch) => removePrefix(ch, samples).signal)),
        ),
      );
    }
  } else {
    report.notes.push(`shorter than 6 s: prefix-removal cases skipped`);
  }

  for (const fraction of [0.9, 0.7, 0.5]) {
    const clipped = marked.channels.map((ch) => clipAtPeakFraction(ch, fraction));
    report.trials.push(
      trial(
        'clip',
        name,
        pair.key,
        pair.payload,
        {
          peakFraction: fraction,
          changedSamples: clipped[0].changedSamples,
          changedFraction: Number(clipped[0].changedFraction.toFixed(5)),
        },
        detect({ sampleRate: sr, channels: clipped.map((c) => c.signal) }),
      ),
    );
  }
  for (const snr of [40, 30, 20]) {
    const noisy = marked.channels.map((ch) => addNoise(ch, snr, 777));
    report.trials.push(
      trial(
        'noise',
        name,
        pair.key,
        pair.payload,
        { targetSnrDb: snr, achievedSnrDb: Number(noisy[0].severity.achievedSnrDb.toFixed(2)) },
        detect({ sampleRate: sr, channels: noisy.map((c) => c.signal) }),
      ),
    );
  }
  report.trials.push(
    trial(
      'requantize',
      name,
      pair.key,
      pair.payload,
      { bits: 8 },
      detect(mapAll(marked, (ch) => requantize(ch, 8).signal)),
    ),
  );

  for (const startSeconds of EXCERPT_GRID.startsSeconds) {
    for (const duration of EXCERPT_GRID.durationsSeconds) {
      const first = Math.round(startSeconds * sr);
      const length = Math.round(duration * sr);
      if (first + length > marked.channels[0].length) continue;
      report.trials.push(
        trial(
          'excerpt',
          name,
          pair.key,
          pair.payload,
          { startSeconds, durationSeconds: duration },
          detect(mapAll(marked, (ch) => excerpt(ch, first, length).signal)),
        ),
      );
    }
  }
  reports.push(report);
  console.log(
    `${name}: ${report.trials.filter((t) => t.exact).length}/${report.trials.length} exact, ${report.trials.filter((t) => t.detected && !t.exact).length} wrong accepted (${elapsed(start)})`,
  );
}

// The status says how much of the directory was measured. A directory with
// no decodable file is outstanding, not measured, and exits non-zero.
const status =
  reports.length === 0 ? 'outstanding' : failedFiles.length > 0 ? 'partial' : 'measured';
const path = await writeResult('corpus', opts.tag, {
  environment: await environment(),
  config: effectiveConfig(opts.steps),
  status,
  directory: dirPath,
  wavFiles: names.length,
  measuredFiles: reports.length,
  failedFiles,
  pairs,
  files: reports,
});
if (reports.length === 0) {
  console.error(
    `Real-audio validation OUTSTANDING: none of the ${names.length} WAV files decoded.`,
  );
  console.error(`Wrote ${path}.`);
  process.exit(2);
}

console.log(
  markdownTable(
    [
      'file',
      'class',
      'sha256 (12)',
      'rate',
      'ch',
      'seconds',
      'clean',
      'wav',
      'gain',
      'prefix',
      'clip',
      'noise',
      'quant',
      'excerpt shortest',
      'wrong',
      'SNR dB',
    ],
    reports.map((r) => {
      const c = (name: string) => {
        const rows = r.trials.filter((t) => t.case === name);
        return rows.length ? `${rows.filter((t) => t.exact).length}/${rows.length}` : 'n/a';
      };
      const ex = r.trials
        .filter((t) => t.case === 'excerpt' && t.exact)
        .map((t) => Number(t.params.durationSeconds));
      return [
        r.file,
        r.meta?.class ?? '',
        r.sha256.slice(0, 12),
        r.sampleRate,
        r.channels,
        fmt(r.seconds, 1),
        c('clean'),
        c('wav-round-trip'),
        c('gain'),
        c('prefix-removal'),
        c('clip'),
        c('noise'),
        c('requantize'),
        ex.length ? `${Math.min(...ex)} s` : 'none',
        r.trials.filter((t) => t.detected && !t.exact).length,
        fmt(Math.min(...r.quality.map((q) => q.snrDb)), 1),
      ];
    }),
  ),
);
if (failedFiles.length > 0) {
  console.log(
    `\nPARTIAL coverage: ${failedFiles.length} of ${names.length} files did not decode: ${failedFiles.map((f) => f.file).join(', ')}`,
  );
}
console.log(`\nstatus ${status}; wrote ${path} in ${elapsed(start)}`);
