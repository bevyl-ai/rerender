// spring() — a faithful port of Remotion's spring (dist/cjs/spring/spring-utils.js).
// It is NOT a closed-form: Remotion integrates frame-by-frame, using the underdamped
// solution for ζ<1 and the critically-damped solution for ζ≥1 (yes, even when
// overdamped). A single analytic eval diverges from this for non-default configs
// (e.g. damping:100 mass:0.5), so we replicate the stepping exactly.
import { measureSpring } from './measure-spring';

export interface SpringConfig {
  damping?: number | undefined;
  mass?: number | undefined;
  stiffness?: number | undefined;
  overshootClamping?: boolean | undefined;
}

const DEFAULT = { damping: 10, mass: 1, stiffness: 100, overshootClamping: false };

interface State {
  lastTimestamp: number;
  current: number;
  toValue: number;
  velocity: number;
}

function advance(a: State, now: number, c: number, m: number, k: number): State {
  const deltaTime = Math.min(now - a.lastTimestamp, 64);
  const v0 = -a.velocity;
  const x0 = a.toValue - a.current;
  const zeta = c / (2 * Math.sqrt(k * m));
  const omega0 = Math.sqrt(k / m);
  const omega1 = omega0 * Math.sqrt(1 - zeta ** 2);
  const t = deltaTime / 1000;
  const sin1 = Math.sin(omega1 * t);
  const cos1 = Math.cos(omega1 * t);

  const underEnv = Math.exp(-zeta * omega0 * t);
  const underFrag = underEnv * (sin1 * ((v0 + zeta * omega0 * x0) / omega1) + x0 * cos1);
  const underPos = a.toValue - underFrag;
  const underVel = zeta * omega0 * underFrag - underEnv * (cos1 * (v0 + zeta * omega0 * x0) - omega1 * x0 * sin1);

  const critEnv = Math.exp(-omega0 * t);
  const critPos = a.toValue - critEnv * (x0 + (v0 + omega0 * x0) * t);
  const critVel = critEnv * (v0 * (t * omega0 - 1) + t * x0 * omega0 * omega0);

  return {
    toValue: a.toValue,
    lastTimestamp: now,
    current: zeta < 1 ? underPos : critPos,
    velocity: zeta < 1 ? underVel : critVel,
  };
}

/** The raw 0→1 spring value at `frame`, integrated step-by-step like Remotion. */
export function springCalculation(frame: number, fps: number, config: SpringConfig = {}): number {
  const c = config.damping ?? DEFAULT.damping;
  const m = config.mass ?? DEFAULT.mass;
  const k = config.stiffness ?? DEFAULT.stiffness;
  let a: State = { lastTimestamp: 0, current: 0, toValue: 1, velocity: 0 };
  const frameClamped = Math.max(0, frame);
  const unevenRest = frameClamped % 1;
  for (let f = 0; f <= Math.floor(frameClamped); f++) {
    if (f === Math.floor(frameClamped)) f += unevenRest;
    a = advance(a, (f / fps) * 1000, c, m, k);
  }
  return a.current;
}

export function spring({
  frame,
  fps,
  config = {},
  from = 0,
  to = 1,
  durationInFrames,
  durationRestThreshold,
  delay = 0,
  reverse = false,
}: {
  frame: number;
  fps: number;
  config?: SpringConfig | undefined;
  from?: number | undefined;
  to?: number | undefined;
  durationInFrames?: number | undefined;
  durationRestThreshold?: number | undefined;
  delay?: number | undefined;
  reverse?: boolean | undefined;
}): number {
  const { overshootClamping } = { ...DEFAULT, ...config };
  // When a duration is requested, scale time by the spring's natural duration.
  const needsNatural = reverse || durationInFrames !== undefined;
  const natural = needsNatural ? measureSpring({ fps, config, threshold: durationRestThreshold }) : 0;
  const reverseProcessed = reverse ? (durationInFrames ?? natural) - frame : frame;
  const delayProcessed = reverseProcessed + (reverse ? delay : -delay);
  const durationProcessed = durationInFrames === undefined ? delayProcessed : delayProcessed / (durationInFrames / natural);
  if (durationInFrames !== undefined && delayProcessed > durationInFrames) return to;

  const current = springCalculation(durationProcessed, fps, config);
  const inner = overshootClamping ? (to >= from ? Math.min(current, to) : Math.max(current, to)) : current;
  return from === 0 && to === 1 ? inner : from + (to - from) * inner;
}
