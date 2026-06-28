import { interpolate } from '../../core/interpolate';
import type { TransitionTiming } from '../types';

/** A fixed-length transition with a linear (or eased) 0..1 progress curve. */
export function linearTiming({
  durationInFrames,
  easing,
}: {
  durationInFrames: number;
  easing?: (t: number) => number;
}): TransitionTiming {
  return {
    getDurationInFrames: (): number => durationInFrames,
    getProgress: ({ frame }): number =>
      interpolate(frame, [0, durationInFrames], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing,
      }),
  };
}
