import { add, type Complex, mul, sub } from './complex';
import { exponent } from './exponent';

// Recursive radix-2 decimation-in-time FFT (node-fft's accuracy path). Input is
// an array of real samples; output is `sampleSize` complex bins. Length must be
// a power of two.
export function fftAccurate(samples: ArrayLike<number>): Complex[] {
  const n = samples.length;
  if (n === 1) return [[samples[0]!, 0]];

  const even: number[] = [];
  const odd: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) even.push(samples[i]!);
    else odd.push(samples[i]!);
  }

  const evenT = fftAccurate(even);
  const oddT = fftAccurate(odd);

  const out: Complex[] = new Array<Complex>(n);
  const half = n / 2;
  for (let k = 0; k < half; k++) {
    const ek = evenT[k]!;
    const ok = oddT[k]!;
    const [c, s] = exponent(k, n);
    // W_k = [cos(-2πk/N), sin(-2πk/N)] = [c, s] from exponent().
    const wk: Complex = [c, s];
    const wko = mul(wk, ok);
    out[k] = add(ek, wko);
    out[k + half] = sub(ek, wko);
  }
  return out;
}
