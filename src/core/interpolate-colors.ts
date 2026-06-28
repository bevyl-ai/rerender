// interpolateColors() — Remotion-compatible. Maps an input value across CSS color
// stops, returning an `rgba(...)` string. Supports hex (#rgb/#rgba/#rrggbb/#rrggbbaa)
// and rgb()/rgba(). Clamps at the ends (Remotion's default for colors).
import { interpolate } from './interpolate';

type RGBA = [number, number, number, number];

function parseColor(input: string): RGBA {
  const c = input.trim();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    const expand = (s: string): string => s.split('').map((ch) => ch + ch).join('');
    const full = hex.length === 3 || hex.length === 4 ? expand(hex) : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }
  const m = c.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1]!.split(/[,/]/).map((p) => p.trim());
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    const a = parts[3] === undefined ? 1 : Number(parts[3]);
    return [r, g, b, a];
  }
  throw new Error(`interpolateColors: cannot parse color "${input}"`);
}

export function interpolateColors(
  input: number,
  inputRange: number[],
  outputRange: string[],
  options?: { easing?: (t: number) => number },
): string {
  const colors = outputRange.map(parseColor);
  const channel = (i: 0 | 1 | 2 | 3): number =>
    interpolate(input, inputRange, colors.map((c) => c[i]), {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: options?.easing,
    });
  const r = Math.round(channel(0));
  const g = Math.round(channel(1));
  const b = Math.round(channel(2));
  const a = channel(3);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
