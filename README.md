# wavemark

wavemark embeds a 32-bit payload into a WAV file, hidden below the ear's
masking threshold. wavemark detects the payload later with the key alone; it
does not need the original audio.

wavemark has zero runtime dependencies. It runs on Bun and uses Bun's native
APIs: `Bun.file`, `Bun.write`, `Bun.hash.crc32`, `Bun.CryptoHasher`, and
`Bun.argv` with `parseArgs`.

## Install

This package is not published to a registry yet. Clone the repository and
install it as a local dependency, or run it in place.

```bash
git clone <repository-url>
cd video-watermarker
bun install
```

wavemark needs Bun. It does not run under Node.

## Quick start: library

Run this example from the repository root, after `bun install`. The import
path is relative, because the package is not published yet. Run `bun link`
in the repository, then `bun link wavemark` in your own project, to use the
bare `"wavemark"` form instead.

```ts
import { PerceptualWatermarker } from "./src/index";
import { decodeWav, encodeWav } from "./src/index";

const watermarker = new PerceptualWatermarker();

const audio = decodeWav(await Bun.file("input.wav").bytes());

const marked = watermarker.applyWatermark(audio, {
  key: "secret",
  payload: 0xdeadbeefn,
});
await Bun.write("output.wav", encodeWav(marked));

const result = watermarker.getWatermark(marked, { key: "secret" });
console.log(result.detected, result.payload);
// true 3735928559n
```

See `docs/api.md` for the full API reference.

## Quick start: CLI

Run this example from the repository root, after `bun install`. Run
`bun link` in the repository to use the bare `wavemark` command instead of
`bun run src/cli.ts`.

```bash
bun run src/cli.ts embed input.wav -o output.wav --id 0xDEADBEEF --key secret
bun run src/cli.ts detect output.wav --key secret
bun run src/cli.ts metrics input.wav output.wav
```

Sample run against an input file:

```
$ bun run src/cli.ts embed input.wav -o output.wav --id 0xDEADBEEF --key secret
Wrote the watermark to "output.wav".
Recovered id: 3735928559
SNR: 26.78 dB
MSE: 1.1805e-4
PSNR: 30.25 dB

$ bun run src/cli.ts detect output.wav --key secret
Watermark found. Id: 3735928559
Confidence: 0.190
```

Add `--json` to `detect` or `metrics` for a single JSON line that a script can
parse. `detect` exits with code 0 when it finds a watermark, 2 when it does
not, and 1 on an error.

## Build a standalone binary

```bash
bun run build:binary
```

This command writes a file named `wavemark` in the project root. The file is
a standalone executable. It runs without a Bun installation on the target
machine.

## Development

```bash
bun test --timeout 120000
bun run typecheck
```

The `--timeout` flag is required. The randomized recovery test runs 40
embed-and-detect cycles: a tonal run and a broadband run, each over the same
20 key and payload pairs. It is 40 cycles over 20 distinct pairs, and this
takes about 40 seconds. The default test timeout is too short for it.

The current suite passes: 71 tests, 0 failures, 3710 assertions.

## How it works

wavemark hides a keyed signal inside the magnitude spectrum of the audio,
under a masking threshold, so a listener does not hear it.

1. **Framing.** wavemark analyzes the signal in short overlapping windows. The
   frame length and hop are set in seconds, not samples, so the frame grid
   depends on duration only, not on sample rate.
2. **Band.** wavemark spreads the payload over the 500-5000 Hz band, split
   into 48 frequency slots.
3. **Masking threshold.** wavemark computes a threshold per frame and per slot
   from the local spectral energy. The threshold sets the largest change that
   stays under the ear's masking curve.
4. **Embedding.** A keyed pseudo-random sequence assigns each spectral cell a
   chip value and a bit index. wavemark raises or lowers each cell's magnitude
   by a small step scaled to the threshold. The step encodes one payload bit.
   Only the magnitude changes; the phase stays the original phase.
