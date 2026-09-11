#!/usr/bin/env bun
/**
 * This module is the command-line interface for wavemark.
 *
 * The CLI wraps the library API with three commands: `embed`, `detect` and
 * `metrics`. Each command reads a WAV file, calls the library, and prints a
 * result. Errors go to stderr. The `--json` flag prints one JSON object and
 * nothing else, so a script can pipe the output.
 */
import { parseArgs } from 'node:util';

import { decodeWav, encodeWav } from '~/audio/wav';
import { calculateAudioMetrics, type AudioMetrics } from '~/metrics';
import type { AudioBuffer, DetectionResult } from '~/types';
import { PerceptualWatermarker } from '~/watermarkers/perceptual';

/** The key that applies when the caller gives no `--key` value. */
const DEFAULT_KEY = 'wavemark';

/** The exit code for a command that fails to run. */
const EXIT_ERROR = 1;

/** The exit code from `detect` when the audio holds no watermark. */
const EXIT_NOT_DETECTED = 2;

/** Print the command syntax to stderr. */
function printUsage(): void {
  console.error('Usage:');
  console.error(
    '  wavemark embed <input.wav> -o <output.wav> [--id <hex|dec>] [--key <key>] [--alpha <n>]',
  );
  console.error('  wavemark detect <input.wav> [--key <key>] [--json]');
  console.error('  wavemark metrics <original.wav> <processed.wav> [--json]');
}

/**
 * Read one WAV file from disk.
 *
 * @param path - the file path to read.
 * @returns the decoded audio.
 * @throws an error when the file does not exist or is not a valid WAV file.
 */
async function readAudio(path: string): Promise<AudioBuffer> {
  let bytes: Uint8Array;
  try {
    bytes = await Bun.file(path).bytes();
  } catch {
    throw new Error(`Cannot read the file "${path}".`);
  }
  return decodeWav(bytes);
}

/**
 * Parse a payload id from a command-line string.
 *
 * The function reads the value as hexadecimal when it starts with `0x` or
 * `0X`. It reads every other value as decimal.
 *
 * @param raw - the raw `--id` value.
 * @returns the parsed id.
 */
function parseId(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`The --id value "${raw}" is not a valid number.`);
  }
}

/** Generate a random 32-bit id with the platform random source. */
function randomId(): bigint {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return BigInt(buffer[0]);
}

/**
 * Compute audio metrics over every channel and average the result.
 *
 * @param original - the audio before the change.
 * @param processed - the audio after the change.
 * @returns the mean SNR, MSE and PSNR over all channels.
 * @throws an error when the two files do not hold the same number of channels.
 */
function combinedMetrics(original: AudioBuffer, processed: AudioBuffer): AudioMetrics {
  if (original.channels.length !== processed.channels.length) {
    throw new Error('The two files do not hold the same number of channels.');
  }
  const count = original.channels.length;
  let snr = 0;
  let mse = 0;
  let psnr = 0;
  for (let c = 0; c < count; c++) {
    const m = calculateAudioMetrics(original.channels[c], processed.channels[c]);
    snr += m.snr;
    mse += m.mse;
    psnr += m.psnr;
  }
  return { snr: snr / count, mse: mse / count, psnr: psnr / count };
}

/** Convert a detection result to a JSON-safe object. Bigint needs a string form. */
function detectionToJson(result: DetectionResult): Record<string, unknown> {
  return {
    detected: result.detected,
    id: result.payload !== null ? result.payload.toString() : null,
    confidence: result.confidence,
    bitErrorEstimate: result.bitErrorEstimate,
    band: result.band,
  };
}

interface CliOptions {
  output?: string;
  id?: string;
  key?: string;
  alpha?: string;
  json?: boolean;
}

