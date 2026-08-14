// interpolate(frame, [input], [output], opts) — Remotion-compatible animation math.
import { must } from './must';
export type Extrapolate = 'clamp' | 'extend';
export interface InterpolateOptions {
  extrapolateLeft?: Extrapolate | undefined;
  extrapolateRight?: Extrapolate | undefined;
  easing?: ((t: number) => number) | undefined;
}

export function interpolate(input: number, inputRange: number[], outputRange: number[], options: InterpolateOptions = {}): number {
  const { extrapolateLeft = 'clamp', extrapolateRight = 'clamp', easing } = options;
  const n = inputRange.length;
  if (n < 2 || n !== outputRange.length) {
    throw new Error('interpolate: ranges must be equal length >= 2');
  }
  let x = input;
  if (x < must(inputRange[0]) && extrapolateLeft === 'clamp') x = must(inputRange[0]);
  if (x > must(inputRange[n - 1]) && extrapolateRight === 'clamp') x = must(inputRange[n - 1]);
  let i = 0;
  while (i < n - 2 && x > must(inputRange[i + 1])) i++;
  const inMin = must(inputRange[i]);
  const inMax = must(inputRange[i + 1]);
  const outMin = must(outputRange[i]);
  const outMax = must(outputRange[i + 1]);
  let t = inMax === inMin ? 0 : (x - inMin) / (inMax - inMin);
  if (easing) t = easing(t);
  return outMin + (outMax - outMin) * t;
}

/** A small Easing set matching the names Remotion exposes. */
export const Easing = {
  linear: (t: number): number => t,
  ease: (t: number): number => t * t * (3 - 2 * t),
  in: (t: number): number => t * t,
  out: (t: number): number => 1 - (1 - t) * (1 - t),
  inOut: (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  cubicOut: (t: number): number => 1 - (1 - t) ** 3,
};
