/** The exit code for a command that fails to run. */
export const EXIT_ERROR = 1;

/** The exit code from `detect` when the audio holds no watermark. */
export const EXIT_NOT_DETECTED = 2;

/**
 * The exit code from `embed` when the written file does not verify.
 *
 * The output file stays on disk for inspection. The exit code, the text
 * output and the JSON output all report the failure.
 */
export const EXIT_VERIFY_FAILED = 3;
