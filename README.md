# waverune

waverune embeds a 32-bit payload into a WAV file by modulating short-time
spectral magnitudes under a simplified masking model. It detects the payload
later with the key alone; it does not need the original audio.

waverune is an npm package with zero runtime dependencies. It runs on
Node.js 22 or later and on Bun, and it ships a library API and a CLI.
Standalone executables that need neither runtime are published with each
GitHub Release.

Every robustness and quality claim in this file is a measurement on a
declared set of inputs. `docs/reliability-report.md` records the inputs, the
commands, and the results. A claim holds for the conditions that were
measured, not for audio in general.

## Install

The npm package is the canonical distribution.

```bash
npm install waverune        # library, in a project
npm install -g waverune     # global CLI: `waverune ...`
npx waverune --help         # one-off CLI run without installing
```

Bun users can run the same package with `bun add waverune` and `bunx waverune`.

### Runtime support

| Runtime           | Status                                                |
| ----------------- | ----------------------------------------------------- |
| Node.js 22, 24    | Primary runtime. CI runs the package and CLI on both. |
| Bun 1.4+          | Supported runtime, and the development toolchain.     |
| Standalone binary | Optional. Embeds Bun; needs no Node or Bun install.   |

Watermarks are interoperable across runtimes: a file embedded under Node is
detected under Bun, and the other way round, with the same payload. CI
checks all four embed/detect combinations on every push. Byte-identical
audio across runtimes is not a goal; floating-point DSP may differ in the
last bits. CRC, seeds, block bits and every other protocol value are
identical by contract and are checked byte for byte.

### Standalone binaries

Every GitHub Release attaches one executable per platform: macOS ARM64 and
x64, Linux x64 and ARM64, and Windows x64. Each file embeds the Bun runtime,
so it is tens of megabytes, and it runs with no Node or Bun installation.
Download the file for your platform, make it executable, and run it in place
of the `waverune` command. The binaries are never included in the npm
package.

## Quick start: library

```ts
import { detect, embed, readWavFile, writeWavFile } from 'waverune';

const audio = await readWavFile('input.wav');

const marked = embed(audio, { key: 'secret', payload: 0xdeadbeefn });
await writeWavFile('output.wav', marked);

const result = detect(marked, { key: 'secret' });
console.log(result.detected, result.payload);
// true 3735928559n
```

`embed` and `detect` use the default configuration. `PerceptualWatermarker`
exposes the same operations with a tunable configuration. `decodeWav` and
`encodeWav` work on byte arrays for callers who manage their own IO. See
`docs/api.md` for the full API reference.

## Quick start: CLI

```bash
waverune embed input.wav -o output.wav --id 0xDEADBEEF --key secret
waverune detect output.wav --key secret
waverune metrics input.wav output.wav
```

Sample run against a six-second broadband synthetic file:

```
$ waverune embed input.wav -o output.wav --id 0xDEADBEEF --key secret
Wrote the watermark to "output.wav".
Requested id: 3735928559
Recovered id: 3735928559
Correlation score: 0.181
SNR: 23.60 dB
MSE: 5.3787e-5
PSNR: 34.48 dB

$ waverune detect output.wav --key secret
Watermark found. Id: 3735928559
Correlation score: 0.181
```

`embed` verifies the file it wrote: it reads the saved WAV back, decodes it,
detects, and compares the recovered id with the requested id. The quality
metrics compare the input with the decoded saved file. When verification
fails, the file stays on disk, the failure is reported, and the exit code is 3. Add `--json` to any command for a single JSON line. `detect` exits with
code 0 when it accepts a watermark, 2 when it does not, and 1 on an error.

## Demo page

```bash
bun run demo
```

Opens a small React page at `http://localhost:3000`. Pick a WAV file up to
30 s, enter a key and an optional id, then Embed to download the marked file
or Detect to read an id back. The page lives in `demo/` as its own workspace
package, bundled by Bun from `demo/index.html` with Tailwind; its two API
routes call the library on the server. Nothing in `demo/` ships in the npm
package.

## Development

