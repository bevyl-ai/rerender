// Complex arithmetic on [re, im] pairs, used by the FFT butterflies.
export type Complex = [number, number];

export function add(a: Complex, b: Complex): Complex {
  return [a[0] + b[0], a[1] + b[1]];
}

export function sub(a: Complex, b: Complex): Complex {
  return [a[0] - b[0], a[1] - b[1]];
}

export function mul(a: Complex, b: Complex): Complex {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

export function magnitude(a: Complex): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1]);
}
