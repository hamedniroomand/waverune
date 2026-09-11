# wavemark API reference

This page documents the public exports of the `wavemark` package, as they
exist in `src/index.ts`, and the `wavemark` CLI.

## Import

```ts
import {
  PerceptualWatermarker,
  DummyWatermarker,
  decodeWav,
  encodeWav,
  DEFAULT_CONFIG,
  WatermarkingError,
} from "wavemark";
```

`calculateAudioMetrics` and `AudioMetrics` live in `src/metrics.ts`. This
module is not part of `src/index.ts`. Import it with a relative or a
package-subpath import, for example `wavemark/src/metrics`, when your build
setup allows a deep import.

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
  `"wavemark"` inside `PerceptualWatermarker`. Detection needs the same key.
- `payload` — the 32-bit payload to embed. Defaults to `0n`.
- `alpha` — the embedding strength, scaled against the masking threshold.
  Defaults to the watermarker's configured `alpha`, `0.45`.

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
  confidence: number;
  bitErrorEstimate: number;
  band: Band;
}
```

- `detected` — `true` only when the sync pattern and the checksum both pass.
- `payload` — the recovered payload. This field is `null` whenever `detected`
  is `false`. A failed check never returns a payload as if it were valid.
- `confidence` — a value from 0 to 1. Higher means stronger correlation
  against the keyed sequence.
- `bitErrorEstimate` — the fraction of the 16 sync bits that decoded
  incorrectly at the chosen block alignment. The sync bits carry a known
  pattern, so this fraction is a direct measurement. The alignment search
  picks the offset that agrees best with that pattern. The estimate is
  therefore a lower bound on the true bit error rate, not an unbiased one.
- `band` — the frequency band that detection used. See `Band` above.

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

wavemark throws this error type for a malformed WAV file, an unsupported bit
depth, or mismatched channel counts. `err.name` is `"WatermarkingError"`.

## `PerceptualWatermarker`

The watermarker that hides a payload under the masking threshold and detects
it blindly.

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
};
```

Changing `lowHz`, `highHz`, `slots`, `blockSeconds`, or `payloadBits` between
an embed call and a detect call breaks detection. Use one shared
configuration, or the defaults, on both sides.

### `applyWatermark(audio, opts?)`

Embeds `opts.payload` into every channel of `audio`, under the key
`opts.key`. Returns a new `AudioBuffer`. The function does not change the
input `audio`.

```ts
const watermarker = new PerceptualWatermarker();
const marked = watermarker.applyWatermark(audio, {
  key: "secret",
  payload: 0xdeadbeefn,
});
```

### `getWatermark(audio, opts?)`

Reads every channel of `audio` under the key `opts.key`, and returns the
first channel's result that passes the sync and checksum test. When no
channel passes, the function returns the result with the highest confidence,
and `detected` is `false`.

```ts
const result = watermarker.getWatermark(marked, { key: "secret" });
if (result.detected) {
  console.log(result.payload); // a bigint
}
```

Detection is blind: `getWatermark` needs the key only. It does not need the
original, unmarked audio.

## `DummyWatermarker`

```ts
class DummyWatermarker implements Watermarker {
  applyWatermark(audio: AudioBuffer, opts?: EmbedOptions): AudioBuffer;
  getWatermark(audio: AudioBuffer, opts?: DetectOptions): DetectionResult;
}
```

A test double, mirroring Perth's `DummyWatermarker`. `applyWatermark` rounds
every sample to 5 decimal places and adds no real watermark. `getWatermark`
always returns `detected: false` with a `null` payload. Use this class where
a real watermark is not needed but the `Watermarker` interface is required.

## WAV codec

### `decodeWav(data)`

```ts
function decodeWav(data: Uint8Array): AudioBuffer;
```

Decodes a RIFF/WAVE byte buffer into an `AudioBuffer`. Supports PCM at 16,
24, and 32-bit depth, and 32-bit float. Throws `WatermarkingError` for a
buffer that is too short, for a missing RIFF/WAVE header, or for an
unsupported bit depth.

