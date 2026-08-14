// interpolate(frame, [input], [output], opts) — Remotion-compatible animation math.
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
  const lo = inputRange[0];
  const hi = inputRange[n - 1];
  if (lo === undefined || hi === undefined) {
    throw new Error('interpolate: inputRange has a hole');
  }
  let x = input;
  if (x < lo && extrapolateLeft === 'clamp') x = lo;
  if (x > hi && extrapolateRight === 'clamp') x = hi;
  let i = 0;
  while (i < n - 2) {
    const next = inputRange[i + 1];
    if (next === undefined || x <= next) break;
    i++;
  }
  const inMin = inputRange[i];
  const inMax = inputRange[i + 1];
  const outMin = outputRange[i];
  const outMax = outputRange[i + 1];
  if (inMin === undefined || inMax === undefined || outMin === undefined || outMax === undefined) {
    throw new Error('interpolate: range hole');
  }
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
