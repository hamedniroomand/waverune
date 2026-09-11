import { EXIT_NOT_DETECTED } from '~/cli/exit-codes';
import type { CliOptions } from '~/cli/options';
import { detectionToJson } from '~/json';
import { readWavFile } from '~/platform/fs';
import { PerceptualWatermarker } from '~/watermarkers/perceptual';
import { DEFAULT_KEY } from '~/watermarkers/perceptual/config';

/** Run the `detect` command: read a watermark from a file with a key. */
export async function runDetect(positionals: string[], options: CliOptions): Promise<number> {
  const input = positionals[1];
  if (!input) throw new Error('The detect command needs an input WAV file.');

  const audio = await readWavFile(input);
  const key = options.key ?? DEFAULT_KEY;
  const result = new PerceptualWatermarker().getWatermark(audio, { key });

  if (options.json) {
    console.log(JSON.stringify(detectionToJson(result)));
  } else if (result.detected) {
    console.log(`Watermark found. Id: ${result.payload}`);
    console.log(`Correlation score: ${result.correlationScore.toFixed(3)}`);
  } else {
    console.log('No watermark found.');
  }

  return result.detected ? 0 : EXIT_NOT_DETECTED;
}
