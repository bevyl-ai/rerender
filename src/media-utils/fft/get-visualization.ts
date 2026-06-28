import { type AudioData, type OptimizeFor } from '../types';
import { type Complex } from './complex';
import { fftAccurate } from './fft-accurate';
import { fftFast } from './fft-fast';
import { mag } from './mag';
import { getMaxIntValue } from './max-value-cached';
import { smooth } from './smoothing';
import { toInt16 } from './to-int-16';

interface VisualizationParams {
  audioData: AudioData;
  frame: number;
  fps: number;
  numberOfSamples: number;
  optimizeFor: OptimizeFor;
  dataOffsetInSeconds: number;
}

// Steps 1–7 of visualizeAudio for a single frame: window channel 0, FFT it,
// take the magnitude spectrum, spectrally smooth, and normalize to ~[0, 1].
export function getVisualization(params: VisualizationParams): number[] {
  const { audioData, frame, fps, numberOfSamples, optimizeFor, dataOffsetInSeconds } = params;

  // 1. Channel 0 only. sampleSize is twice the bins so the spectrum's first
  //    half yields exactly numberOfSamples values.
  const data = audioData.channelWaveforms[0];
  const sampleSize = numberOfSamples * 2;
  if (!data) return new Array<number>(numberOfSamples).fill(0);

  // 2. Center the window on the playhead, clamped to the start of the track.
  const start = Math.floor((frame / fps - dataOffsetInSeconds) * audioData.sampleRate);
  const actualStart = Math.max(0, start - sampleSize / 2);

  // 3. Convert windowed floats to Int16; any tail past the end stays 0.
  const windowed = new Int16Array(sampleSize);
  const slice = data.subarray(actualStart, actualStart + sampleSize);
  for (let i = 0; i < slice.length; i++) {
    windowed[i] = toInt16(slice[i]!);
  }

  // 4. FFT.
  const transform: Complex[] =
    optimizeFor === 'accuracy' ? fftAccurate(windowed) : fftFast(windowed);

  // 5. Magnitude of the first half (numberOfSamples bins).
  const half = sampleSize / 2;
  const magnitudes = new Array<number>(half);
  for (let i = 0; i < half; i++) {
    magnitudes[i] = mag(transform[i]!);
  }

  // 6. Spectral smoothing (always).
  const smoothed = smooth(magnitudes);

  // 7. Normalize: magnitude / (sampleSize/2) / maxInt (Remotion's exact formula).
  const maxInt = getMaxIntValue(audioData);
  const out = new Array<number>(numberOfSamples);
  for (let i = 0; i < numberOfSamples; i++) {
    out[i] = smoothed[i]! / half / maxInt;
  }
  return out;
}
