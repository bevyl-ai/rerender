import { getVisualization } from './fft/get-visualization';
import { type OptimizeFor, type VisualizeAudioOptions } from './types';

// Memoize each single-frame pipeline result. Temporal smoothing reuses
// neighboring frames, so the [frame-1, frame, frame+1] windows of adjacent
// frames overlap heavily — caching turns 3 FFTs/frame into ~1 amortized.
const cache = new Map<string, number[]>();

function cachedFrame(
  options: VisualizeAudioOptions & { optimizeFor: OptimizeFor; dataOffsetInSeconds: number },
  frame: number,
): number[] {
  const { audioData, fps, numberOfSamples, optimizeFor, dataOffsetInSeconds } = options;
  const key =
    audioData.resultId + ':' + frame + ':' + fps + ':' + numberOfSamples + ':' + optimizeFor + ':' + dataOffsetInSeconds;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = getVisualization({
    audioData,
    frame,
    fps,
    numberOfSamples,
    optimizeFor,
    dataOffsetInSeconds,
  });
  cache.set(key, result);
  return result;
}

// visualizeAudio({ audioData, frame, fps, numberOfSamples, ... }) — Remotion-compatible.
// Returns `numberOfSamples` magnitudes (~[0, 1]) for the audio under the playhead.
export function visualizeAudio(options: VisualizeAudioOptions): number[] {
  const {
    audioData,
    frame,
    fps,
    numberOfSamples,
    smoothing = true,
    // Remotion v4 defaults to 'accuracy' (v5 to 'speed'); match the pinned v4.
    optimizeFor = 'accuracy',
    dataOffsetInSeconds = 0,
  } = options;

  const resolved = {
    audioData,
    frame,
    fps,
    numberOfSamples,
    optimizeFor,
    dataOffsetInSeconds,
  };

  if (!smoothing) return cachedFrame(resolved, frame);

  // 8. Temporal smoothing: mean of the previous, current, and next frames.
  const prev = cachedFrame(resolved, frame - 1);
  const cur = cachedFrame(resolved, frame);
  const next = cachedFrame(resolved, frame + 1);
  const out = new Array<number>(numberOfSamples);
  for (let i = 0; i < numberOfSamples; i++) {
    out[i] = (prev[i]! + cur[i]! + next[i]!) / 3;
  }
  return out;
}
