// Public types for the @remotion/media-utils drop-in. Shapes match Remotion's
// so existing compositions consuming AudioData / visualizeAudio run unchanged.

/** Decoded audio, one Float32Array of samples per channel. */
export interface AudioData {
  channelWaveforms: Float32Array[];
  sampleRate: number;
  numberOfChannels: number;
  durationInSeconds: number;
  resultId: string;
  isRemote: boolean;
}

/** Which FFT path visualizeAudio() takes — speed (windowed, iterative) or accuracy (recursive). */
export type OptimizeFor = 'accuracy' | 'speed';

export interface VisualizeAudioOptions {
  audioData: AudioData;
  frame: number;
  fps: number;
  numberOfSamples: number;
  /** Average across [frame-1, frame, frame+1] to steady the bars. Default true. */
  smoothing?: boolean;
  optimizeFor?: OptimizeFor;
  /** Shift the sampling window earlier in the track, in seconds. Default 0. */
  dataOffsetInSeconds?: number;
}
