import { type Complex, magnitude } from './complex';

// Magnitude of a complex bin. Kept as its own export to mirror node-fft's `mag`.
export function mag(bin: Complex): number {
  return magnitude(bin);
}
