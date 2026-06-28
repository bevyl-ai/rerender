// Map a float sample in [-1, 1] onto the asymmetric Int16 range, matching
// node-fft / @remotion/media-utils exactly (positive scales by 0x7FFF, negative by 0x8000).
export function toInt16(x: number): number {
  return x > 0 ? x * 0x7fff : x * 0x8000;
}