```ts
const audio = decodeWav(await Bun.file("input.wav").bytes());
```

### `encodeWav(audio, opts?)`

```ts
function encodeWav(
  audio: AudioBuffer,
  opts?: { bitDepth?: 16 | 24 | 32; float?: boolean },
): Uint8Array;
```

Encodes an `AudioBuffer` to a RIFF/WAVE byte buffer. `bitDepth` defaults to
16. Set `float: true` with `bitDepth: 32` to write 32-bit float samples.
Throws `WatermarkingError` when `float` is `true` and `bitDepth` is not 32.

```ts
await Bun.write("output.wav", encodeWav(marked));
```

## Audio metrics

`src/metrics.ts` is not re-exported from `src/index.ts`. Import it directly
from that path in this repository, or through a subpath import once your
build resolves package internals.

### `calculateAudioMetrics(original, processed)`

```ts
interface AudioMetrics {
  snr: number;
  mse: number;
  psnr: number;
}

function calculateAudioMetrics(
  original: Float32Array,
  processed: Float32Array,
): AudioMetrics;
```

Computes the mean squared error, the signal-to-noise ratio, and the peak
signal-to-noise ratio between two equal-length channels. Throws
`WatermarkingError` when the two inputs have different lengths, or when the
input is empty. Returns `Infinity` for `snr` and `psnr` when the two signals
are identical.

## CLI

```
wavemark embed  <input.wav> -o <output.wav> [--id <hex|dec>] [--key <key>] [--alpha <n>] [--json]
wavemark detect <input.wav> [--key <key>] [--json]
wavemark metrics <original.wav> <processed.wav> [--json]
```

### `embed`

Reads `input.wav`, embeds a payload, writes the result to the path given by
`-o` or `--output`, then verifies the result by detecting it again. Prints
the recovered id, and the SNR, MSE, and PSNR between the input and the
output.

- `--id` — the payload, as a hex value (`0x...`) or a decimal value. When
  omitted, `embed` generates a random 32-bit id and prints it.
- `--key` — the embedding key. Defaults to `"wavemark"`.
- `--alpha` — overrides the default embedding strength.
- `--json` — prints one JSON object instead of the plain-text lines above.

```
$ wavemark embed input.wav -o output.wav --id 0xDEADBEEF --key secret
Wrote the watermark to "output.wav".
Recovered id: 3735928559
SNR: 23.58 dB
MSE: 1.2139e-4
PSNR: 31.38 dB
```

### `detect`

Reads `input.wav` and reports whether it holds a watermark under `--key`.

```
$ wavemark detect output.wav --key secret
Watermark found. Id: 3735928559
Confidence: 0.181
```

```
$ wavemark detect output.wav --key secret --json
{"detected":true,"id":"3735928559","confidence":0.18091342996613496,"bitErrorEstimate":0,"band":{"lowHz":495.263671875,"highHz":4995.703125}}
```

### `metrics`

Reads `original.wav` and `processed.wav`, and reports SNR, MSE, and PSNR
averaged across channels. Throws an error when the two files hold different
channel counts.

```
$ wavemark metrics input.wav output.wav
SNR: 23.58 dB
MSE: 1.2139e-4
PSNR: 31.38 dB
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. For `detect`, a watermark was found. |
| 1 | An error occurred: a bad argument, a missing file, or a bad file format. |
| 2 | `detect` ran without error, but found no watermark. |

## Notes on reliability

- `bitErrorEstimate` is a lower bound, not an unbiased estimate. See
  `DetectionResult` above.
- `getWatermark` never reports a `payload` when `detected` is `false`. This
  holds even on audio that never carried a watermark, and on audio where an
  attack destroyed it.
- An excerpt needs about two blocks, near 3 seconds, to decode reliably. See
  the README's "Robustness" section for the measured limits on shorter
  excerpts and on other attacks.