Bun is the toolchain: it installs, tests, bundles and compiles. Nothing it
produces for npm needs Bun at runtime.

```bash
bun install
bun test                 # full unit and integration suite (bun:test)
bun run typecheck        # dev config, plus the Node-only build config
bun run lint
bun run format:check
bun run build            # dist/: Node-targeted JavaScript plus .d.ts files
bun run test:node        # Node compatibility suite against dist/
bun run test:interop     # Bun <-> Node embed/detect, protocol fingerprint
bun run check:pack       # npm pack, inspect, install, import, run the CLI
bun run build:binaries   # standalone executables into release/
```

The build is `bun build` with `--target node`, with `src/index.ts` and
`src/bin.ts` as entry points and shared code split into one chunk. `tsc`
emits the declarations from `tsconfig.build.json`, which types the source
against Node alone, so a Bun API in `src/` fails the typecheck. A script
then rewrites the `~/` import alias in the declarations to relative paths.

`bun test` runs the unit tests, the acceptance matrix, the measured-attack
regressions, the CLI tests, and the resampling regression. The long tests
carry their own timeouts, so no global `--timeout` flag is needed. The suite
takes several minutes because the acceptance matrix embeds 40 pairs and runs
the detector, with its eight-step alignment search, a few hundred times.

The Bun suite alone is not evidence of Node compatibility. `test:node` runs
`node --test` against the built `dist/` and spawns the CLI with `node`. CI
runs it on Node 22 and Node 24 on machines with no Bun installed, and runs
`test:interop` on a machine with both.

The resampling regression needs an external resampler, `sox` or macOS
`afconvert`. When neither is installed the test fails with a message, because
a silent skip would hide an incomplete validation. Set
`WAVERUNE_ALLOW_SKIP_RESAMPLE=1` to skip it on a machine without either tool.

The benchmark runners under `bench/` measure behaviour and write JSON to
`bench/results/`:

```bash
bun run bench:acceptance   # the required matrix, every trial
bun run bench:crop         # prefix-removal sweep and the excerpt duration grid
bun run bench:attacks      # clipping, noise, requantization, padding, insertion
bun run bench:resample     # real sample-rate conversion through sox or afconvert
bun run bench:rejection    # the larger false-acceptance set
bun run bench:masking      # residual against the masking model, cell by cell
bun run bench:corpus <dir> # a local real-audio corpus that you supply
```

### Layout

```text
src/
  api.ts            embed() and detect(): the functional entry points
  types.ts          shared types and WatermarkingError
  dsp/              FFT, STFT, window: pure typed-array math
  codec/            payload block, CRC-32, keyed PRNG, masking model
  watermarkers/     PerceptualWatermarker and DummyWatermarker
  audio/wav.ts      WAV decode and encode on byte arrays
  platform/         the only files that touch the host: node:crypto, node:fs
  cli.ts            argument parsing and terminal output; exports main()
  bin.ts            #!/usr/bin/env node wrapper, the npm bin entry
```

The DSP, codec and watermarker layers use typed arrays only. `platform/`
holds the two adapters that need a host API, both from `node:` modules that
Node and Bun share. Nothing under `src/` references a `Bun.*` API.

## How it works

waverune hides a keyed signal inside the magnitude spectrum of the audio.

1. **Framing.** waverune analyses the signal in overlapping windows of about
   46 ms with a 10 ms hop. Both are set in seconds, so the frame grid depends
   on duration, not on sample rate. The FFT size rounds to a power of two, so
   the window is 46 ms at 44.1 and 48 kHz and 64 ms at 32 and 16 kHz.
2. **Band.** waverune spreads the payload over the 500 to 5000 Hz band, split
   into 48 frequency slots of equal width.
3. **Masking model.** waverune computes a threshold per frame and per slot
   from the local slot energy: the strongest neighbour spread at 10 dB per
   slot, then lowered by 14 dB. This is a simplified spreading model. It is
   not a calibrated psychoacoustic model, and staying under it is not proof of
   inaudibility. Frames below 5% of the loudest frame's magnitude sum are
   gated out and carry no watermark.
