/**
 * An adapter over independent, external sample-rate converters.
 *
 * wavemark does not ship a resampler. The resampling evaluation writes a
 * WAV file, hands it to a trusted external tool with anti-alias filtering,
 * and reads the result back. Two tools are recognised:
 *
 * - `sox` (any platform): `sox in.wav -r <rate> -b 32 -e floating-point out.wav rate -v`
 * - `afconvert` (macOS, Core Audio): `afconvert -f WAVE -d LEF32@<rate> -r 127 --src-complexity bats in.wav out.wav`
 *
 * `sox` takes precedence when both exist. When neither exists the caller
 * must report the evaluation as incomplete; nothing here skips silently.
 */
import { decodeWav, encodeWav } from '~/audio/wav';
import type { AudioBuffer } from '~/types';

export interface ResamplerInfo {
  tool: 'sox' | 'afconvert';
  version: string;
  /** The arguments, with `<in>`, `<out>` and `<rate>` placeholders, for the record. */
  settings: string;
}

function which(name: string): string | null {
  const proc = Bun.spawnSync(['which', name]);
  const path = proc.stdout.toString().trim();
  return proc.exitCode === 0 && path.length > 0 ? path : null;
}

/** Find an external resampler, or return `null` when none is installed. */
export function findResampler(): ResamplerInfo | null {
  if (which('sox')) {
    const out = Bun.spawnSync(['sox', '--version']);
    const version =
      (out.stdout.toString() + out.stderr.toString()).trim().split('\n')[0] ?? 'unknown';
    return {
      tool: 'sox',
      version,
      settings: 'sox <in> -r <rate> -b 32 -e floating-point <out> rate -v',
    };
  }
  if (which('afconvert')) {
    const out = Bun.spawnSync(['afconvert', '-h']);
    const text = out.stdout.toString() + out.stderr.toString();
    const match = /Version:\s*([^\n]+)/.exec(text);
    return {
      tool: 'afconvert',
      version: `afconvert ${match ? match[1].trim() : 'unknown'} (macOS Core Audio)`,
      settings: 'afconvert -f WAVE -d LEF32@<rate> -r 127 --src-complexity bats <in> <out>',
    };
  }
  return null;
}

/**
 * Resample an audio buffer through the external tool.
 *
 * The input is written as 32-bit float WAV so that no quantisation is added
 * on the way in, and the output is requested as 32-bit float for the same
 * reason. The returned buffer carries the target sample rate as reported by
 * the output file, not the requested rate.
 *
 * @param audio - the audio to convert.
 * @param toHz - the target sample rate.
 * @param info - the resampler to use, from `findResampler`.
 * @param workDir - a directory for the temporary files.
 * @returns the converted audio.
 */
export async function resampleExternal(
  audio: AudioBuffer,
  toHz: number,
  info: ResamplerInfo,
  workDir: string,
): Promise<AudioBuffer> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const input = `${workDir}resample-in-${stamp}.wav`;
  const output = `${workDir}resample-out-${stamp}.wav`;
  await Bun.write(input, encodeWav(audio, { bitDepth: 32, float: true }));

  const argv =
    info.tool === 'sox'
      ? ['sox', input, '-r', String(toHz), '-b', '32', '-e', 'floating-point', output, 'rate', '-v']
      : [
          'afconvert',
          '-f',
          'WAVE',
          '-d',
          `LEF32@${toHz}`,
          '-r',
          '127',
          '--src-complexity',
          'bats',
          input,
          output,
        ];
  const proc = Bun.spawnSync(argv);
  if (proc.exitCode !== 0) {
    throw new Error(`${info.tool} failed (${proc.exitCode}): ${proc.stderr.toString()}`);
  }
  const result = decodeWav(await Bun.file(output).bytes());
  await Bun.file(input).delete();
  await Bun.file(output).delete();
  if (result.sampleRate !== toHz) {
    throw new Error(`${info.tool} produced ${result.sampleRate} Hz, expected ${toHz} Hz`);
  }
  return result;
}
