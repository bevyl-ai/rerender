// Shared filmstrip geometry and painting, so the scrubber and the two race strips are literally
// the same rendering code and only the extraction engine differs.

export const STRIP_H = 76;
/** Roughly how wide each thumbnail wants to be; the count falls out of the track's width. */
const TARGET_SLOT_W = 88;

export interface StripLayout {
  ctx: CanvasRenderingContext2D;
  count: number;
  slot: number;
}

/** Sizes the canvas for `width` CSS px and returns everything paintThumb needs. Clears the canvas. */
export function prepareStrip(canvas: HTMLCanvasElement, width: number, count?: number): StripLayout | null {
  const slots = count ?? Math.max(1, Math.round(width / TARGET_SLOT_W));
  const slot = width / slots;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(STRIP_H * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  return { ctx, count: slots, slot };
}

/** Centre-crops the frame to the slot's aspect, so the strip reads as a ribbon of film rather than
 *  a row of letterboxes. The crop comes off the frame's own size: the hero scrubber and the
 *  head-to-head run different renditions (854x362 and 228x96) through this same code. */
export function paintThumb(layout: StripLayout, frame: VideoFrame, index: number): void {
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  const sourceW = Math.min(width, height * (layout.slot / STRIP_H));
  layout.ctx.drawImage(frame, (width - sourceW) / 2, 0, sourceW, height, index * layout.slot, 0, layout.slot, STRIP_H);
}

/** N timestamps evenly spaced across a window, at slot centres. */
export function stripTimestamps(count: number, start: number, span: number): number[] {
  return Array.from({ length: count }, (_, i) => start + ((i + 0.5) / count) * span);
}

/** Index of the requested timestamp nearest a delivered frame's presentation time (µs). */
/**
 * Which strip slot a decoded frame belongs in, for engines whose API hands back a frame without
 * saying which request produced it.
 *
 * `taken` makes the assignment a bijection. Nearest-by-time alone can map two decoded frames to the
 * same slot — a decoder that snaps to a slightly different sample than the slot's ideal time is
 * enough — and the loser silently overwrites the winner, leaving some other slot blank. That is a
 * bug in the harness, not in the engine being measured, and it made one of twelve thumbnails
 * disappear from the comparison strip.
 */
export function nearestIndex(times: readonly number[], micros: number, taken?: Set<number>): number {
  let best = -1;
  for (let i = 0; i < times.length; i++) {
    if (taken?.has(i)) continue;
    if (best < 0 || Math.abs(times[i]! * 1e6 - micros) < Math.abs(times[best]! * 1e6 - micros)) best = i;
  }
  // Every slot taken already: fall back to plain nearest rather than dropping the frame.
  if (best < 0) return nearestIndex(times, micros);
  taken?.add(best);
  return best;
}
