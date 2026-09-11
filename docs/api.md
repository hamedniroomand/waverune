# WaveRune API reference

This page documents the public exports of the `waverune` package, as they
exist in `src/index.ts`, and the `waverune` CLI. The package runs on
Node.js 22 or later and on Bun. It is ESM only, and it ships TypeScript
declarations.

[Project overview](../README.md) · [How it works](how-it-works.md) · [Reliability report](reliability-report.md)

## On this page

- [Import](#import)
- [Functional API](#functional-api)
- [Types](#types)
- [PerceptualWatermarker](#perceptualwatermarker)
- [DummyWatermarker](#dummywatermarker)
- [WAV codec](#wav-codec)
- [WAV files](#wav-files)
- [CLI](#cli)

## Import

```ts
import {
  embed,
  detect,
  readWavFile,
  writeWavFile,
  PerceptualWatermarker,
  DummyWatermarker,
  decodeWav,
  encodeWav,
  DEFAULT_CONFIG,
  WatermarkingError,
  calculateAudioMetrics,
} from 'waverune';
```

## Functional API

### `embed(audio, opts?, config?)`

```ts
function embed(
  audio: AudioBuffer,
  opts?: EmbedOptions,
  config?: Partial<PerceptualConfig>,
): AudioBuffer;
```

Embeds `opts.payload` into every channel of `audio` under `opts.key` and
returns a new `AudioBuffer`. The input is not changed. `config` overrides
the watermarker geometry; leave it out for the defaults. This is
`new PerceptualWatermarker(config).applyWatermark(audio, opts)` in one call.

### `detect(audio, opts?, config?)`

```ts
function detect(
  audio: AudioBuffer,
  opts?: DetectOptions,
  config?: Partial<PerceptualConfig>,
): DetectionResult;
```

Reads a payload from `audio` under `opts.key`, blind, without the original.
`config` must match the values that `embed` used. This is
`new PerceptualWatermarker(config).getWatermark(audio, opts)` in one call.

```ts
const marked = embed(audio, { key: 'secret', payload: 0xdeadbeefn });
const result = detect(marked, { key: 'secret' });
if (result.detected) console.log(result.payload); // 3735928559n
```

## Types

### `AudioBuffer`

```ts
interface AudioBuffer {
  sampleRate: number;
  channels: Float32Array[];
}
```

One entry in `channels` holds one audio channel. Every channel must hold the
same number of samples. Sample values are floating-point, in the -1 to 1
range for full-scale audio.

### `Band`

```ts
interface Band {
  lowHz: number;
  highHz: number;
}
```

The frequency band that a detection call used. `detect` clamps `highHz` near
the Nyquist frequency at low sample rates. See "Sample-rate limit" in the
README.

### `EmbedOptions`

```ts
interface EmbedOptions {
  key?: string;
  payload?: bigint;
  alpha?: number;
}
```

- `key` — the key that derives the pseudo-random chip sequence. Defaults to
  `"waverune"` inside `PerceptualWatermarker`. Detection needs the same key.
  Files embedded with an earlier release under the old default key
  `"wavemark"` need `key: "wavemark"` at detection.
- `payload` — the 32-bit payload to embed. Defaults to `0n`.
- `alpha` — the embedding strength, scaled against the masking threshold.
  Defaults to the watermarker's configured `alpha`, `0.45`. Must be a finite
  number of 0 or more; anything else throws `WatermarkingError`. An `alpha`
  of 0 writes an unmarked copy; the CLI's `embed` then fails verification.

### `DetectOptions`

```ts
interface DetectOptions {
  key?: string;
  payloadBits?: number;
}
```

- `key` — the key to check the audio against. Must match the embed key.
- `payloadBits` — the payload width, in bits. Defaults to the watermarker's
  configured `payloadBits`, `32`.

`payloadBits` is a detect-only option. `applyWatermark` always uses the
payload width from the watermarker's configuration.

### `DetectionResult`

```ts
interface DetectionResult {
  detected: boolean;
  payload: bigint | null;
  correlationScore: number;
  syncErrorRate: number;
  band: Band;
  diagnostics: DetectionDiagnostics;
}
```

- `detected` — the acceptance decision. `true` only when the 16 decoded sync
  bits equal the sync pattern and the 8 decoded checksum bits equal the
  checksum of the decoded payload bits, on one channel at the selected
  alignment. No correlation threshold applies.
- `payload` — the recovered payload. This field is `null` whenever `detected`
  is `false`. A rejected block never returns a payload as if it were valid.
- `correlationScore` — `mean / (1 + mean)`, where `mean` is the mean absolute
  per-bit correlation over the 56 block bits. Each per-bit correlation is a
  normalised mean in [-1, 1], so the score lies in [0, 0.5]. Clean
  detections on the synthetic fixtures score about 0.16 to 0.22; unmarked
  audio scores about 0.05 and at most 0.079 in 585 measured rejection
  trials; silence scores 0. The score is not a probability, and it plays no
  part in acceptance.
- `syncErrorRate` — the fraction of the 16 sync bits that decoded wrongly at
  the selected alignment. The alignment search picks the alignment that
  agrees best with the sync pattern, so this value is optimistically biased.
  It is not the payload bit error rate and not a bound on it in either
  direction.
- `band` — the frequency band that detection used. See `Band` above.
- `diagnostics` — the intermediate values behind the decision. See below.

### `DetectionDiagnostics`

```ts
interface DetectionDiagnostics {
  syncValid: boolean;
  checksumValid: boolean;
  candidatePayload: bigint;
  blockOffset: number;
  sampleShift: number;
  activeFrames: number;
  totalFrames: number;
  meanCorrelation: number;
  minCorrelation: number;
  channel: number;
}
```

- `syncValid`, `checksumValid` — the two halves of the acceptance rule,
  reported separately. `detected` is their conjunction.
- `candidatePayload` — the payload bits as decoded at the selected
  alignment, whether or not the block validated. On a rejected result this
  is noise, not a payload. It is diagnostic data only.
- `blockOffset` — the selected block alignment, in frames (0 to 149 at the
  default block length).
- `sampleShift` — the selected sub-hop shift, in samples.
- `activeFrames`, `totalFrames` — how many analysis frames passed the energy
  gate. Silence gives `activeFrames` 0.
- `meanCorrelation`, `minCorrelation` — the mean and the smallest absolute
  per-bit correlation over the block bits, both in [0, 1]. `minCorrelation`
  is the margin of the weakest bit.
- `channel` — the index of the channel that produced the result.

Diagnostics do not change acceptance and are not a substitute for
`detected`.

### `Watermarker`

```ts
interface Watermarker {
  applyWatermark(audio: AudioBuffer, opts?: EmbedOptions): AudioBuffer;
  getWatermark(audio: AudioBuffer, opts?: DetectOptions): DetectionResult;
}
```

`PerceptualWatermarker` and `DummyWatermarker` both implement this interface.

### `WatermarkingError`

```ts
class WatermarkingError extends Error {}
```

waverune throws this error type for a malformed WAV file, an unsupported bit
depth, mismatched channel counts, an audio buffer with no channels or with
channels of different lengths, a non-positive sample rate, a NaN or infinite
sample, a negative or non-finite `alpha`, a payload that does not fit the
payload width, or a sample rate too low to hold the band.
`err.name` is `"WatermarkingError"`.

## `PerceptualWatermarker`

The watermarker that modulates spectral magnitudes under a simplified
masking model and detects the payload blindly.

```ts
class PerceptualWatermarker implements Watermarker {
  constructor(config?: Partial<PerceptualConfig>);
  applyWatermark(audio: AudioBuffer, opts?: EmbedOptions): AudioBuffer;
  getWatermark(audio: AudioBuffer, opts?: DetectOptions): DetectionResult;
}
```

### Constructor

The constructor takes a partial `PerceptualConfig`. Any field left out uses
the value from `DEFAULT_CONFIG`.

```ts
interface PerceptualConfig {
  hopSeconds: number;
  windowSeconds: number;
  lowHz: number;
  highHz: number;
  slots: number;
  blockSeconds: number;
  payloadBits: number;
  alpha: number;
  alignmentSteps: number;
}

const DEFAULT_CONFIG: PerceptualConfig = {
  hopSeconds: 0.01,
  windowSeconds: 0.046,
  lowHz: 500,
  highHz: 5000,
  slots: 48,
  blockSeconds: 1.5,
  payloadBits: 32,
  alpha: 0.45,
  alignmentSteps: 8,
};
```

Changing `lowHz`, `highHz`, `slots`, `blockSeconds`, or `payloadBits` between
an embed call and a detect call breaks detection. Use one shared
configuration, or the defaults, on both sides.

`alignmentSteps` is a detect-side setting. The detector analyses the signal
at this many sub-hop shifts, spaced `hop / alignmentSteps` samples apart,
and keeps the alignment that agrees best with the sync pattern. The default
of 8 leaves at most 28 samples (0.6 ms) of misalignment at 44.1 kHz and
recovers every measured prefix-removal offset on both synthetic fixtures. A
value of 1 reproduces the behaviour before this setting existed, which failed
5 of 17 declared offsets on the tonal fixture. Detection time grows in
proportion: about 0.1 s per step for 6 s of 44.1 kHz audio on an Apple
M-series laptop. The constructor throws for a value that is not a positive
integer.

### `applyWatermark(audio, opts?)`

Embeds `opts.payload` into every channel of `audio`, under the key
`opts.key`. Returns a new `AudioBuffer`. The function does not change the
input `audio`.

The embedder runs eight analysis and synthesis passes. The first pass reuses
the phase of the input. Each later pass re-analyses the previous pass's
output and reuses that output's phase, so the output phase is not the input
phase.

```ts
const watermarker = new PerceptualWatermarker();
const marked = watermarker.applyWatermark(audio, {
  key: 'secret',
  payload: 0xdeadbeefn,
});
```

### `getWatermark(audio, opts?)`

Reads every channel of `audio` under the key `opts.key`, and returns the
first channel's result that passes the acceptance rule. When no channel
passes, the function returns the result with the highest correlation score,
with `detected` false and `payload` null.

```ts
const result = watermarker.getWatermark(marked, { key: 'secret' });
if (result.detected) {
  console.log(result.payload); // a bigint
}
```

Detection is blind: `getWatermark` needs the key only. It does not need the
original, unmarked audio.

The detector whitens the slot energies within each frame, weights each cell
by the inverse of its local residual power, and correlates against the
keyed chips. This detector shipped after the v0.2.0 embedder; files embedded
by v0.2.0 use the same format and still detect.

Digital silence gates out every frame and returns a rejection with a
correlation score of 0. The energy gate is relative to the loudest frame, so
quiet audio is analysed normally. Audio shorter than the measured excerpt
minimum runs through the same rule and usually rejects; the [reliability report](reliability-report.md) gives the measured durations. A zero-length channel behaves as silence.

## `DummyWatermarker`

```ts
class DummyWatermarker implements Watermarker {
  applyWatermark(audio: AudioBuffer, opts?: EmbedOptions): AudioBuffer;
  getWatermark(audio: AudioBuffer, opts?: DetectOptions): DetectionResult;
}
```

A test double, mirroring Perth's `DummyWatermarker`. `applyWatermark` rounds
every sample to 5 decimal places and adds no real watermark. `getWatermark`
always returns `detected: false` with a `null` payload and zeroed
diagnostics. Use this class where a real watermark is not needed but the
`Watermarker` interface is required.

## WAV codec

### `decodeWav(data)`

```ts
function decodeWav(data: Uint8Array): AudioBuffer;
```

Decodes a RIFF/WAVE byte buffer into an `AudioBuffer`. Supports PCM at 16,
24, and 32-bit depth, and 32-bit float. Throws `WatermarkingError` for a
buffer that is too short, for a missing RIFF/WAVE header, for an invalid
channel count, or for an unsupported bit depth.

When the header declares more data than the buffer holds, `decodeWav` reads
only the bytes present. It does not throw in this case. This matches a file
truncated by a partial download. The caller gets a shorter `AudioBuffer`
instead of an error.

```ts
import { readFile } from 'node:fs/promises';
const audio = decodeWav(await readFile('input.wav'));
```

### `encodeWav(audio, opts?)`

```ts
function encodeWav(
  audio: AudioBuffer,
  opts?: { bitDepth?: 16 | 24 | 32; float?: boolean },
): Uint8Array;
```

Encodes an `AudioBuffer` to a RIFF/WAVE byte buffer. `bitDepth` defaults to 16. Set `float: true` with `bitDepth: 32` to write 32-bit float samples.
Throws `WatermarkingError` when `float` is `true` and `bitDepth` is not 32.

```ts
import { writeFile } from 'node:fs/promises';
await writeFile('output.wav', encodeWav(marked));
```

## WAV files

The codec functions above work on bytes. These two helpers connect them to
the filesystem through `node:fs/promises`, which Node and Bun both provide.

### `readWavFile(path)`

```ts
function readWavFile(path: string): Promise<AudioBuffer>;
```

Reads and decodes one WAV file. Throws an `Error` with the message
`Cannot read the file "<path>".` when the file cannot be read, and a
`WatermarkingError` when the bytes are not a supported WAV file.

### `writeWavFile(path, audio, opts?)`

```ts
function writeWavFile(
  path: string,
  audio: AudioBuffer,
  opts?: { bitDepth?: 16 | 24 | 32; float?: boolean },
): Promise<void>;
```

Encodes `audio` with `encodeWav` and writes it to `path`, replacing any
existing file. `opts` are the `encodeWav` options; the default is 16-bit
PCM.

## Protocol primitives

These exports are the deterministic parts of the watermark protocol. The same
input gives the same output under every supported runtime, and the
interoperability test compares them byte for byte between Bun and Node. Most
callers never need them.

- `crc32(bytes: Uint8Array): number` — CRC-32 (IEEE), the checksum family
  that zlib and PNG use. `crc32` of the ASCII string `123456789` is
  `0xcbf43926`.
- `deriveSeed(key: string, domain: string): Uint32Array` — four 32-bit words
  from HMAC-SHA256 with `key` over `domain`, read little-endian. The codec
  uses the domains `"cells"` and `"chips"`.
- `buildBlock(payload: bigint, payloadBits: number): Uint8Array` and
  `parseBlock(bits: Uint8Array, payloadBits: number): ParsedBlock` — the
  56-bit block layout: 16 sync bits, the payload bits, 8 checksum bits.
- `checksumBits(bits)`, `totalBits(payloadBits)`, and the constants
  `SYNC_BITS` (16), `CRC_BITS` (8) and `SYNC_PATTERN` (`0xace1`).

## Audio metrics

### `calculateAudioMetrics(original, processed)`

```ts
interface AudioMetrics {
  snr: number;
  mse: number;
  psnr: number;
}

function calculateAudioMetrics(original: Float32Array, processed: Float32Array): AudioMetrics;
```

Computes the mean squared error, the signal-to-noise ratio, and the peak
signal-to-noise ratio between two equal-length channels. Throws
`WatermarkingError` when the two inputs have different lengths, or when the
input is empty. Returns `Infinity` for `snr` and `psnr` when the two signals
are identical. These are waveform metrics, not perceptual ones.

## CLI

Install the CLI with `npm install -g waverune`, run it directly with
`npx waverune` or `bunx waverune`, or use the
[standalone installer](../README.md#one-command-install-no-node-or-bun)
without installing Node.js or Bun. All distributions provide the same commands.

Run `waverune --version` to check the installed version and `waverune --help`
to list commands and options.

```
waverune embed  <input.wav> -o <output.wav> [--id <hex|dec>] [--key <key>] [--alpha <n>] [--json]
waverune detect <input.wav> [--key <key>] [--json]
waverune metrics <original.wav> <processed.wav> [--json]
waverune --version
waverune --help
```

### `embed`

Reads `input.wav`, embeds a payload, writes the result to the path given by
`-o` or `--output`, then verifies the written file. The verification flow is:
embed, encode, write, read the written file back, decode, detect, and compare
the recovered id with the requested id. Verification passes only when the
detector accepts a block and the accepted id equals the requested id
exactly. The SNR, MSE and PSNR compare the input with the decoded saved
file, so they include the 16-bit quantisation of the output.

On a failed verification the output file stays on disk for inspection, the
command reports the failure, and the exit code is 3.

- `--id` — the payload, as a hex value (`0x...`) or a decimal value. When
  omitted, `embed` generates a random 32-bit id and prints it.
- `--key` — the embedding key. Defaults to `"waverune"`. Pass
  `--key wavemark` to read files embedded with an earlier release under the
  old default.
- `--alpha` — overrides the default embedding strength. Must be a finite
  number of 0 or more.
- `--json` — prints one JSON object and nothing else on stdout.

```
$ waverune embed input.wav -o output.wav --id 0xDEADBEEF --key secret
Wrote the watermark to "output.wav".
Requested id: 3735928559
Recovered id: 3735928559
Correlation score: 0.181
SNR: 23.60 dB
MSE: 5.3787e-5
PSNR: 34.48 dB
```

The JSON form holds the requested id, the recovered id, the output path, the
verification status and failure reason, the full detection result with
diagnostics, and the metrics:

```
$ waverune embed input.wav -o output.wav --id 0xDEADBEEF --key secret --json
{"command":"embed","requestedId":"3735928559","generatedId":false,"output":"output.wav","verified":true,"failure":null,"recoveredId":"3735928559","detection":{"detected":true,"id":"3735928559","correlationScore":0.1805,"syncErrorRate":0,"band":{"lowHz":495.26,"highHz":4995.70},"diagnostics":{"syncValid":true,"checksumValid":true,"candidateId":"3735928559","blockOffset":0,"sampleShift":0,"activeFrames":604,"totalFrames":605,"meanCorrelation":0.2203,"minCorrelation":0.1575,"channel":0}},"metrics":{"snr":23.597,"mse":0.0000538,"psnr":34.48}}
```

`failure` is `null`, `"not-detected"`, or `"id-mismatch"`. The numbers above
are shortened for the page; the command prints full precision.

### `detect`

Reads `input.wav` and reports whether it holds a watermark under `--key`.

```
$ waverune detect output.wav --key secret
Watermark found. Id: 3735928559
Correlation score: 0.181
```

```
$ waverune detect output.wav --key secret --json
{"detected":true,"id":"3735928559","correlationScore":0.1805,"syncErrorRate":0,"band":{"lowHz":495.26,"highHz":4995.70},"diagnostics":{"syncValid":true,"checksumValid":true,"candidateId":"3735928559","blockOffset":0,"sampleShift":0,"activeFrames":604,"totalFrames":605,"meanCorrelation":0.2203,"minCorrelation":0.1575,"channel":0}}
```

`id` is `null` when `detected` is `false`. `diagnostics.candidateId` is the
raw decoded value and is noise in that case.

### `metrics`

Reads `original.wav` and `processed.wav`, and reports SNR, MSE, and PSNR
averaged across channels. Throws an error when the two files hold different
channel counts.

```
$ waverune metrics input.wav output.wav
SNR: 23.60 dB
MSE: 5.3787e-5
PSNR: 34.48 dB
```

### Exit codes

| Code | Meaning                                                                                |
| ---- | -------------------------------------------------------------------------------------- |
| 0    | Success. For `detect`, a watermark was accepted. For `embed`, the saved file verified. |
| 1    | An error occurred: a bad argument, a missing file, or a bad file format.               |
| 2    | `detect` ran without error, but accepted no watermark.                                 |
| 3    | `embed` wrote the file, but the saved file did not verify. The file is kept.           |

## Notes on reliability

- `syncErrorRate` is biased by the alignment search. See `DetectionResult`.
- `getWatermark` never reports a `payload` when `detected` is `false`. This
  holds on audio that never carried a watermark, on audio where an attack
  destroyed it, and on audio detected with the wrong key. The 585-trial
  rejection set observed zero acceptances; that is a count, not a
  probability.
- The checksum is an integrity check, not authentication. Anyone with the key
  can produce a passing file.
- The supported cases and the measured limits are in the README and in
  `docs/reliability-report.md`. Excerpt length in particular depends on the
  material: 3 s passed at every tested position on the synthetic fixtures,
  while text-to-speech speech needed most of its 16 to 18 s.
