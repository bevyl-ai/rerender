import { spring, type SpringConfig } from '../../core/spring';
import type { TransitionTiming } from '../types';

/** A spring-driven transition. Duration is derived from when the spring settles
 *  unless an explicit `durationInFrames` is given. */
export function springTiming({
  config,
  durationInFrames,
  durationRestThreshold = 0.005,
  reverse = false,
}: {
  config?: SpringConfig;
  durationInFrames?: number;
  durationRestThreshold?: number;
  reverse?: boolean;
} = {}): TransitionTiming {
  return {
    getDurationInFrames: ({ fps }): number => {
      if (durationInFrames !== undefined) return durationInFrames;
      const cap = Math.ceil(10 * fps);
      for (let n = 1; n <= cap; n++) {
        if (spring({ frame: n, fps, config, from: 0, to: 1 }) >= 1 - durationRestThreshold) {
          return n;
        }
      }
      return cap;
    },
    getProgress: ({ frame, fps }): number => {
      const v = spring({ frame, fps, config, from: 0, to: 1 });
      return reverse ? 1 - v : v;
    },
  };
}
