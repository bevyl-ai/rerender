// staticFile() — Remotion-compatible. Resolves a public asset path to its URL.
export function staticFile(path: string): string {
  if (path.startsWith('/') || path.startsWith('http')) return path;
  return '/' + path;
}

// random() — deterministic [0,1) keyed on a seed, à la Remotion's random().
export function random(seed: string | number | null): number {
  if (seed === null) return Math.random();
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}
