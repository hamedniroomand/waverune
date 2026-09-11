import { WatermarkingError } from './types';

export interface AudioMetrics {
  snr: number;
  mse: number;
  psnr: number;
}

export function calculateAudioMetrics(
  original: Float32Array,
  processed: Float32Array,
): AudioMetrics {
  if (original.length !== processed.length) {
    throw new WatermarkingError('Original and processed audio must have equal length');
  }

  const n = original.length;

  if (n === 0) {
    throw new WatermarkingError('Cannot calculate audio metrics for empty input');
  }

  let sumSquaredDiff = 0;
  let sumOriginalSquared = 0;
  let maxAbsValue = 0;

  for (let i = 0; i < n; i++) {
    const originalSample = original[i];
    const processedSample = processed[i];
    const diff = originalSample - processedSample;

    sumSquaredDiff += diff * diff;
    sumOriginalSquared += originalSample * originalSample;

    const absOriginal = Math.abs(originalSample);
    const absProcessed = Math.abs(processedSample);
    maxAbsValue = Math.max(maxAbsValue, absOriginal, absProcessed);
  }

  const mse = sumSquaredDiff / n;

  let snr: number;
  let psnr: number;

  if (mse === 0) {
    snr = Infinity;
    psnr = Infinity;
  } else {
    const meanOriginalSquared = sumOriginalSquared / n;
    snr = 10 * Math.log10(meanOriginalSquared / mse);
    psnr = 20 * Math.log10(maxAbsValue / Math.sqrt(mse));
  }

  return { snr, mse, psnr };
}