4. **Embedding.** A keyed pseudo-random sequence assigns each spectral cell a
   chip sign and a bit index. waverune moves each cell's magnitude by
   `alpha * chip * bitSign * threshold`, with `alpha` 0.45. Because the
   windows overlap, one analysis and synthesis pass delivers only part of
   that change, so the embedder runs eight passes. The first pass reuses the
   input's phase. Each later pass re-analyses the previous pass's output and
   reuses that output's phase. The output phase is therefore not the input
   phase.
5. **Detection.** waverune analyses the candidate signal the same way,
   removes the host spectrum with two stages of whitening, and correlates the
   residual against the keyed sequence for every block alignment and for
   eight sub-hop sample shifts. It keeps the alignment that agrees best with
   the sync pattern. The detector needs the key only. It does not need the
   original audio.
6. **Framing and acceptance.** The payload sits inside a 1.5 s block with a
   16-bit sync pattern and an 8-bit checksum, and the block repeats for the
   length of the file. The acceptance rule is exact and deterministic: the
   16 decoded sync bits must equal the pattern, and the 8 decoded checksum
   bits must equal the checksum of the decoded payload bits, at the selected
   alignment. No correlation threshold applies. A rejected result has
   `detected: false` and `payload: null`; the raw decoded bits are available
   as a diagnostic and are noise in that case.

The checksum is an integrity check against decoding errors, not
authentication. Anyone who knows the key can produce a file that passes.

### Result fields

- `correlationScore` is `mean / (1 + mean)`, where `mean` is the mean
  absolute per-bit correlation over the 56 block bits. Each per-bit
  correlation is a normalised mean in [-1, 1], so the score lies in
  [0, 0.5]. Clean detections on the synthetic fixtures score 0.16 to 0.22.
  Unmarked audio scores about 0.05, with a maximum of 0.079 observed over
  585 rejection trials. Digital silence scores 0. The score is not a
  probability and plays no part in acceptance.
- `syncErrorRate` is the fraction of the 16 sync bits that decoded wrongly
  at the selected alignment. The alignment search chooses the alignment that
  agrees best with the sync pattern, so this value is optimistically biased.
  It is not the payload bit error rate and not a bound on it.
- `diagnostics` exposes the sync and checksum outcomes separately, the raw
  candidate payload, the selected alignment, the active frame count, and the
  mean and minimum per-bit correlation.

### Silence, short audio, invalid input

Digital silence gates out every frame. The result is a rejection with a
correlation score of 0 and `activeFrames` 0. The gate is relative: a frame is
active when its magnitude sum exceeds 5% of the loudest frame's, so quiet
audio is analysed like loud audio, and a file scaled by 1e-8 still has active
frames. Low-level unmarked audio is part of the rejection sets. Audio shorter
than the measured excerpt minimum runs through the same rule and usually
rejects; see the excerpt grid below. A buffer with no channels, channels of
different lengths, or a non-positive sample rate throws `WatermarkingError`.
A zero-length channel is valid input and behaves as silence.

### Sample-rate limit

The band clamps below 0.95 of the Nyquist frequency, so the full 500 to
5000 Hz band needs a sample rate of about 10.5 kHz or more on both sides.
`result.band` reports the band that detection used.

## Supported behaviour

The cases below are the required acceptance matrix in
`tests/helpers/matrix.ts`. `bun test` runs them; every one passed at the
revision this file describes. They hold for the declared synthetic fixtures
and parameters. Two fixtures are used: a tonal signal of three harmonics
under 1400 Hz over a numerically empty floor, and a broadband signal of four
harmonics plus filtered noise across the band. Neither is a recording.

