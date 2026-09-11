# How WaveRune works

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
   removes the host spectrum by whitening each frame against its own slots
   (and each slot against its mean over the file), weights every cell by the
   inverse of its local residual power so transients count for less, and
   correlates the result against the keyed sequence for every block
   alignment and for eight sub-hop sample shifts. It keeps the alignment
   that agrees best with the sync pattern. The detector needs the key only.
   It does not need the original audio.
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
  [0, 0.5]. Scores depend on the recording and detector version.
  Unmarked audio scores about 0.05, with a maximum of 0.083 observed over
  585 synthetic rejection trials. Digital silence scores 0. The score is not a
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
rejects; see the [reliability report](reliability-report.md#124-real-audio-corpus). A buffer with no channels, channels of
different lengths, or a non-positive sample rate throws `WatermarkingError`.
A zero-length channel is valid input and behaves as silence.

### Sample-rate limit

The band clamps below 0.95 of the Nyquist frequency, so the full 500 to
5000 Hz band needs a sample rate of about 10.5 kHz or more on both sides.
`result.band` reports the band that detection used.

## Further reading

- [API reference](api.md) for configuration and result types.
- [Reliability report](reliability-report.md) for benchmarks and known limitations.
- [Project overview](../README.md) for installation and examples.
