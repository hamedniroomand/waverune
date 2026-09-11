# Contributing to WaveRune

Thanks for taking the time to improve WaveRune. Documentation fixes, clear bug
reports, and reproducible audio tests are all useful contributions.

For larger changes, open an issue first to discuss the problem and proposed
approach. Small fixes can go straight to a pull request.

## Local setup

Install Bun 1.4 or later and Node.js 22 or later, then run:

```bash
git clone https://github.com/hamedniroomand/waverune.git
cd waverune
bun install
bun run demo
```

The demo runs at `http://localhost:3000`. The package itself runs on Node.js
and Bun; Bun is the development toolchain.

## Project layout

| Path                         | Purpose                                                |
| ---------------------------- | ------------------------------------------------------ |
| `src/api.ts`, `src/index.ts` | Public library entry points                            |
| `src/dsp/`                   | FFT, STFT, and window functions                        |
| `src/codec/`                 | Payload framing, keyed sequences, and masking          |
| `src/watermarkers/`          | Embedding and detection                                |
| `src/audio/wav/`             | WAV decoding and encoding                              |
| `src/platform/`              | Filesystem and cryptographic adapters                  |
| `src/cli/`                   | CLI commands and output                                |
| `demo/`                      | Browser demo; excluded from the npm package            |
| `tests/`                     | Unit, integration, runtime, and interoperability tests |
| `bench/`                     | Reproducible benchmark runners and results             |

## Before opening a pull request

Keep the change focused and explain the problem it solves. Include the steps
you used to verify it, and update examples when public behavior changes.

```bash
bun run typecheck
bun run lint
bun run format:check
bun test
```

For package or runtime changes, also run:

```bash
bun run build
bun run test:node
bun run test:interop
bun run check:pack
```

For demo changes, run `bun run demo:build` and `bun test tests/demo.test.ts`.
Check the page at desktop and mobile widths, including keyboard navigation,
file selection, error messages, embedding, and detection.

Resampling tests need `sox` or macOS `afconvert`. On a machine without either,
use `WAVERUNE_ALLOW_SKIP_RESAMPLE=1 bun test` and mention the skipped check
in your pull request.

## Reporting a watermark failure

Include enough information for someone else to reproduce the result:

- WaveRune version and runtime version.
- Operating system, audio duration, sample rate, bit depth, and channel count.
- The command or a small code example, including configuration changes.
- Expected behavior and actual output; CLI `--json` output is useful.
- Any edits made to the audio between embedding and detection.

Use a disposable key when sharing an example. Only attach audio you have
permission to share. If the recording cannot be shared, describe its source
and characteristics, or provide a small synthetic reproduction.

## Changes to the watermark algorithm

Keep robustness claims tied to declared inputs and measured results. An audio
transformation test should verify that the transformation actually changed
the signal. Distinguish exact recovery, rejection, and an accepted wrong payload.

Run the relevant benchmarks in `bench/` and document any regressions alongside
improvements. Changes to payload framing or keyed sequences may break existing
watermarks; describe compatibility consequences explicitly.

See the [reliability report](docs/reliability-report.md) for the benchmark
methodology and the [algorithm guide](docs/how-it-works.md) for implementation context.

## License

Contributions are covered by the project's [MIT license](LICENSE).