| Case                                                                                                               | Fixtures                                                         | Trials | Exact recoveries |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------ | ---------------- |
| Clean embed and detect, 20 seeded key and payload pairs                                                            | tonal 4 s, broadband 4 s at 44.1 kHz                             | 40     | 40               |
| The same pairs after a 16-bit WAV encode and decode                                                                | same                                                             | 40     | 40               |
| Gain 0.5 and 2.0                                                                                                   | tonal 6 s, broadband 6 s, key `robustness`, payload `0xcafe1234` | 4      | 4                |
| Prefix removal, 17 declared offsets from 1 sample to 2.0 s, at least 4 s retained                                  | same                                                             | 34     | 34               |
| Sample-rate conversion 44.1 to 48, 48 to 44.1, 44.1 to 32, 44.1 to 16, 48 to 16 kHz through Core Audio `afconvert` | tonal 6 s, broadband 6 s, 5 seeded pairs                         | 50     | 50               |
| Deterministic rejection set: unmarked audio, wrong keys, silence, low-level audio, cross-pair keys                 | 4 s and 6 s fixtures                                             | 110    | 0 acceptances    |

The prefix offsets include 1, 44, 110, 220, 441, 882, 1323, four seeded
offsets between hop boundaries (12, 58, 141, 379), and six offsets beyond one
block (66150 to 88200 samples). Before this milestone, five of the tonal
offsets failed, including the 110-sample case. An eight-step sub-hop
alignment search in the detector fixed them without a change to embedding
strength.

The resampling cases used `afconvert 2.0` on macOS with
`-d LEF32@<rate> -r 127 --src-complexity bats`. Output lengths matched the
expected sample counts exactly. Other resamplers were not measured.

## Measured limits

These are measurements on the same two six-second fixtures, key
`robustness`, payload `0xcafe1234`. They are not supported behaviour. Every
attack below changed the signal; the changed-sample counts are in
`bench/results/attacks-final.json`. No attack produced an accepted wrong
payload.

| Attack                                       | Achieved severity                | Tonal    | Broadband |
| -------------------------------------------- | -------------------------------- | -------- | --------- |
| Clipping at 0.9 of the peak                  | 0.42% / 0.01% of samples changed | exact    | exact     |
| Clipping at 0.7 of the peak                  | 5.66% / 0.80% changed            | rejected | exact     |
| Clipping at 0.5 of the peak                  | 19.0% / 8.63% changed            | rejected | exact     |
| Clipping at 0.3 of the peak                  | 39.4% / 32.8% changed            | rejected | exact     |
| Additive noise, 40 dB SNR achieved, seed 777 | all samples changed              | rejected | exact     |
| Additive noise, 30 dB SNR                    |                                  | rejected | exact     |
| Additive noise, 20 dB SNR                    |                                  | rejected | exact     |
| Additive noise, 10 dB SNR                    |                                  | rejected | exact     |
| Requantization to 12 bits                    | all samples changed              | exact    | exact     |
| Requantization to 8 bits                     |                                  | rejected | exact     |
| Requantization to 6 bits                     |                                  | rejected | exact     |
| 0.5 s of leading silence                     |                                  | exact    | exact     |
| 0.5 s of trailing silence                    |                                  | exact    | exact     |
| 0.5 s of silence inserted at 1.0 s           |                                  | exact    | exact     |
| 0.5 s of silence inserted at 3.0 s           |                                  | rejected | exact     |
| 0.5 s of silence inserted at 4.5 s           |                                  | exact    | exact     |

The tonal fixture rejects at every measured SNR from 40 dB down because
most of its band is numerically empty: the masking model puts almost no
watermark energy there, and a noise floor at those levels swamps what is
there. It still recovers at 80 and 100 dB SNR. A recording has a real noise
floor and does not share this property, but that is a hypothesis, not a
measurement.

### Excerpt duration grid

Fixed-duration excerpts of the marked six-second fixtures, cut at five start
positions. `ok` is exact recovery; `rej` is rejection.

