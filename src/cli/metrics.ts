import type { CliOptions } from '~/cli/options';
import { calculateAudioMetrics, type AudioMetrics } from '~/metrics';
import { readWavFile } from '~/platform/fs';
import type { AudioBuffer } from '~/types';

/**
 * Compute the audio metrics of every channel and average them.
 *
 * @throws an `Error` when the two buffers differ in channel count.
 */
export function combinedMetrics(original: AudioBuffer, processed: AudioBuffer): AudioMetrics {
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

export function printMetrics(metrics: AudioMetrics): void {
  console.log(`SNR: ${metrics.snr.toFixed(2)} dB`);
  console.log(`MSE: ${metrics.mse.toExponential(4)}`);
  console.log(`PSNR: ${metrics.psnr.toFixed(2)} dB`);
}

/** Run the `metrics` command: compare an original file against a processed file. */
export async function runMetrics(positionals: string[], options: CliOptions): Promise<number> {
  const originalPath = positionals[1];
  const processedPath = positionals[2];
  if (!originalPath || !processedPath) {
    throw new Error('The metrics command needs an original file and a processed file.');
  }

  const original = await readWavFile(originalPath);
  const processed = await readWavFile(processedPath);
  const metrics = combinedMetrics(original, processed);

  if (options.json) {
    console.log(JSON.stringify(metrics));
  } else {
    printMetrics(metrics);
  }
  return 0;
}
