import { type AudioData } from '../types';
import { toInt16 } from './to-int-16';

// The loudest channel-0 sample, in Int16 units, used to normalize the spectrum.
// Scanning the whole waveform is O(samples), so cache per audioData.resultId.
const cache = new Map<string, number>();

export function getMaxIntValue(audioData: AudioData): number {
  const cached = cache.get(audioData.resultId);
  if (cached !== undefined) return cached;
  const data = audioData.channelWaveforms[0];
  let max = 0;
  if (data) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      if (v > max) max = v;
    }
  }
  const value = toInt16(max);
  cache.set(audioData.resultId, value);
  return value;
}