| Fixture   | Start  | 1 s | 1.5 s | 2 s | 2.5 s | 3 s | 3.5 s | 4 s | 5 s |
| --------- | ------ | --- | ----- | --- | ----- | --- | ----- | --- | --- |
| tonal     | 0 s    | rej | rej   | rej | ok    | ok  | ok    | ok  | ok  |
| tonal     | 0.35 s | rej | rej   | ok  | ok    | ok  | ok    | ok  | ok  |
| tonal     | 0.73 s | rej | rej   | ok  | ok    | ok  | ok    | ok  | ok  |
| tonal     | 1.5 s  | rej | rej   | rej | ok    | ok  | ok    | ok  |     |
| tonal     | 2.2 s  | rej | ok    | ok  | ok    | ok  | ok    |     |     |
| broadband | 0 s    | ok  | ok    | rej | ok    | ok  | ok    | ok  | ok  |
| broadband | 0.35 s | rej | rej   | rej | ok    | ok  | ok    | ok  | ok  |
| broadband | 0.73 s | rej | rej   | ok  | ok    | ok  | ok    | ok  | ok  |
| broadband | 1.5 s  | rej | ok    | ok  | ok    | ok  | ok    | ok  |     |
| broadband | 2.2 s  | rej | rej   | ok  | rej   | ok  | ok    |     |     |

The shortest passing duration ranged from 1 s to 2.5 s depending on the
fixture and start. Recovery is not monotonic in duration: a 1 s broadband
excerpt at 0 s passed where the 2 s excerpt failed. On these two fixtures,
3 s was the shortest duration that passed at every tested start. That does
not transfer to other material: on two locally generated text-to-speech
files, only 4 of the 80 excerpts of 5 s or shorter recovered (one 3.5 s, one
4 s, two 5 s), while the full 16 to 18 s files recovered every pair. See the
reliability report.

### False acceptance

waverune observed zero acceptances in 585 deterministic rejection trials:
the 110-trial CI set and a separate 475-trial benchmark set with its own
seeds, covering unmarked audio under 200 keys, marked audio under 200 wrong
keys, low-level audio, and a noise floor at 1e-4 peak with no signal. In the 200 wrong-key
trials the sync pattern alone matched twice and the checksum alone matched
once; both never matched together. Zero observed acceptances in 585
declared trials is a count, not a probability: the trials are a fixed set
of two synthetic signal classes and seeded keys, not a sample of real
audio, and no acceptance rate was estimated from them.

### Masking model

`bench/masking.ts` compares the watermark residual with the host's masking
threshold, cell by cell, on the four-second fixtures. Cells are excluded when
their frame is gated out or when they sit more than 60 dB below the loudest
slot of their frame; on the tonal fixture that excludes 89% of cells, on the
broadband fixture 0.5%. Of the included cells, 6.7% (tonal) and 2.8%
(broadband) exceed the threshold. The median residual-to-threshold ratio is
0.51 and 0.58; the 99th percentile is 2.2 and 1.1; the maximum is 5.7 and
2.8. Among the excluded tonal cells the ratio reaches 1164, because the host
there is numerically zero. The watermark therefore does not stay under the
model's threshold in every cell. SNR against the original is 26.7 dB (tonal)
and 23.7 dB (broadband). SNR is a coarse backstop, not a perceptual measure.

### Real audio

No licensed recorded corpus was available for this milestone, so real-audio
validation is outstanding. `bench/corpus.ts` runs the full measurement set on
a directory of WAV files that you supply, with hashes and metadata. A
two-file demonstration on locally generated macOS text-to-speech recovered
every clean, round-trip, gain, prefix-removal and 8-bit case, rejected one
clipping and one noise case, and recovered only 4 of 80 excerpts of 5 s or
shorter. Text-to-speech output is not a recording and does not stand in for
one.

## Relation to Perth

waverune takes its central idea from
[resemble-ai/Perth](https://github.com/resemble-ai/Perth) (MIT license): hide
watermark energy below a masking threshold and spread it widely.

waverune is **not** a port of Perth and is **not** bit-compatible with it.
Perth embeds and detects a watermark with a trained neural network. waverune
uses classical digital signal processing only: a keyed pseudo-random sequence,
a computed masking threshold, and spectral correlation. Perth's detector
returns a single presence score, with no payload. waverune's detector returns
a 32-bit payload, a correlation score, a sync error rate, and diagnostics.

## Non-goals

- No neural network and no model weights.
- No video processing.
- No MP3, AAC or Opus. waverune reads and writes WAV files only.
- No resampler. Sample-rate conversion is measured through external tools.

## License

MIT. See `LICENSE`.
