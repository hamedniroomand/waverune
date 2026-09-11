export interface AudioBuffer {
  sampleRate: number;
  channels: Float32Array[];
}

export interface EmbedOptions {
  key?: string;
  payload?: bigint;
  alpha?: number;
}

export interface DetectOptions {
  key?: string;
  payloadBits?: number;
}

export interface Band {
  lowHz: number;
  highHz: number;
}

/**
 * The intermediate values behind one detection decision.
 *
 * Every field is diagnostic data. None of them changes the acceptance rule,
 * and none of them replaces `DetectionResult.detected`.
 */
export interface DetectionDiagnostics {
  /** The 16 decoded sync bits equal the sync pattern at the selected alignment. */
  syncValid: boolean;
  /** The 8 decoded checksum bits equal the checksum of the decoded payload bits. */
  checksumValid: boolean;
  /**
   * The payload bits as decoded at the selected alignment, valid or not.
   * On a rejected block this value is noise, not a payload.
   */
  candidatePayload: bigint;
  /** The selected block alignment, in frames, from 0 to `blockFrames - 1`. */
  blockOffset: number;
  /** The selected sub-hop shift, in samples, from 0 to `hop - 1`. */
  sampleShift: number;
  /** The number of frames that passed the energy gate at the selected shift. */
  activeFrames: number;
  /** The number of frames in the analysis, including gated frames. */
  totalFrames: number;
  /** The mean absolute per-bit correlation over all block bits, from 0 to 1. */
  meanCorrelation: number;
  /** The smallest absolute per-bit correlation over all block bits, from 0 to 1. */
  minCorrelation: number;
  /** The index of the channel that produced this result. */
  channel: number;
}

export interface DetectionResult {
  /**
   * The acceptance decision. The sync bits and the checksum both validated
   * on the same channel at the same alignment.
   */
  detected: boolean;
  /** The recovered payload. Always `null` when `detected` is `false`. */
  payload: bigint | null;
  /**
   * The correlation strength, `mean / (1 + mean)` of the mean absolute per-bit
   * correlation. Each per-bit correlation lies in [-1, 1], so this score lies
   * in [0, 0.5]. It is not a probability, and it has no part in acceptance.
   */
  correlationScore: number;
  /**
   * The fraction of the 16 sync bits that decoded incorrectly at the selected
   * alignment. The alignment search picks the alignment that agrees best with
   * the sync pattern, so this value is biased toward zero. It is not the
   * payload bit error rate, and it is not a limit on that rate.
   */
  syncErrorRate: number;
  band: Band;
  diagnostics: DetectionDiagnostics;
}

export interface Watermarker {
  applyWatermark(audio: AudioBuffer, opts?: EmbedOptions): AudioBuffer;
  getWatermark(audio: AudioBuffer, opts?: DetectOptions): DetectionResult;
}

export class WatermarkingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatermarkingError';
  }
}
