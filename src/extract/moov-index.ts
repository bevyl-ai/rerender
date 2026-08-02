// The progressive index: one flat sample table for the whole file, read once from the moov.
//
// This is the shape with the most to offer, because it knows every sample's offset and size before
// it fetches anything: it can end a read at the wanted sample instead of at the end of the GOP,
// which on a filmstrip is most of the bytes.

import type { RunSample } from './decode';
import { type FrameIndex, type IndexAdapter, lastAtOrBefore } from './frame-index';
import { parseSampleTable } from './mp4-sample-table';

const MICROSECONDS_PER_SECOND = 1_000_000;

export const moovIndexAdapter: IndexAdapter = {
  kind: 'moov',
  claims: (config) => !config.fragmented,
  open: async (_source, moovBytes, config) => {
    const table = parseSampleTable(moovBytes);
    const { presentationTicks, byteOffsets, byteSizes, keySampleIndices, timescale } = table;

    const gopStartTicks = new Float64Array(keySampleIndices.length);
    for (let i = 0; i < keySampleIndices.length; i++) gopStartTicks[i] = presentationTicks[keySampleIndices[i]!]!;
    // Max presentation tick, not the last decode-order sample: with B-frames the file's final
    // decoded sample presents *before* the last displayed frame, and clamping to it would resolve
    // past-end requests to the second-to-last displayed frame.
    const lastTicks = presentationTicks.reduce((max, ticks) => Math.max(max, ticks), 0);
    const toMicros = (ticks: number) => Math.round((ticks / timescale) * MICROSECONDS_PER_SECOND);

    const nearestSampleInGop = (gopIndex: number, targetTicks: number): number => {
      const first = keySampleIndices[gopIndex]!;
      const end = gopIndex + 1 < keySampleIndices.length ? keySampleIndices[gopIndex + 1]! : table.sampleCount;
      let best = first;
      for (let i = first; i < end; i++) {
        if (Math.abs(presentationTicks[i]! - targetTicks) < Math.abs(presentationTicks[best]! - targetTicks)) best = i;
      }
      return best;
    };

    /** Deepest sample any of these targets needs. Samples are fed in decode order and every
     *  reference precedes its dependents there, so nothing past it can be needed to decode it. */
    const deepestFor = (gopIndex: number, targetTicks: readonly number[]): number => {
      const first = keySampleIndices[gopIndex]!;
      return targetTicks.reduce((deepest, ticks) => Math.max(deepest, nearestSampleInGop(gopIndex, ticks)), first);
    };

    const index: FrameIndex = {
      kind: 'moov',
      config,
      sampleTable: table,
      durationSeconds: lastTicks / timescale,
      gopStartTicks,
      clampTicks: (seconds) => Math.min(Math.max(seconds * timescale, gopStartTicks[0]!), lastTicks),
      snapMicros: (targetTicks) =>
        toMicros(presentationTicks[nearestSampleInGop(lastAtOrBefore(gopStartTicks, targetTicks), targetTicks)]!),
      planRead: (gopIndex, targetTicks) => {
        const first = keySampleIndices[gopIndex]!;
        const last = deepestFor(gopIndex, targetTicks);
        return { start: byteOffsets[first]!, end: byteOffsets[last]! + byteSizes[last]! };
      },
      resolve: (gopIndex, targetTicks) => {
        const first = keySampleIndices[gopIndex]!;
        const end = deepestFor(gopIndex, targetTicks) + 1;
        const run: RunSample[] = [];
        for (let i = first; i < end; i++) {
          run.push({ presentationMicros: toMicros(presentationTicks[i]!), byteOffset: byteOffsets[i]!, byteSize: byteSizes[i]! });
        }
        return { run, micros: targetTicks.map((ticks) => toMicros(presentationTicks[nearestSampleInGop(gopIndex, ticks)]!)) };
      },
    };
    return index;
  },
};
