// measureSpring() — a faithful port of Remotion's measure-spring.js. Returns how
// many frames a spring takes to settle within `threshold` AND stay settled for 20
// frames. Uses springCalculation directly (no circular through spring()).
import { springCalculation, type SpringConfig } from './spring';

export function measureSpring({ fps, config = {}, threshold = 0.005 }: { fps: number; config?: SpringConfig; threshold?: number }): number {
  if (threshold === 0) return Number.POSITIVE_INFINITY;
  if (threshold === 1) return 0;

  const diff = (frame: number): number => Math.abs(springCalculation(frame, fps, config) - 1);
  let frame = 0;
  const cap = fps * 1000; // safety bound for non-settling configs
  while (diff(frame) >= threshold && frame < cap) frame++;

  // Springs are bouncy — keep going until it stays under the threshold for 20 frames.
  let finishedFrame = frame;
  for (let i = 0; i < 20; i++) {
    frame++;
    if (diff(frame) >= threshold) {
      i = 0;
      finishedFrame = frame + 1;
    }
  }
  return finishedFrame;
}
