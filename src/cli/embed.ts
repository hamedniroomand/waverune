import { webcrypto } from 'node:crypto';

import { EXIT_VERIFY_FAILED } from '~/cli/exit-codes';
import { combinedMetrics, printMetrics } from '~/cli/metrics';
import type { CliOptions } from '~/cli/options';
import { verifyRecovery } from '~/cli/verify';
import { detectionToJson } from '~/json';
import { readWavFile, writeWavFile } from '~/platform/fs';
import { PerceptualWatermarker } from '~/watermarkers/perceptual';
import { DEFAULT_KEY } from '~/watermarkers/perceptual/config';

/** Parse an `--id` value. `BigInt` accepts decimal and `0x`, `0o`, `0b` prefixes. */
function parseId(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`The --id value "${raw}" is not a valid number.`);
  }
}

function randomId(): bigint {
  const buffer = new Uint32Array(1);
  webcrypto.getRandomValues(buffer);
  return BigInt(buffer[0]);
}

function parseAlpha(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const alpha = Number(raw);
  if (!Number.isFinite(alpha) || alpha < 0) {
    throw new Error(`The --alpha value "${raw}" must be a finite number of 0 or more.`);
  }
  return alpha;
}

/**
 * Run the `embed` command.
 *
 * The command embeds, writes the file, reads it back, detects, and compares
 * the recovered id against the requested id. The quality metrics compare the
 * input against the decoded saved output, so they include the 16-bit
 * quantisation of the file. On a failed verification the file stays on disk
 * and the command exits with `EXIT_VERIFY_FAILED`.
 */
export async function runEmbed(positionals: string[], options: CliOptions): Promise<number> {
  const input = positionals[1];
  if (!input) throw new Error('The embed command needs an input WAV file.');
  const output = options.output;
  if (!output) throw new Error('The embed command needs an output path. Use -o or --output.');

  const audio = await readWavFile(input);
  const key = options.key ?? DEFAULT_KEY;
  const generated = options.id === undefined;
  const id = generated ? randomId() : parseId(options.id!);
  const alpha = parseAlpha(options.alpha);

  const watermarker = new PerceptualWatermarker();
  const marked = watermarker.applyWatermark(audio, { key, payload: id, alpha });
  await writeWavFile(output, marked);

  const saved = await readWavFile(output);
  const detection = watermarker.getWatermark(saved, { key });
  const verification = verifyRecovery(id, detection);
  const metrics = combinedMetrics(audio, saved);
  const exitCode = verification.verified ? 0 : EXIT_VERIFY_FAILED;

  if (options.json) {
    console.log(
      JSON.stringify({
        command: 'embed',
        requestedId: id.toString(),
        generatedId: generated,
        output,
        verified: verification.verified,
        failure: verification.failure,
        recoveredId: verification.recoveredId !== null ? verification.recoveredId.toString() : null,
        detection: detectionToJson(detection),
        metrics,
      }),
    );
    return exitCode;
  }

  if (generated) console.log(`Generated id: ${id}`);
  console.log(`Wrote the watermark to "${output}".`);
  console.log(`Requested id: ${id}`);
  console.log(
    `Recovered id: ${verification.recoveredId !== null ? verification.recoveredId : 'none'}`,
  );
  console.log(`Correlation score: ${detection.correlationScore.toFixed(3)}`);
  printMetrics(metrics);
  if (!verification.verified) {
    console.error(
      `Verification failed (${verification.failure}). The file "${output}" was kept for inspection.`,
    );
  }
  return exitCode;
}