/** Run the `embed` command: watermark a file, then verify the result. */
async function runEmbed(positionals: string[], options: CliOptions): Promise<void> {
  const input = positionals[1];
  if (!input) throw new Error('The embed command needs an input WAV file.');
  const output = options.output;
  if (!output) throw new Error('The embed command needs an output path. Use -o or --output.');

  const audio = await readAudio(input);
  const key = options.key ?? DEFAULT_KEY;
  const generated = options.id === undefined;
  const id = generated ? randomId() : parseId(options.id!);

  let alpha: number | undefined;
  if (options.alpha !== undefined) {
    alpha = Number(options.alpha);
    if (Number.isNaN(alpha))
      throw new Error(`The --alpha value "${options.alpha}" is not a valid number.`);
  }

  const watermarker = new PerceptualWatermarker();
  const marked = watermarker.applyWatermark(audio, { key, payload: id, alpha });
  await Bun.write(output, encodeWav(marked));

  const verify = watermarker.getWatermark(marked, { key });
  const metrics = combinedMetrics(audio, marked);

  if (options.json) {
    console.log(
      JSON.stringify({
        id: id.toString(),
        generatedId: generated,
        output,
        detected: verify.detected,
        recoveredId: verify.payload !== null ? verify.payload.toString() : null,
        confidence: verify.confidence,
        bitErrorEstimate: verify.bitErrorEstimate,
        band: verify.band,
        snr: metrics.snr,
        mse: metrics.mse,
        psnr: metrics.psnr,
      }),
    );
    return;
  }

  if (generated) console.log(`Generated id: ${id}`);
  console.log(`Wrote the watermark to "${output}".`);
  console.log(`Recovered id: ${verify.payload !== null ? verify.payload : 'none'}`);
  console.log(`SNR: ${metrics.snr.toFixed(2)} dB`);
  console.log(`MSE: ${metrics.mse.toExponential(4)}`);
  console.log(`PSNR: ${metrics.psnr.toFixed(2)} dB`);
}

/** Run the `detect` command: read a watermark from a file with a key. */
async function runDetect(positionals: string[], options: CliOptions): Promise<void> {
  const input = positionals[1];
  if (!input) throw new Error('The detect command needs an input WAV file.');

  const audio = await readAudio(input);
  const key = options.key ?? DEFAULT_KEY;
  const watermarker = new PerceptualWatermarker();
  const result = watermarker.getWatermark(audio, { key });

  if (options.json) {
    console.log(JSON.stringify(detectionToJson(result)));
  } else if (result.detected) {
    console.log(`Watermark found. Id: ${result.payload}`);
    console.log(`Confidence: ${result.confidence.toFixed(3)}`);
  } else {
    console.log('No watermark found.');
  }

  process.exit(result.detected ? 0 : EXIT_NOT_DETECTED);
}

/** Run the `metrics` command: compare an original file against a processed file. */
async function runMetrics(positionals: string[], options: CliOptions): Promise<void> {
  const originalPath = positionals[1];
  const processedPath = positionals[2];
  if (!originalPath || !processedPath) {
    throw new Error('The metrics command needs an original file and a processed file.');
  }

  const original = await readAudio(originalPath);
  const processed = await readAudio(processedPath);
  const metrics = combinedMetrics(original, processed);

  if (options.json) {
    console.log(JSON.stringify(metrics));
    return;
  }
  console.log(`SNR: ${metrics.snr.toFixed(2)} dB`);
  console.log(`MSE: ${metrics.mse.toExponential(4)}`);
  console.log(`PSNR: ${metrics.psnr.toFixed(2)} dB`);
}

/** Parse the argument vector, run the selected command, and set the exit code. */
async function main(): Promise<void> {
  try {
    const { values, positionals } = parseArgs({
      args: Bun.argv.slice(2),
      allowPositionals: true,
      strict: true,
      options: {
        output: { type: 'string', short: 'o' },
        id: { type: 'string' },
        key: { type: 'string' },
        alpha: { type: 'string' },
        json: { type: 'boolean' },
      },
    });
    const options = values;
    const command = positionals[0];

    switch (command) {
      case 'embed':
        await runEmbed(positionals, options);
        return;
      case 'detect':
        await runDetect(positionals, options);
        return;
      case 'metrics':
        await runMetrics(positionals, options);
        return;
      default:
        printUsage();
        process.exit(EXIT_ERROR);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_ERROR);
  }
}

if (import.meta.main) {
  await main();
}
