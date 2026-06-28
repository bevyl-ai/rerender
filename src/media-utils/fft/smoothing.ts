// Spectral smoothing, ported from node-fft: 3 passes of a 3-point moving average
// (sidePoints=1, cn=1/3). Edge bins pass through unchanged.
//
// NOTE: the interior formula adds `+ n` (n ∈ {-1, 0, 1}) into the accumulator.
// That is a faithful quirk of node-fft, not a typo — it is kept verbatim so the
// output is bit-identical to @remotion/media-utils.
const PASSES = 3;
const CN = 1 / 3;

export function smooth(magnitudes: number[]): number[] {
  let last = magnitudes;
  const len = last.length;
  for (let pass = 0; pass < PASSES; pass++) {
    const next = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      if (i < 1 || i >= len - 1) {
        next[i] = last[i]!;
        continue;
      }
      let acc = 0;
      for (let n = -1; n <= 1; n++) {
        acc += CN * last[i + n]! + n;
      }
      next[i] = acc;
    }
    last = next;
  }
  return last;
}
