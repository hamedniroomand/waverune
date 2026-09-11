# WaveRune reliability report

This report records the benchmark inputs, methods, and results for WaveRune.
It includes historical baselines so changes between detector versions can be
checked and reproduced. Results apply to the declared files and settings.

[Project overview](../README.md) · [API reference](api.md) · [How it works](how-it-works.md)

## Current results at a glance

The v0.3 detector recovered 24 of 27 clean full-length trials across nine
recorded files, and 119 of 119 prefix-removal trials. Excerpts of five seconds
or less recovered in 115 of 329 trials. No accepted wrong payload was observed
with v0.3 in the reported trials; v0.2 produced one on a recorded-audio excerpt.

Start with [the v0.3 recorded-audio results](#124-real-audio-corpus) and
[remaining limitations](#13-remaining-limitations). Sections 1–11 document
the earlier milestone; section 12 records the detector update and supersedes
those earlier detector results where they differ. The embedder is unchanged.

## 1. Environment and baseline

| Item                         | Value                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Source revision at the start | `1560d82` (`refactor: import internal modules through the tilde alias`), working tree clean               |
| Bun                          | 1.4.2                                                                                                     |
| Platform                     | macOS 26.6.2, Darwin 25.6.0, arm64 (Apple M-series)                                                       |
| External resampler           | `afconvert` 2.0 (macOS Core Audio); `sox` and `ffmpeg` not installed                                      |
| Baseline test run            | `bun test --timeout 120000`: 71 pass, 0 fail, 3710 `expect()` calls, 56 s                                 |
| Baseline without the flag    | `bun test`: 71 pass, 0 fail, 63 s; the flag was unnecessary because the long tests set their own timeouts |
| Baseline checks              | `bun run typecheck`, `bun run lint`, `bun run format:check` all passed                                    |

Baseline observations from the review, each reproduced before any change:

| Observation                                                                 | Reproduced result                                                                                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 110-sample prefix removal fails on the six-second tonal fixture; 441 passes | Confirmed. Sweep at 1, 44, 55, 110, 165, 220, 330, 441, 551, 882: 110, 330 and 551 failed with 0 sync errors (sync valid, checksum invalid); broadband passed every offset |
| Hard clipping at ±0.5 changes zero samples                                  | Confirmed. Marked peaks: tonal 0.420, broadband 0.378; samples beyond 0.5: 0                                                                                               |
| CLI `embed --alpha 0 --id 42 --key review` exits 0 with `detected: false`   | Confirmed. JSON showed `detected:false, recoveredId:null`, exit 0, SNR 318.8 dB (unmarked copy)                                                                            |
| Embed and detect time                                                       | Six-second fixture: embed 1.5 s, detect 0.10 to 0.13 s                                                                                                                     |

Per-bit diagnosis of the 110-sample failure (a scratch script that replayed the detector's correlation stage and printed per-bit margins; the same values are now exposed as `diagnostics.minCorrelation` and `diagnostics.meanCorrelation`):
at offset 0 the tonal fixture's weakest block bit had a signed correlation
margin of +0.126 and a mean absolute correlation of 0.281; at a 110-sample
prefix removal the margin fell to -0.054 (one wrong bit) and the mean to
0.175. Sync passed at both. The block-alignment search chose the right block
offset; the loss came from the sub-hop misalignment between the detector's
frame grid and the embedder's.

## 2. Methodology corrections (before algorithm changes)

- **Attacks measure what they change.** `tests/helpers/attacks.ts` returns
  the changed-sample count and fraction and an achieved severity for every
  attack: clipping reports the limit and its ratio to the peak, noise
  reports the achieved SNR and seed, padding is split into leading,
  trailing and internal insertion, cropping is split into prefix removal
  and fixed-duration excerpts. Tests call `assertAltered` before claiming
  robustness. The absolute ±0.5 clipping case is kept only as a test that
  it changes zero samples.
- **CLI verifies the saved file.** `embed` now reads the written WAV back,
  decodes it, detects, and compares the recovered id with the requested id
  through `verifyRecovery`. Metrics compare the input with the decoded saved
  file. A failed verification keeps the file, reports `failure` as
  `not-detected` or `id-mismatch`, and exits 3. `--json` prints one object
  with requested id, recovered id, output path, verification status, the
  full detection result with diagnostics, and metrics. Tests cover the
  alpha-zero failure path (exit 3, file kept), the text-mode failure, and
  the id-mismatch branch through a fabricated result.
- **Result semantics.** `confidence` became `correlationScore` and
  `bitErrorEstimate` became `syncErrorRate`, without compatibility aliases during pre-release development. A `diagnostics` object exposes
  `syncValid`, `checksumValid`, `candidatePayload`, `blockOffset`,
  `sampleShift`, `activeFrames`, `totalFrames`, `meanCorrelation`,
  `minCorrelation` and `channel`. The score formula is unchanged
  (`mean / (1 + mean)`, range [0, 0.5]). The acceptance rule is unchanged:
  exact sync match and exact checksum match. Invalid buffers throw;
  silence rejects with score 0.
- **Source identity in results.** Every result file records a SHA-256 over
  `src/**/*.ts`, `tests/helpers/*.ts`, `bench/*.ts` and `tsconfig.json`
  (`environment.sourceHash`; `package.json` is excluded because a version
  bump does not change a measurement), because a git revision plus
  `workingTree: modified` does not identify an uncommitted tree. The hash
  is captured when a runner starts, after a first version that computed it
  at write time mis-attributed one long run (corrected by hand, see the
  `sourceHashNote` in `corpus-real-baseline.json`). `bun bench/source-hash.ts
<ref>` prints the hash of the files as committed at a git ref, so a result
  file can be matched to a commit: `v0.2.0` gives `da0e03bfd3d2…`, which is
  what the v0.2.0 result files carry. The
  `final` and `baseline` files were regenerated from the final source; the
  baseline runs the same source with `--steps 1`. The tuning-sweep files
  (`crop-steps2/4/16`, `crop-steps8-fine`, `crop-exp-energy8-fine`,
  `acceptance-exp-energy8`) predate the hash and were produced by
  intermediate working trees during tuning.
- **Second-pass fixes after an independent review.** The "dithered
  near-silence" rejection category originally called `addNoise` on a zero
  buffer, which scales by the input RMS and so added nothing; it now uses
  `whiteNoise` at an absolute 1e-4 peak and asserts non-zero RMS. `addNoise`
  now computes the achieved SNR from the Float32 residual. The corpus runner
  records undecodable files, reports `partial` or `outstanding`, and exits 2
  when nothing decoded. `applyWatermark` rejects a negative or non-finite
  `alpha` and any NaN or infinite sample (`alpha: NaN` previously produced
  non-finite output); the CLI rejects `--alpha Infinity`.
- **Acceptance matrix declared** in `tests/helpers/matrix.ts` before tuning,
  with exact sample counts. `bun bench/acceptance.ts --steps 1 --tag baseline`
  recorded the untuned detector against it (`acceptance-baseline.json`).

Baseline matrix result (untuned detector, `alignmentSteps` 1):

| Case                                       | Trials | Exact                                           |
| ------------------------------------------ | ------ | ----------------------------------------------- |
| Clean recovery, 20 pairs × 2 fixtures      | 40     | 40                                              |
| 16-bit WAV round trip, same pairs          | 40     | 40                                              |
| Gain 0.5 and 2.0, both six-second fixtures | 4      | 4                                               |
| Prefix removal, 17 offsets × 2 fixtures    | 34     | 29                                              |
| Rejection set                              | 110    | 0 accepted (1 checksum-only match, 0 sync-only) |

The five unmet prefix cases were all tonal: 110, 141, 379, 66260 and 79366
samples. Every one had a valid sync and an invalid checksum.

## 3. Algorithm change: sub-hop alignment search

`PerceptualConfig.alignmentSteps` (default 8) makes the detector analyse the
signal at `alignmentSteps` shifts spaced `hop / alignmentSteps` samples apart
and keep the shift and block offset with the best sync agreement. Embedding
is unchanged; `alpha` stays 0.45. Setting the value to 1 reproduces the
baseline detector exactly.

Tuning used a prefix-removal sweep at multiples of 21 samples (coarse) or
7 samples (fine) from 0 to two hops (882 samples), which is a different set
from the declared matrix offsets. `bun bench/crop.ts --steps N --tag ...`:

| Steps        | Tonal exact (coarse, 43 offsets)                                                    | Tonal min bit correlation    | Broadband exact         | Detect time per 6 s |
| ------------ | ----------------------------------------------------------------------------------- | ---------------------------- | ----------------------- | ------------------- |
| 1 (baseline) | 30 / 43; failing at 126, 210, 273, 294, 315, 378, 567, 651, 714, 735, 756, 819, 840 | 0.000                        | 43 / 43                 | 0.10 s              |
| 2            | 34 / 43                                                                             | 0.001                        | 43 / 43                 |                     |
| 4            | 43 / 43                                                                             | 0.014                        | 43 / 43                 | 0.38 s              |
| 8            | 43 / 43; fine sweep 127 / 127                                                       | 0.052 (coarse), 0.026 (fine) | 43 / 43; fine 127 / 127 | 0.75 s              |
| 16           | 43 / 43                                                                             | 0.087                        | 43 / 43                 | 1.50 s              |

Eight steps was chosen: it passes every fine-grid offset on both fixtures
with a margin about half the aligned margin, at 0.75 s per six-second
detection. Sixteen steps buys a larger margin for twice the time and is
available through the configuration.

One alternative was tried and rejected: selecting the alignment by the sum
of absolute correlations over all 56 bits instead of the signed sync score
(`crop-exp-energy8-fine.json`, `acceptance-exp-energy8.json`). It gave the
same mean and 10th-percentile margins on the fine sweep (0.118 and 0.079
versus 0.118 and 0.080), passed the same matrix, and raised the maximum
correlation score on rejection trials from 0.070 to 0.085. The documented
sync-based selection was kept.

## 4. Final acceptance matrix

`bun bench/acceptance.ts --tag final` and `bun test tests/acceptance.test.ts`.

| Case                  | Fixtures and parameters                                                    | Trials | Exact      |
| --------------------- | -------------------------------------------------------------------------- | ------ | ---------- |
| Clean recovery        | `tonal-4s-44k`, `broadband-4s-44k`; 20 pairs from `lcg(0x5eed1234)`        | 40     | 40         |
| 16-bit WAV round trip | same                                                                       | 40     | 40         |
| Gain 0.5, 2.0         | `tonal-6s-44k`, `broadband-6s-44k`; key `robustness`, payload `0xcafe1234` | 4      | 4          |
| Prefix removal        | same; offsets below                                                        | 34     | 34         |
| Rejection set         | below                                                                      | 110    | 0 accepted |

Prefix-removal offsets (samples at 44.1 kHz, all retaining at least 4.0 s of
the 6.0 s fixture): 1; 44 (~1 ms); 110 (2.5 ms, the reproduced failure);
220 (~5 ms); 441, 882, 1323 (hop-aligned controls); 12, 58, 141, 379 (seeded
between hops, `lcg(0x0ff5e7)`); 66150 (one block); 66260 (one block + 110);
79366, 82077, 84280 (seeded beyond one block, `lcg(0xb10c)`); 88200 (2.0 s,
retaining exactly 4.0 s). `matrixSeedsMatch()` checks the seeded values
against their generators in the test.

Rejection set composition (110 trials): 4 unmarked fixtures × 5 keys = 20;
2 marked six-second fixtures × 8 wrong keys = 16; digital silence of 4 s and
6 s × 2 keys = 4; 2 unmarked fixtures at gain 1e-4 × 5 keys = 10; 6 seeded
pairs embedded on 2 fixtures, each detected with the other 5 keys = 60.
Final result: 0 accepted, 0 sync-only matches, 0 checksum-only matches,
maximum correlation score 0.070.

## 5. Sample-rate conversion

`bun bench/resample.ts` (`resample-steps8.json`). Tool: `afconvert 2.0`
(macOS Core Audio). Settings:
`afconvert -f WAVE -d LEF32@<rate> -r 127 --src-complexity bats <in> <out>`
(32-bit float in and out, converter quality 127, mastering complexity).
Input: six-second fixtures at the source rate, 5 pairs from `lcg(0x7e5a)`.

| From  | To    | Signal    | Exact | Wrong accepted | Min score | Max sync errors | Checksum valid | Output samples (expected) |
| ----- | ----- | --------- | ----- | -------------- | --------- | --------------- | -------------- | ------------------------- |
| 44100 | 48000 | tonal     | 5/5   | 0              | 0.204     | 0               | 5/5            | 288000 (288000)           |
| 44100 | 48000 | broadband | 5/5   | 0              | 0.165     | 0               | 5/5            | 288000 (288000)           |
| 48000 | 44100 | tonal     | 5/5   | 0              | 0.196     | 0               | 5/5            | 264600 (264600)           |
| 48000 | 44100 | broadband | 5/5   | 0              | 0.161     | 0               | 5/5            | 264600 (264600)           |
| 44100 | 32000 | tonal     | 5/5   | 0              | 0.182     | 0               | 5/5            | 192000 (192000)           |
| 44100 | 32000 | broadband | 5/5   | 0              | 0.138     | 0               | 5/5            | 192000 (192000)           |
| 44100 | 16000 | tonal     | 5/5   | 0              | 0.182     | 0               | 5/5            | 96000 (96000)             |
| 44100 | 16000 | broadband | 5/5   | 0              | 0.138     | 0               | 5/5            | 96000 (96000)             |
| 48000 | 16000 | tonal     | 5/5   | 0              | 0.180     | 0               | 5/5            | 96000 (96000)             |
| 48000 | 16000 | broadband | 5/5   | 0              | 0.134     | 0               | 5/5            | 96000 (96000)             |

All 50 trials recovered exactly. `tests/resample.test.ts` runs one pair per
row as a regression and fails with a message when no resampler is found
(`WAVERUNE_ALLOW_SKIP_RESAMPLE=1` turns that into a skip). The old unfiltered
2:1 decimation test remains as a labelled diagnostic. `sox` was not measured.

## 6. Crop offsets and the excerpt grid

`bun bench/crop.ts --tag final` (`crop-final.json`) and the fine sweep
(`crop-steps8-fine.json`).

Prefix-removal sweep at the default detector: tonal 43/43 (coarse) and
127/127 (fine), broadband 43/43 and 127/127. Minimum bit correlation over
the fine sweep: tonal 0.026, broadband 0.084. No accepted wrong payload.

Excerpt grid, key `robustness`, payload `0xcafe1234`, six-second fixtures.
Durations 1, 1.5, 2, 2.5, 3, 3.5, 4, 5 s at starts 0, 0.35, 0.73, 1.5,
2.2 s:

| Fixture   | Start | 1   | 1.5 | 2   | 2.5 | 3   | 3.5 | 4   | 5   | Shortest passing   |
| --------- | ----- | --- | --- | --- | --- | --- | --- | --- | --- | ------------------ |
| tonal     | 0     | rej | rej | rej | ok  | ok  | ok  | ok  | ok  | 2.5 s              |
| tonal     | 0.35  | rej | rej | ok  | ok  | ok  | ok  | ok  | ok  | 2 s                |
| tonal     | 0.73  | rej | rej | ok  | ok  | ok  | ok  | ok  | ok  | 2 s                |
| tonal     | 1.5   | rej | rej | rej | ok  | ok  | ok  | ok  |     | 2.5 s              |
| tonal     | 2.2   | rej | ok  | ok  | ok  | ok  | ok  |     |     | 1.5 s              |
| broadband | 0     | ok  | ok  | rej | ok  | ok  | ok  | ok  | ok  | 1 s, not monotonic |
| broadband | 0.35  | rej | rej | rej | ok  | ok  | ok  | ok  | ok  | 2.5 s              |
| broadband | 0.73  | rej | rej | ok  | ok  | ok  | ok  | ok  | ok  | 2 s                |
| broadband | 1.5   | rej | ok  | ok  | ok  | ok  | ok  | ok  |     | 1.5 s              |
| broadband | 2.2   | rej | rej | ok  | rej | ok  | ok  |     |     | 2 s, not monotonic |

Every rejection had `payload: null`; no excerpt produced an accepted wrong
payload. 3 s is the shortest duration that passed at every tested start on
both fixtures. Baseline (`crop-baseline.json`) differed at one cell: tonal
at 0.73 s start rejected the 2 s excerpt. The old suite's "truncation to 2 s
is a limit for tonal audio" case (start 2 s, duration 2 s) now recovers.

## 7. Attacks with achieved severity

`bun bench/attacks.ts --tag final` (`attacks-final.json`). Key `robustness`,
payload `0xcafe1234`, six-second fixtures. Marked peaks: tonal 0.4198,
broadband 0.3779. No attack produced an accepted wrong payload.

| Attack         | Parameters                                  | Tonal changed  | Tonal outcome (sync err) | Broadband changed | Broadband outcome (sync err) |
| -------------- | ------------------------------------------- | -------------- | ------------------------ | ----------------- | ---------------------------- |
| Clip           | 0.9 of peak                                 | 1122 (0.42%)   | exact (0)                | 36 (0.01%)        | exact (0)                    |
| Clip           | 0.7 of peak                                 | 14971 (5.66%)  | reject (1/16)            | 2116 (0.80%)      | exact (0)                    |
| Clip           | 0.5 of peak                                 | 50266 (19.0%)  | reject (0/16)            | 22822 (8.63%)     | exact (0)                    |
| Clip           | 0.3 of peak                                 | 104295 (39.4%) | reject (4/16)            | 86704 (32.8%)     | exact (0)                    |
| Noise          | 100 dB target, 100.00 dB achieved, seed 777 | 264082         | exact (0)                | 264036            | exact (0)                    |
| Noise          | 80 dB, 80.00 achieved                       | 264555         | exact (0)                | 264552            | exact (0)                    |
| Noise          | 40 dB, 40.00 achieved                       | 264599         | reject (0/16)            | 264598            | exact (0)                    |
| Noise          | 30 dB, 30.00 achieved                       | 264599         | reject (1/16)            | 264599            | exact (0)                    |
| Noise          | 20 dB, 20.00 achieved                       | 264600         | reject (3/16)            | 264599            | exact (0)                    |
| Noise          | 10 dB, 10.00 achieved                       | 264600         | reject (3/16)            | 264600            | exact (0)                    |
| Requantize     | 12 bits                                     | 264593         | exact (0)                | 264593            | exact (0)                    |
| Requantize     | 8 bits                                      | 264600         | reject (0/16)            | 264600            | exact (0)                    |
| Requantize     | 6 bits                                      | 264599         | reject (1/16)            | 264600            | exact (0)                    |
| Pad leading    | 0.5 s                                       |                | exact (0)                |                   | exact (0)                    |
| Pad trailing   | 0.5 s                                       |                | exact (0)                |                   | exact (0)                    |
| Insert silence | 0.5 s at 1.0 s                              |                | exact (0)                |                   | exact (0)                    |
| Insert silence | 0.5 s at 3.0 s                              |                | reject (2/16)            |                   | exact (0)                    |
| Insert silence | 0.5 s at 4.5 s                              |                | exact (0)                |                   | exact (0)                    |

The tonal noise result at 40 dB was not measured before this milestone (the
old suite started at 30 dB). The 100 and 80 dB rows were added after an
independent review pointed out that "any added noise" was too broad: the
tonal fixture recovers at those levels and rejects from 40 dB down. The
cause is the fixture: most of its band is numerically empty, so the masking
model places almost no watermark energy there and a noise floor at 40 dB SNR
or louder removes it. The two text-to-speech files in section 10 recovered
at 40 and 30 dB.

## 8. False acceptance

CI set: 110 trials, 0 accepted (section 4). Benchmark set,
`bun bench/rejection.ts --tag final --keys 100` (`rejection-final.json`),
seed `0xfa15e`, separate from every CI seed:

| Category                                           | Trials | Accepted | Sync valid | Checksum valid | Both | Min sync errors / 16 | Score median | Score max |
| -------------------------------------------------- | ------ | -------- | ---------- | -------------- | ---- | -------------------- | ------------ | --------- |
| Unmarked, 2 fixtures × 100 keys                    | 200    | 0        | 0          | 0              | 0    | 1                    | 0.048        | 0.076     |
| Low energy (gain 1e-3), 2 fixtures × 25 keys       | 50     | 0        | 0          | 0              | 0    | 1                    | 0.047        | 0.073     |
| Wrong key, 2 fixtures × 4 embedded pairs × 25 keys | 200    | 0        | 2          | 1              | 0    | 0                    | 0.053        | 0.079     |
| Dithered near-silence, 25 keys                     | 25     | 0        | 0          | 0              | 0    | 8                    | 0.000        | 0.000     |

Totals across both sets: 585 trials, 0 acceptances. The crop, attack and
corpus benchmarks produced a further 109 rejections (21 excerpt, 10 attack,
78 text-to-speech), none of them an accepted wrong payload. Classification:

- False acceptance on unmarked audio: 0 of 309 (CI unmarked 20, low-energy
  10, silence 4; bench unmarked 200, low-energy 50, dither 25).
- Wrong-key acceptance: 0 of 276 (CI wrong-key 16, cross-pair 60; bench
  wrong-key 200).

The noise-floor category was rerun after an independent review found that
its first version added no noise (see section 2). The regenerated numbers
above are from the corrected run; every other category was unchanged by the
rerun.

- Accepted incorrect payload with the right key: 0 across every recovery
  trial in this report.
- Expected-id mismatch (a valid different id): handled by
  `verifyRecovery` and exercised by a unit test; not produced by the real
  detector in any trial.

Zero observed failures in 585 declared trials is a count, not a
probability. The trials are a fixed set of two synthetic signal classes and
seeded keys, not a sample from any population of real audio, so no
acceptance rate is estimated from them. A naive model that multiplies the observed sync-only rate in
wrong-key trials (2 in 200) by the 8-bit checksum's 1/256 gives about
4 × 10⁻⁵ per trial; that is a model with an independence assumption, not a
measurement, and it is not presented as a figure in the README. The old
"roughly 1 in 100,000" claim was removed.

## 9. Masking model and quality

`bun bench/masking.ts --tag final` (`masking-final.json`). Four-second
fixtures, key `secret`, payload 7. Exclusion rule: frames below the energy
gate (5% of the loudest frame's magnitude sum) and cells more than 60 dB
below the loudest slot of their frame.

| Fixture          | Cells | Gated out | Below floor | Included      | Exceeding | Exceed % | Ratio median | p90   | p99   | Max   | Excluded max | SNR      | PSNR |
| ---------------- | ----- | --------- | ----------- | ------------- | --------- | -------- | ------------ | ----- | ----- | ----- | ------------ | -------- | ---- |
| tonal-4s-44k     | 19440 | 3072      | 14291       | 2077 (10.7%)  | 140       | 6.74%    | 0.506        | 0.859 | 2.209 | 5.672 | 1164         | 26.65 dB |      |
| broadband-4s-44k | 19440 | 96        | 0           | 19344 (99.5%) | 540       | 2.79%    | 0.579        | 0.827 | 1.133 | 2.799 | n/a          | 23.68 dB |      |

The residual does not stay under the model's threshold in every cell. The
unit test asserts a median below 1 and at least 90% of included cells at or
below 1, which matches the measurement (93.3% and 97.2%). The model is a
simplified spreading function; none of this is a listening result.

CLI quality on the six-second broadband file used in the README examples:
SNR 23.60 dB, MSE 5.38e-5, PSNR 34.48 dB, measured against the decoded saved
16-bit file. Text-to-speech files: SNR 24.8 and 25.9 dB (section 10).

## 10. Real audio

No licensed recorded corpus was available. Real-audio validation is
outstanding. `bench/corpus.ts` is delivered and was exercised on two files
generated locally with the macOS `say` command
(`bun bench/corpus.ts bench/corpus --tag tts-demo`, `corpus-tts-demo.json`).
These are synthetic text-to-speech, not recordings; the directory is
gitignored and nothing ships.

| File                      | SHA-256 (first 12) | Length                | Clean | WAV | Gain | Prefix (17) | Clip 0.9/0.7/0.5                | Noise 40/30/20 dB | 8-bit | Excerpts ≤ 5 s                                  | SNR     |
| ------------------------- | ------------------ | --------------------- | ----- | --- | ---- | ----------- | ------------------------------- | ----------------- | ----- | ----------------------------------------------- | ------- |
| speech-en-daniel-slow.wav | 7a225cdca7ea       | 18.3 s, mono 44.1 kHz | 3/3   | 3/3 | 2/2  | 17/17       | ok / ok / ok                    | ok / ok / ok      | ok    | 1 of 40 (5 s at 2.2 s)                          | 24.8 dB |
| speech-en-samantha.wav    | 1ab88e191cd3       | 15.8 s, mono 44.1 kHz | 3/3   | 3/3 | 2/2  | 17/17       | ok / ok / reject (3.2% changed) | ok / ok / reject  | ok    | 3 of 40 (3.5 s and 4 s at 1.5 s, 5 s at 0.73 s) | 25.9 dB |

Every rejection had `payload: null`. The excerpt result is the main finding:
on speech-like material with pauses, excerpts of 5 s and shorter rarely
recovered even with 250 to 470 active frames, while the full files recovered
every pair. The synthetic fixtures' 3 s figure does not transfer.

## 11. Final verification

Commands run on the final source state (working tree on top of `1560d82`,
uncommitted at the time of the run; `environment.sourceHash` in every
`*-final.json` and `*-baseline.json` file identifies that tree, see section 2):

```
bun test
bun run typecheck
bun run lint
bun run format:check
bun bench/acceptance.ts --tag final
```

| Check                                 | Result                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `bun test`                            | 110 pass, 0 fail, 3850 `expect()` calls, 14 files, 245 s, no `--timeout` flag   |
| `bun run typecheck`                   | pass                                                                            |
| `bun run lint`                        | pass                                                                            |
| `bun run format:check`                | pass (`bench/results/**` is excluded from formatting)                           |
| `bun bench/acceptance.ts --tag final` | 0 unmet recovery cases, 0 false acceptances (rerun after the second-pass fixes) |

Baseline versus final:

| Measure                          | Baseline                                     | Final                                        |
| -------------------------------- | -------------------------------------------- | -------------------------------------------- |
| Tests                            | 71 pass, 3710 assertions                     | 110 pass, 3850 assertions                    |
| Required prefix-removal cases    | 29 / 34                                      | 34 / 34                                      |
| Prefix sweep, tonal, coarse grid | 30 / 43                                      | 43 / 43 (fine grid 127 / 127)                |
| Resampling matrix                | not measured (one unfiltered 2:1 decimation) | 50 / 50 through `afconvert`                  |
| Clipping evidence                | ±0.5, zero samples changed                   | four peak-relative severities with counts    |
| CLI `embed --alpha 0`            | exit 0, `detected: false`                    | exit 3, file kept, `failure: "not-detected"` |
| Verification target              | in-memory buffer                             | decoded saved file                           |
| Rejection trials                 | 3 (two unit tests, one CLI test)             | 585, 0 accepted                              |
| Detect time per 6 s              | 0.10 s                                       | 0.75 s                                       |

## 12. Detector v0.3: real audio

### 12.1 The problem

The demo page (`bun run demo`, added in the same release) failed on the first real file it was given, a
stereo 11.9 s music clip downloaded from file-examples.com. The clean,
uncropped file did not detect at the default strength. Diagnosis on that
file, left channel:

| Strength       | Watermark level (SNR) | Detected (v0.2 detector) | Score |
| -------------- | --------------------- | ------------------------ | ----- |
| 0.45 (default) | 22.4 dB               | no                       | 0.072 |
| 1.0            | 15.6 dB               | no                       | 0.129 |
| 2.0            | 10.1 dB               | yes                      | 0.221 |
| 4.0            | 5.0 dB                | yes                      | 0.317 |

The embedder delivered the same per-cell change on this file as on the
synthetic broadband fixture (0.62 versus 0.63 dB mean, sign agreement 85%
versus 96%), at the same watermark level (22.4 versus 23.6 dB SNR). The
difference was the host: its slot energies change by 8.1 dB RMS from one
frame to the next, against 2.8 dB for the synthetic fixture. The v0.2
whitening averaged over ±2 frames, so that change leaked into the residual
and buried the 0.6 dB watermark.

### 12.2 The change

Two detector-side changes; the embedding format is unchanged and v0.2 files
still detect:

- Whitening within the frame only (`WHITEN_FRAME_RADIUS` 2 to 0). Slots in
  one frame share the frame-to-frame level change, so a within-frame mean
  cancels it. The second stage (per-slot mean over the file) is kept; without
  it both synthetic fixtures reject.
- Inverse-variance weighting: each residual is divided by the mean squared
  residual over ±2 frames and ±3 slots, plus a floor of 10 dB². Cells inside
  transients count for less.

Spike results on the tuning file (left channel, alpha 0.45, sub-hop shift 0):

| Detector                          | Detected | Score                           | Weakest bit |
| --------------------------------- | -------- | ------------------------------- | ----------- |
| v0.2 (±2 frames, equal weights)   | no       | 0.072                           | 0.001       |
| within-frame whitening only       | no       | 0.109                           | 0.002       |
| within-frame + 1/σ weighting      | no       | 0.082 (with ±2 frame whitening) |             |
| within-frame + inverse variance   | yes      | 0.170                           | 0.071       |
| within-frame + sign correlator    | yes      | 0.140                           | 0.074       |
| within-frame + soft limiter ±2 dB | yes      | 0.144                           | 0.085       |

Inverse-variance weighting was chosen. Alternatives tried and rejected:
weighting alone with the old whitening (0.072 to 0.083, not enough);
whitening slot radius 2 or 5 (no better than 3); dropping the second
whitening stage (rejects the synthetic fixtures).

The variance floor was swept at 0.001, 0.1, 0.5, 2, 10, 30 and 100 dB². Real
files barely move (tuning file 0.157 at 2, 0.148 at 10, 0.137 at 100). The
synthetic tonal fixture, whose band is numerically empty, needs a floor: at
2 dB² it fails 12-bit requantization and the 44.1 to 16 kHz conversion; at
10 dB² both pass with margins of 0.017 and 0.156. 10 was chosen as the
smallest value that passes the required matrix.

### 12.3 Synthetic matrix with the v0.3 detector

`bun bench/acceptance.ts --tag final`, `bench/crop.ts`, `bench/attacks.ts`,
`bench/rejection.ts`, `bench/resample.ts`, `bench/masking.ts`, all with the
v0.3 detector. The v0.2 `*-baseline.json` files are kept as the v0.2.0
record; `bun bench/source-hash.ts v0.2.0` reproduces their hash.

| Measure                                               | v0.2 detector                            | v0.3 detector                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Required matrix (clean 40, WAV 40, gain 4, prefix 34) | all exact                                | all exact                                                                                                            |
| CI rejection set, 110 trials                          | 0 accepted                               | 0 accepted, max score 0.083                                                                                          |
| Bench rejection set, 475 trials                       | 0 accepted; sync-only 2, checksum-only 1 | 0 accepted; sync-only 0, checksum-only 2, max score 0.082                                                            |
| Prefix sweep, tonal, weakest bit (coarse)             | 0.052                                    | 0.162                                                                                                                |
| Prefix sweep, broadband, weakest bit                  | 0.085                                    | 0.082                                                                                                                |
| Excerpt grid, tonal, passes at every start            | 3 s                                      | 1 s (every cell passes)                                                                                              |
| Excerpt grid, broadband, passes at every start        | 3 s                                      | 2 s                                                                                                                  |
| Resampling, 5 conversions × 2 classes × 5 pairs       | 50 / 50                                  | 50 / 50                                                                                                              |
| Clipping at 0.7 of peak, tonal                        | reject                                   | exact                                                                                                                |
| Noise at 10 dB SNR, broadband                         | exact                                    | reject                                                                                                               |
| Silence inserted at 3.0 s, tonal / broadband          | reject / exact                           | exact / reject                                                                                                       |
| Masking and SNR (embedder unchanged)                  | unchanged                                | unchanged                                                                                                            |
| Detect time per 6 s, 8 steps                          | 0.75 s (idle machine)                    | 1.0 s (measured while five benchmark runs shared the machine; the variance estimate adds one pass over the residual) |
| Accepted wrong payloads, all synthetic runs           | 0                                        | 0                                                                                                                    |

Changes in the measured-limit set: broadband with 0.5 s of silence inserted
at 3.0 s now rejects (it recovered with v0.2 at a marginal score of 0.092);
the test became exact-or-reject. Tonal improves across the board (clean 6 s
score 0.227 to 0.29).

### 12.4 Real audio corpus

Nine files downloaded on 2026-09-11 into the gitignored `bench/corpus/real/`
with a manifest recording source and license: six from samplelib.com
(music at 3, 6, 9, 12 and 19 s; speech at 60 s; license page says "free to
use, do whatever you want with the files") and three from file-examples.com
(the same music track at 6, 12 and 30 s; stated free). All are 16-bit
44.1 kHz; the speech file is mono, the rest stereo. The 12 s file-examples
track is the file the detector was tuned on; the other eight are validation.
`bun bench/corpus.ts bench/corpus/real --tag real-baseline` (v0.2 detector,
source hash `24250988b8ea`) and `--tag real-final` (v0.3 detector).

Exact recoveries per case, v0.2 detector then v0.3 detector. Three seeded
pairs for clean and WAV round trip; the first pair for everything else.
Prefix removal runs only on files of 6 s or more. `-` means not run.

| File                              | Length | Clean         | WAV           | Gain          | Prefix           | Clip 0.9/0.7/0.5 | Noise 40/30/20 dB | 8-bit     | Excerpts ≤ 5 s   |
| --------------------------------- | ------ | ------------- | ------------- | ------------- | ---------------- | ---------------- | ----------------- | --------- | ---------------- |
| file-examples 1 MB (tuning track) | 5.9 s  | 0/3 → 3/3     | 0/3 → 3/3     | 0/2 → 2/2     | -                | 0/3 → 1/3        | 0/3 → 0/3         | 0/1 → 0/1 | 0/37 → 27/37     |
| file-examples 2 MB (tuning file)  | 11.9 s | 0/3 → 3/3     | 0/3 → 3/3     | 0/2 → 2/2     | 0/17 → 17/17     | 0/3 → 2/3        | 0/3 → 0/3         | 0/1 → 0/1 | 0/40 → 26/40     |
| file-examples 5 MB (tuning track) | 30.0 s | 0/3 → 3/3     | 0/3 → 3/3     | 0/2 → 2/2     | 0/17 → 17/17     | 0/3 → 3/3        | 0/3 → 0/3         | 0/1 → 0/1 | 0/40 → 23/40     |
| samplelib 12 s music              | 12.8 s | 3/3 → 3/3     | 3/3 → 3/3     | 2/2 → 2/2     | 17/17 → 17/17    | 3/3 → 3/3        | 3/3 → 3/3         | 1/1 → 0/1 | 20/40 → 2/40     |
| samplelib 15 s music              | 19.2 s | 3/3 → 3/3     | 3/3 → 3/3     | 2/2 → 2/2     | 17/17 → 17/17    | 3/3 → 3/3        | 3/3 → 3/3         | 1/1 → 1/1 | 6/40 → 5/40      |
| samplelib 3 s music               | 3.2 s  | 2/3 → 1/3     | 2/3 → 1/3     | 0/2 → 0/2     | -                | 0/3 → 0/3        | 0/3 → 0/3         | 1/1 → 0/1 | 2/14 → 1/14      |
| samplelib 6 s music               | 6.4 s  | 3/3 → 2/3     | 3/3 → 2/3     | 2/2 → 2/2     | 16/17 → 17/17    | 3/3 → 3/3        | 2/3 → 3/3         | 1/1 → 1/1 | 11/38 → 12/38    |
| samplelib 9 s music               | 9.6 s  | 3/3 → 3/3     | 3/3 → 3/3     | 2/2 → 2/2     | 17/17 → 17/17    | 3/3 → 3/3        | 2/3 → 1/3         | 1/1 → 0/1 | 13/40 → 6/40     |
| samplelib speech 1 min            | 60.0 s | 3/3 → 3/3     | 3/3 → 3/3     | 2/2 → 2/2     | 17/17 → 17/17    | 3/3 → 3/3        | 3/3 → 3/3         | 1/1 → 1/1 | 5/40 → 13/40     |
| **Totals**                        |        | 17/27 → 24/27 | 17/27 → 24/27 | 10/18 → 16/18 | 84/119 → 119/119 | 15/27 → 21/27    | 13/27 → 13/27     | 6/9 → 3/9 | 57/329 → 115/329 |

Lowest clean score over the three pairs, v0.2 → v0.3: file-examples 1 MB
0.073 → 0.133, 2 MB 0.079 → 0.146, 5 MB 0.086 → 0.139; samplelib 12 s
0.092 → 0.071, 15 s 0.096 → 0.105, 3 s 0.102 → 0.095, 6 s 0.102 → 0.096,
9 s 0.110 → 0.105, speech 0.089 → 0.109.

Excerpt passes by duration over all nine files, v0.2 → v0.3: 1 s 0/44 →
0/44; 1.5 s 0/44 → 4/44; 2 s 2/43 → 8/43; 2.5 s 5/42 → 13/42; 3 s 8/41 →
18/41; 3.5 s 9/40 → 20/40; 4 s 17/39 → 25/39; 5 s 16/36 → 27/36.

Reading: the file-examples track, which the v0.2 detector could not read at
all, now recovers cleanly at every length and survives prefix removal and
clipping; noise at 40 dB SNR and 8-bit requantization still defeat it. The
samplelib music, which v0.2 already read, is roughly unchanged on full
files but weaker on the 12 s file (score 0.092 → 0.071, excerpts 20 → 2)
and on 8-bit requantization (3 of 3 files → 1 of 3). Speech improves.
Real-audio excerpts under 3 s rarely recover with either detector.

Not attempted and worth trying next: run both whitening shapes and keep the
alignment with the higher sync score, so material that suits the old
±2-frame whitening keeps it. That doubles detection time and widens the
alignment search, so its false-acceptance behaviour would need the same
measurement as here.

The v0.2 baseline produced one accepted wrong payload: a 5 s excerpt at 0 s
of the 30 s file-examples track, embedded id `afaf43c0`, accepted id
`3f9b6080`, sync and checksum both valid, score 0.072, sub-hop shift 165.
This is a chance match of the 16 sync bits and the 8 checksum bits after a
search over 1200 alignments, on noise. It is the first accepted wrong
payload observed in this project, after 585 synthetic rejection trials and
about 600 real-audio trials. The v0.3 detector produced no
accepted wrong payload in the same 597 real-audio trials, nor in the 585
synthetic rejection trials, nor in any recovery trial in this report.
One observation in roughly 1200 real trials is a count. Reducing the
chance of such a match means a longer checksum, which changes the
embedding format and is out of scope for a detector-only change.

## 13. Remaining limitations

- **Small recorded-audio corpus.** Nine downloaded files were measured
  (section 12.4), including multiple lengths of the tuning track. Clean
  full-length recovery held on 24 of 27 trials. The three misses came from
  a 3.2 s and a 6.4 s music clip.
- **Short excerpts.** Recorded-audio excerpts under three seconds rarely
  recover. Results vary with the start position and are not monotonic in duration.
- **Edits can defeat recovery.** Noise at 40 dB SNR and 8-bit requantization
  defeat the watermark on the file-examples track. The v0.3 synthetic
  attack results are summarized in section 12.3; earlier results in this
  report describe the previous detector.
- **Detector tradeoffs.** Some samplelib excerpt and requantization results
  regressed with v0.3. The per-file table records both improvements and regressions.
- **False acceptance.** The v0.2 detector accepted one wrong payload on a
  five-second recorded-audio excerpt. None was observed with v0.3 in the
  reported synthetic and recorded-audio trials. These counts do not establish
  a false-acceptance rate for other audio.
- **Audibility.** The masking model is uncalibrated and exceeded in 2.8–6.7%
  of included cells. No listening test was performed.
- **Resampling.** Conversions were measured through one resampler at one quality setting.
- **Performance.** Detection searches eight sub-hop shifts. The v0.3 timing
  in section 12.3 was measured while other benchmarks were running, so it
  is not a controlled comparison with the earlier timing.
- **Authentication.** The checksum detects decoding errors. It does not
  establish authorship or prevent someone with the key from creating a watermark.
