// The progressive index: one flat sample table for the whole file, read once from the moov.
//
// This is the shape with the most to offer, because it knows every sample's offset and size before
// it fetches anything: it can end a read at the wanted sample instead of at the end of the GOP,
// which on a filmstrip is most of the bytes.

import type { RunSample } from './decode';
import { ExtractError } from './errors';
import { type FrameIndex, type IndexAdapter, lastAtOrBefore } from './frame-index';
import { parseSampleTable } from './mp4-sample-table';

const MICROSECONDS_PER_SECOND = 1_000_000;

function tableNumber(arr: ArrayLike<number>, i: number, what: string): number {
  const value = arr[i];
  if (value === undefined) throw new ExtractError('malformed', `moov index: ${what} ${i} is missing`);
  return value;
}

export const moovIndexAdapter: IndexAdapter = {
  kind: 'moov',
  claims: (config) => !config.fragmented,
  open: async (_source, moovBytes, config) => {
    const table = parseSampleTable(moovBytes);
    const { presentationTicks, byteOffsets, byteSizes, keySampleIndices, timescale } = table;

    const gopStartTicks = new Float64Array(keySampleIndices.length);
    for (let i = 0; i < keySampleIndices.length; i++) {
      gopStartTicks[i] = tableNumber(presentationTicks, tableNumber(keySampleIndices, i, 'key sample'), 'presentation tick');
    }
    // Max presentation tick, not the last decode-order sample: with B-frames the file's final
    // decoded sample presents *before* the last displayed frame, and clamping to it would resolve
    // past-end requests to the second-to-last displayed frame.
    const lastTicks = presentationTicks.reduce((max, ticks) => Math.max(max, ticks), 0);
    const toMicros = (ticks: number) => Math.round((ticks / timescale) * MICROSECONDS_PER_SECOND);

    const nearestSampleInGop = (gopIndex: number, targetTicks: number): number => {
      const first = tableNumber(keySampleIndices, gopIndex, 'key sample');
      const end = gopIndex + 1 < keySampleIndices.length ? tableNumber(keySampleIndices, gopIndex + 1, 'key sample') : table.sampleCount;
      let best = first;
      for (let i = first; i < end; i++) {
        const ticks = tableNumber(presentationTicks, i, 'presentation tick');
        const bestTicks = tableNumber(presentationTicks, best, 'presentation tick');
        if (Math.abs(ticks - targetTicks) < Math.abs(bestTicks - targetTicks)) best = i;
      }
      return best;
    };

    /** Deepest sample any of these targets needs. Samples are fed in decode order and every
     *  reference precedes its dependents there, so nothing past it can be needed to decode it. */
    const deepestFor = (gopIndex: number, targetTicks: readonly number[]): number => {
      const first = tableNumber(keySampleIndices, gopIndex, 'key sample');
      return targetTicks.reduce((deepest, ticks) => Math.max(deepest, nearestSampleInGop(gopIndex, ticks)), first);
    };

    const firstGopTicks = gopStartTicks[0];
    if (firstGopTicks === undefined) throw new ExtractError('malformed', 'moov index: no key samples');

    const index: FrameIndex = {
      kind: 'moov',
      config,
      sampleTable: table,
      durationSeconds: lastTicks / timescale,
      gopStartTicks,
      clampTicks: (seconds) => Math.min(Math.max(Math.round(seconds * timescale), firstGopTicks), lastTicks),
      snapMicros: (targetTicks) =>
        toMicros(
          tableNumber(presentationTicks, nearestSampleInGop(lastAtOrBefore(gopStartTicks, targetTicks), targetTicks), 'presentation tick'),
        ),
      planRead: (gopIndex, targetTicks) => {
        const first = tableNumber(keySampleIndices, gopIndex, 'key sample');
        const last = deepestFor(gopIndex, targetTicks);
        return {
          start: tableNumber(byteOffsets, first, 'byte offset'),
          end: tableNumber(byteOffsets, last, 'byte offset') + tableNumber(byteSizes, last, 'byte size'),
        };
      },
      resolve: (gopIndex, targetTicks) => {
        const first = tableNumber(keySampleIndices, gopIndex, 'key sample');
        const end = deepestFor(gopIndex, targetTicks) + 1;
        const run: RunSample[] = [];
        for (let i = first; i < end; i++) {
          run.push({
            presentationMicros: toMicros(tableNumber(presentationTicks, i, 'presentation tick')),
            byteOffset: tableNumber(byteOffsets, i, 'byte offset'),
            byteSize: tableNumber(byteSizes, i, 'byte size'),
          });
        }
        return {
          run,
          micros: targetTicks.map((ticks) =>
            toMicros(tableNumber(presentationTicks, nearestSampleInGop(gopIndex, ticks), 'presentation tick')),
          ),
        };
      },
    };
    return index;
  },
};
