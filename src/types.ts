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

export interface DetectionResult {
  detected: boolean;
  payload: bigint | null;
  confidence: number;
  bitErrorEstimate: number;
  band: Band;
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
