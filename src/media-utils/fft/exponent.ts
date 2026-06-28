// Twiddle factor W_N^k = e^(-2πik/N), as a [re, im] pair. Memoized per (k, N)
// since the recursive FFT asks for the same factors repeatedly.
const cache = new Map<string, readonly [number, number]>();

export function exponent(k: number, n: number): readonly [number, number] {
  const key = k + ':' + n;
  const cached = cache.get(key);
  if (cached) return cached;
  const x = (-2 * Math.PI * k) / n;
  const value: readonly [number, number] = [Math.cos(x), Math.sin(x)];
  cache.set(key, value);
  return value;
}
