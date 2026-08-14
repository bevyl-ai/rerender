// staticFile() — Remotion-compatible. Resolves a public asset path to its URL.
export function staticFile(path: string): string {
  if (path.startsWith('/') || path.startsWith('http')) return path;
  return `/${path}`;
}

// random() — deterministic [0,1) keyed on a seed. Byte-for-byte Remotion's algorithm
// (mulberry32 over a hashed string / scaled number), so the same seed produces the same
// value as a Remotion render — i.e. renders are reproducible across the two engines.
function mulberry32(a: number): number {
  let t = a + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // to 32-bit int
  }
  return hash;
}

export function random(seed: string | number | null): number {
  if (seed === null) return Math.random();
  if (typeof seed === 'string') return mulberry32(hashCode(seed));
  return mulberry32(seed * 10000000000);
}
