// Shared filmstrip geometry and painting, so the scrubber and the two race strips are literally
// the same rendering code and only the extraction engine differs.

export const STRIP_H = 76;
export const TARGET_SLOT_W = 88;

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
export function nearestIndex(times: readonly number[], micros: number): number {
  let best = 0;
  for (let i = 1; i < times.length; i++) {
    if (Math.abs(times[i]! * 1e6 - micros) < Math.abs(times[best]! * 1e6 - micros)) best = i;
  }
  return best;
}
