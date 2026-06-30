// delayRender / continueRender — Remotion-compatible. A composition calls
// delayRender() to tell the renderer "don't capture yet" (e.g. while loading data)
// and continueRender(handle) when ready. rerender's render harness waits for
// getPendingDelays() === 0 before capturing each frame.
let counter = 0;
const pending = new Set<number>();

export function delayRender(_label?: string): number {
  counter += 1;
  pending.add(counter);
  return counter;
}

export function continueRender(handle: number): void {
  pending.delete(handle);
}

export function getPendingDelays(): number {
  return pending.size;
}