5. **Detection.** wavemark analyzes the candidate signal the same way. It
   removes the host spectrum with two stages of whitening. It then correlates
   the residual against the same keyed sequence. The detector needs the key
   only. It does not need the original audio; this is called blind detection.
6. **Framing and checksum.** The payload sits inside a block with a fixed sync
   pattern and an 8-bit checksum. The checksum rejects a wrong or damaged
   payload instead of returning a false answer. A failed detection returns
   `detected: false` and a `payload` of `null`. It never returns a wrong
   payload as if it were correct.

An excerpt needs about two blocks, near 3 seconds, to decode reliably.

### Sample-rate limit

The watermark band narrows automatically near the Nyquist frequency, so
detection still works below full bandwidth. Sample-rate independence holds
only above a limit. The sample rate must stay at or above roughly 10.5 kHz,
on both the embed side and the detect side. Below that limit, the band
clamps and the slot grid shifts. `detect` always reports the band it used,
in `result.band`, so this limit is visible, not silent.

## Robustness

wavemark measured every figure below on 6-second synthetic test signals: one
tonal signal built from a few strong harmonics over a near-silent noise floor,
and one broadband signal that carries content across the whole watermark band.
Neither signal is a real recording. The key was `robustness` and the payload
was `0xcafe_1234`. Sync errors are counted out of the 16 known sync bits.

| Attack | Tonal sync errors | Tonal payload recovered | Broadband sync errors | Broadband payload recovered |
|---|---|---|---|---|
| No attack | 0 of 16 | yes | 0 of 16 | yes |
| Amplitude scaling x0.5 | 0 of 16 | yes | 0 of 16 | yes |
| Amplitude scaling x2.0 | 0 of 16 | yes | 0 of 16 | yes |
| Hard clipping at +/-0.5 | 0 of 16 | yes | 0 of 16 | yes |
| 0.5 s of leading silence | 0 of 16 | yes | 0 of 16 | yes |
| Truncation to 2 s | 1 of 16 | **no** | 0 of 16 | yes |
| 8-bit requantization | 0 of 16 | **no** | 0 of 16 | yes |
| Additive noise at 30 dB | 1 of 16 | **no** | 0 of 16 | yes |
| Additive noise at 20 dB | 2 of 16 | **no** | 0 of 16 | yes |

Broadband material survives every attack in this suite. Tonal material loses
the payload under truncation to 2 s, 8-bit requantization, and additive noise.
The cause: in tonal material, most of the watermark band sits at the
recording's noise floor. Those slots get a masking threshold set by the noise
floor, so they carry almost no watermark energy, and a moderate attack removes
it.

A failed detection always returns `detected: false` and a `payload` of
`null`. It never reports a wrong payload as correct.

The 16-bit sync pattern and the 8-bit checksum make a false accept rare. The
chance is roughly 1 in 100,000, after the alignment search over about 150
offsets. Measurement found 0 false accepts across 360 trials with a wrong
key.

The truncation row above uses a 2-second excerpt. This is shorter than the
~3-second, two-block guidance in "How it works." Broadband material still
recovers the payload from this shorter excerpt in the suite. Tonal material
needs the full guidance length. Treat ~3 seconds as the reliable minimum for
any material. Treat a shorter excerpt as workable only for broadband-like
content.

## Relation to Perth

wavemark takes its central idea from
[resemble-ai/Perth](https://github.com/resemble-ai/Perth) (MIT license): hide
watermark energy below the auditory masking threshold, and spread it widely so
it survives common processing.

wavemark is **not** a port of Perth and is **not** bit-compatible with it.
Perth embeds and detects a watermark with a trained neural network. wavemark
uses classical digital signal processing only: a keyed pseudo-random sequence,
a computed masking threshold, and spectral correlation. Perth's detector
returns a single presence-confidence value, with no payload. wavemark's
detector returns a 32-bit payload, along with a confidence value and a bit
error estimate.

## Non-goals

- No neural network and no model weights.
- No video processing.
- No MP3 or AAC. wavemark reads and writes WAV files only.

## License

MIT. See `LICENSE`.
