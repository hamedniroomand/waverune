/**
 * An adapter over external sample-rate converters.
 *
 * waverune does not ship a resampler. The resampling evaluation writes a WAV
 * file, hands it to an external tool with anti-alias filtering, and reads the
 * result back. The adapter knows two tools:
 *
 * - `sox`, any platform: `sox in.wav -r <rate> -b 32 -e floating-point out.wav rate -v`
 * - `afconvert`, macOS Core Audio: `afconvert -f WAVE -d LEF32@<rate> -r 127 --src-complexity bats in.wav out.wav`
 *
 * The adapter uses `sox` when both tools exist. When neither exists, the
 * caller must report the evaluation as incomplete. This module never skips
 * silently.
 */
import { decodeWav, encodeWav } from '~/audio/wav';
import type { AudioBuffer } from '~/types';

export interface ResamplerInfo {
  tool: 'sox' | 'afconvert';
  version: string;
  /** The command line with `<in>`, `<out>` and `<rate>` placeholders, for the result file. */
  settings: string;
}

function which(name: string): string | null {
  const proc = Bun.spawnSync(['which', name]);
  const path = proc.stdout.toString().trim();
  return proc.exitCode === 0 && path.length > 0 ? path : null;
}

/** Find an external resampler, or return `null` when none is installed. */
export function findResampler(): ResamplerInfo | null {
  if (which('sox') !== null) {
    const out = Bun.spawnSync(['sox', '--version']);
    const version =
      (out.stdout.toString() + out.stderr.toString()).trim().split('\n')[0] ?? 'unknown';
    return {
      tool: 'sox',
      version,
      settings: 'sox <in> -r <rate> -b 32 -e floating-point <out> rate -v',
    };
  }
  if (which('afconvert') !== null) {
    const out = Bun.spawnSync(['afconvert', '-h']);
    const text = out.stdout.toString() + out.stderr.toString();
    const match = /Version:\s*([^\n]+)/u.exec(text);
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
 * The input and the output are 32-bit float WAV, so the conversion adds no
 * quantisation. The returned buffer carries the sample rate of the output
 * file, and the function throws when that rate differs from `toHz`.
 *
 * @param workDir - a directory for the temporary files.
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
