// Where a file keeps its index, and how to ask it questions.
//
// Extraction is the same shape whatever the container did with its tables: route a requested time
// to an independently-decodable group, read that group's bytes once, decode from its keyframe to
// the wanted sample. What differs is only where the offsets and timestamps come from, and *when*
// they can be known.
//
// A progressive mp4 states everything in the moov, so it can narrow a read to end at the wanted
// sample before fetching a byte. A fragmented one keeps each group's table inside that group, so
// the exact sample is only knowable after the read. That difference is the reason this interface
// splits planning a read from resolving what came back, rather than a single "give me the samples"
// call that would force one shape to pretend to be the other.

import { must } from '../core/must';
import type { RunSample } from './decode';
import type { SampleTable, TrackConfig } from './mp4-sample-table';
import type { RangeSource } from './source';

type IndexKind = 'moov' | 'mfra';

export interface FrameIndex {
  readonly kind: IndexKind;
  readonly config: TrackConfig;
  readonly durationSeconds: number;
  /** The file's own table, or null when the index cannot state one without reading everything. */
  readonly sampleTable: SampleTable | null;
  /** Presentation ticks of each group's first sample, ascending — the routing key. */
  readonly gopStartTicks: Float64Array;
  /**
   * A requested time in ticks, clamped into the media's range and rounded to a whole tick.
   *
   * The rounding is load-bearing. Ticks are integers, but `seconds * timescale` is not: at the
   * NTSC timescale of 30000, `1.001 * 30000` is 30029.999999999996, and a GOP starting at exactly
   * 30030 would be missed by the `<=` search and the request routed to the previous GOP — a whole
   * frame wrong on a progressive file, and a whole fragment wrong on a fragmented one.
   */
  clampTicks(seconds: number): number;
  /**
   * Presentation µs this index would deliver for a target, answerable without a read. Exact where
   * the index knows every sample; the group's keyframe where it does not.
   */
  snapMicros(targetTicks: number): number;
  /** The byte range that satisfies these targets. Narrowed when the index knows enough to narrow. */
  planRead(gopIndex: number, targetTicks: readonly number[]): { start: number; end: number };
  /**
   * The decode-order run to feed a decoder, and per target the presentation µs that will satisfy
   * it. `bytes` is what {@link planRead} asked for; indexes that already knew ignore it.
   */
  resolve(
    gopIndex: number,
    targetTicks: readonly number[],
    bytes: Uint8Array,
    bytesStart: number,
  ): { run: readonly RunSample[]; micros: readonly number[] };
}

export interface IndexAdapter {
  readonly kind: IndexKind;
  /** Whether this adapter is the one that can read the file the moov came from. */
  claims(config: TrackConfig): boolean;
  open(source: RangeSource, moovBytes: Uint8Array, config: TrackConfig, signal?: AbortSignal): Promise<FrameIndex>;
}

/** Index of the last element <= target in an ascending array, or 0. */
export function lastAtOrBefore(sorted: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (must(sorted[mid]) <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
