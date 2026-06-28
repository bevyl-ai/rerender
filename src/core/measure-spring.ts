// measureSpring() — Remotion-compatible. The number of frames a spring takes to
// settle within `threshold` of its target.
import { spring, type SpringConfig } from './spring';

export function measureSpring({
  fps,
  config = {},
  from = 0,
  to = 1,
  threshold = 0.005,
}: {
  fps: number;
  config?: SpringConfig;
  from?: number;
  to?: number;
  threshold?: number;
}): number {
  const max = Math.ceil(fps * 10);
  for (let frame = 0; frame <= max; frame++) {
    if (Math.abs(spring({ frame, fps, config, from, to }) - to) < threshold) return frame;
  }
  return max;
}
