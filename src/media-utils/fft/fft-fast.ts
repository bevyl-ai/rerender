import type { Complex } from './complex';

// Iterative radix-2 FFT (the speed path). The input is first multiplied by a
// Hamming window to suppress spectral leakage, then transformed in place with
// bit-reversal addressing and butterfly stages. Length must be a power of two.
export function fftFast(samples: ArrayLike<number>): Complex[] {
  const n = samples.length;

  // Apply the Hamming window: w[i] = 0.8 - 0.46 * cos(2πi/(N-1)).
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.8 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = samples[i]! * w;
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }

  // Butterfly stages.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let start = 0; start < n; start += len) {
      let curRe = 1;
      let curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = start + k + half;
        const uRe = re[a]!;
        const uIm = im[a]!;
        const vRe = re[b]! * curRe - im[b]! * curIm;
        const vIm = re[b]! * curIm + im[b]! * curRe;
        re[a] = uRe + vRe;
        im[a] = uIm + vIm;
        re[b] = uRe - vRe;
        im[b] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  const out: Complex[] = new Array<Complex>(n);
  for (let i = 0; i < n; i++) out[i] = [re[i]!, im[i]!];
  return out;
}
