/** The tunable geometry and strength of the perceptual watermarker. */
export interface PerceptualConfig {
  hopSeconds: number;
  windowSeconds: number;
  lowHz: number;
  highHz: number;
  slots: number;
  blockSeconds: number;
  payloadBits: number;
  alpha: number;
  /**
   * The number of sub-hop shifts that detection searches.
   *
   * The embedder places its chips on a frame grid. When a signal loses a
   * prefix that is not a whole number of hops, the detector's grid falls
   * between the embedder's frames and the correlation weakens. Detection
   * analyses the signal at `alignmentSteps` shifts, spaced `hop / alignmentSteps`
   * samples apart, and keeps the shift with the best sync agreement. A value
   * of 1 searches the block alignment only.
   *
   * The default of 8 leaves at most `hop / 16` samples of misalignment. At
   * 44.1 kHz that is 28 samples, or 0.6 ms. Detection time grows in
   * proportion to this value, about 0.1 s per step for six seconds of
   * 44.1 kHz audio on an Apple M-series laptop.
   */
  alignmentSteps: number;
}

export const DEFAULT_CONFIG: PerceptualConfig = {
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

export const DEFAULT_KEY = 'waverune';
