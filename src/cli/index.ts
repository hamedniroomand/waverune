/**
 * The command-line interface. It wraps the library with three commands:
 * `embed`, `detect` and `metrics`. Errors go to stderr. The `--json` flag
 * prints one JSON object and nothing else, so a script can pipe the output.
 *
 * This module has no side effects on import, so tests can call `main`.
 * `bin.ts` is the executable wrapper.
 */
import { parseArgs } from 'node:util';

import { runDetect } from '~/cli/detect';
import { runEmbed } from '~/cli/embed';
import { EXIT_ERROR } from '~/cli/exit-codes';
import { runMetrics } from '~/cli/metrics';
import { VERSION } from '~/version';

export { EXIT_ERROR, EXIT_NOT_DETECTED, EXIT_VERIFY_FAILED } from '~/cli/exit-codes';
export { verifyRecovery, type EmbedVerification, type VerifyFailure } from '~/cli/verify';

function printUsage(): void {
  console.error('Usage:');
  console.error(
    '  waverune embed <input.wav> -o <output.wav> [--id <hex|dec>] [--key <key>] [--alpha <n>] [--json]',
  );
  console.error('  waverune detect <input.wav> [--key <key>] [--json]');
  console.error('  waverune metrics <original.wav> <processed.wav> [--json]');
  console.error('  waverune --version');
}

/** Parse the arguments, run the selected command, and return the exit code. */
export async function main(argv: string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        output: { type: 'string', short: 'o' },
        id: { type: 'string' },
        key: { type: 'string' },
        alpha: { type: 'string' },
        json: { type: 'boolean' },
        version: { type: 'boolean' },
      },
    });

    if (values.version === true) {
      console.log(VERSION);
      return 0;
    }

    switch (positionals[0]) {
      case 'embed':
        return await runEmbed(positionals, values);
      case 'detect':
        return await runDetect(positionals, values);
      case 'metrics':
        return await runMetrics(positionals, values);
      default:
        printUsage();
        return EXIT_ERROR;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return EXIT_ERROR;
  }
}
