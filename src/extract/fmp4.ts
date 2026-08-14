// Fragmented mp4: the same trick, against a file that hid the index.
//
// A progressive mp4 puts one sample table in the moov and is done. A fragmented one splits the
// media into `moof`+`mdat` pairs and puts each fragment's table inside its own `moof`, which is why
// the moov of a fragmented file parses cleanly and indexes nothing. Read naively that costs one
// request per fragment just to discover where the fragments are.
//
// It does not have to. `mfra` at the end of the file is a random-access index: for every sync
// sample, its presentation time and the byte offset of the `moof` that contains it. That is the
// same shape as the keyframe table flattened out of a moov — time in, byte offset out — so the
// architecture survives intact. Two reads to set up (the tail, then the index), then one read per
// seek, and consecutive entries bound each fragment exactly so that read needs no guessing.
//
// Files without `mfra` are refused rather than crawled: chaining `moof` headers from the front is
// one round trip per fragment, which is the thing this module exists to avoid.

import type { RunSample } from './decode';
import { ExtractError } from './errors';
import { type FrameIndex, type IndexAdapter, lastAtOrBefore } from './frame-index';
import { type BoxRange, child, readBoxes, type TrackConfig } from './mp4-sample-table';
import type { RangeSource } from './source';

const MICROSECONDS_PER_SECOND = 1_000_000;

/** A sync sample and the fragment that holds it, straight out of `tfra`. */
export interface FragmentIndex {
  config: TrackConfig;
  /** Presentation ticks of each fragment's sync sample, ascending. */
  keyframeTicks: Float64Array;
  /** Byte offset of each fragment's `moof`. */
  moofOffsets: Float64Array;
  /** Where the last fragment ends — the start of `mfra`, or the file's end. */
  mediaEnd: number;
  /** trex defaults, applied when a `tfhd` declines to state them. */
  defaults: { duration: number; size: number };
  /** Presentation ticks of the last displayed frame — from mehd when the moov states it, otherwise
   *  read out of the last fragment. Never 0 for a file with samples. */
  totalTicks: number;
}

const MFRO_SIZE = 16;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** mvex/mehd states the whole presentation's duration up front, in movie timescale. Optional, and
 *  absent the caller falls back to the last sync sample, which underestimates by one fragment. */
function readFragmentDuration(moovBytes: Uint8Array, mediaTimescale: number): number {
  const v = view(moovBytes);
  const moov = readBoxes(v, 0, moovBytes.byteLength).find((box) => box.type === 'moov');
  if (!moov) return 0;
  const mehd = child(v, moov, 'mvex', 'mehd');
  const mvhd = child(v, moov, 'mvhd');
  if (!mehd || !mvhd) return 0;
  const movieTimescale = v.getUint8(mvhd.start) === 1 ? v.getUint32(mvhd.start + 20) : v.getUint32(mvhd.start + 12);
  if (!movieTimescale) return 0;
  const fragmentDuration = v.getUint8(mehd.start) === 1 ? Number(v.getBigUint64(mehd.start + 4)) : v.getUint32(mehd.start + 4);
  return (fragmentDuration / movieTimescale) * mediaTimescale;
}

/** mvex/trex carries the defaults a tfhd may omit. */
function readTrexDefaults(moovBytes: Uint8Array, trackId: number): { duration: number; size: number } {
  const v = view(moovBytes);
  const moov = readBoxes(v, 0, moovBytes.byteLength).find((box) => box.type === 'moov');
  const mvex = moov && child(v, moov, 'mvex');
  if (!mvex) return { duration: 0, size: 0 };
  // version/flags(4) track_ID(4) sample_description_index(4) duration(4) size(4) flags(4)
  const trex = readBoxes(v, mvex.start, mvex.end).find((box) => box.type === 'trex' && v.getUint32(box.start + 4) === trackId);
  if (!trex) return { duration: 0, size: 0 };
  return { duration: v.getUint32(trex.start + 12), size: v.getUint32(trex.start + 16) };
}

/**
 * Locates and parses `mfra`. Two suffix reads: 16 bytes for `mfro`, which states how long `mfra`
 * is, then `mfra` itself — about 14 KB for a 12-minute file with 735 fragments.
 */
export async function readFragmentIndex(
  source: RangeSource,
  moovBytes: Uint8Array,
  config: TrackConfig,
  signal?: AbortSignal,
): Promise<FragmentIndex> {
  if (!source.readSuffix) {
    throw new ExtractError(
      'source-unsupported',
      'fragmented mp4: this source cannot read from the end of the file, where the fragment index lives',
    );
  }

  const tail = await source.readSuffix(MFRO_SIZE, signal);
  const tailView = view(tail.bytes);
  const isMfro = tail.bytes.byteLength === MFRO_SIZE && String.fromCharCode(...tail.bytes.subarray(4, 8)) === 'mfro';
  if (!isMfro) {
    throw new ExtractError(
      'no-fragment-index',
      'fragmented mp4: no mfra index at the end of the file, so seeking it would cost one request per fragment',
    );
  }
  const mfraSize = tailView.getUint32(12);
  const mfra = await source.readSuffix(mfraSize, signal);
  const mfraView = view(mfra.bytes);

  const mfraBox = readBoxes(mfraView, 0, mfra.bytes.byteLength).find((box) => box.type === 'mfra');
  if (!mfraBox) throw new ExtractError('no-fragment-index', 'fragmented mp4: mfro pointed at bytes that are not an mfra');
  // mfra carries one tfra per track. Taking the first hands you the audio track's index — its
  // times are in the audio timescale and its moof offsets point at AAC — so match the track the
  // codec configuration came from.
  const tfras = readBoxes(mfraView, mfraBox.start, mfraBox.end).filter((box) => box.type === 'tfra');
  const tfra = tfras.find((box) => mfraView.getUint32(box.start + 4) === config.trackId);
  if (!tfra) {
    const found = tfras.map((box) => mfraView.getUint32(box.start + 4)).join(', ');
    throw new ExtractError(
      'index-track-mismatch',
      `fragmented mp4: mfra indexes track(s) ${found || '(none)'}, not the video track ${config.trackId}`,
    );
  }

  // Where mfra actually begins in the file. Using the suffix read's start assumes the read landed
  // exactly on the box, which a bogus mfro size makes false — and then the last fragment's range
  // runs backwards.
  const mediaEnd = mfra.start + mfraBox.start - 8;
  const { keyframeTicks, moofOffsets } = readTfra(mfraView, tfra);
  if (keyframeTicks.length === 0) throw new ExtractError('no-fragment-index', 'fragmented mp4: tfra indexes no sync samples');
  const defaults = readTrexDefaults(moovBytes, config.trackId);
  let totalTicks = readFragmentDuration(moovBytes, config.timescale);
  if (totalTicks === 0) {
    // No mehd — which is what ffmpeg writes — so the presentation's end is not stated anywhere but
    // inside the last fragment. Stopping at the last sync sample instead would put everything from
    // that keyframe to the end of the file out of reach: half the video on a two-fragment file.
    // One extra read at setup, once per extractor, buys back the tail.
    const lastStart = moofOffsets[moofOffsets.length - 1];
    if (lastStart === undefined) throw new ExtractError('malformed', 'fragmented mp4: tfra indexes no fragments');
    const lastBytes = await source.read(lastStart, mediaEnd, signal);
    const lastSamples = parseFragment(lastBytes, lastStart, defaults, 0);
    totalTicks = lastSamples.reduce((max, sample) => Math.max(max, sample.presentationTicks), 0);
  }

  return { config, keyframeTicks, moofOffsets, mediaEnd, defaults, totalTicks };
}

function readTfra(v: DataView, tfra: BoxRange): { keyframeTicks: Float64Array; moofOffsets: Float64Array } {
  const version = v.getUint8(tfra.start);
  // reserved(26) then three 2-bit fields, each a byte-length minus one
  const sizes = v.getUint32(tfra.start + 8);
  const trafSize = ((sizes >> 4) & 0b11) + 1;
  const trunSize = ((sizes >> 2) & 0b11) + 1;
  const sampleSize = (sizes & 0b11) + 1;
  const declared = v.getUint32(tfra.start + 12);
  // A hostile or truncated tfra can claim 4 billion entries; allocate for what is actually there.
  const entrySize = (version === 1 ? 16 : 8) + trafSize + trunSize + sampleSize;
  const count = Math.min(declared, Math.max(0, Math.floor((tfra.end - tfra.start - 16) / entrySize)));

  const keyframeTicks = new Float64Array(count);
  const moofOffsets = new Float64Array(count);
  let at = tfra.start + 16;
  for (let i = 0; i < count; i++) {
    if (version === 1) {
      keyframeTicks[i] = Number(v.getBigUint64(at));
      moofOffsets[i] = Number(v.getBigUint64(at + 8));
      at += 16;
    } else {
      keyframeTicks[i] = v.getUint32(at);
      moofOffsets[i] = v.getUint32(at + 4);
      at += 8;
    }
    at += trafSize + trunSize + sampleSize;
  }
  return { keyframeTicks, moofOffsets };
}

export interface FragmentSample {
  /** Presentation ticks, composition offset already applied. */
  presentationTicks: number;
  /** Absolute file byte offset. */
  byteOffset: number;
  byteSize: number;
}

/**
 * The sample table of one fragment, out of its own `moof`.
 *
 * `tfdt` gives the fragment's decode time, `trun` the per-sample durations, sizes and composition
 * offsets, and `tfhd` says which of those the fragment bothered to write down — anything omitted
 * falls back to the `trex` defaults in the moov.
 */
export function parseFragment(
  bytes: Uint8Array,
  fragmentStart: number,
  defaults: { duration: number; size: number },
  editShiftTicks = 0,
): FragmentSample[] {
  const v = view(bytes);
  const moof = readBoxes(v, 0, bytes.byteLength).find((box) => box.type === 'moof');
  if (!moof) throw new ExtractError('malformed', `fragmented mp4: no moof at byte ${fragmentStart}`);
  const traf = readBoxes(v, moof.start, moof.end).find((box) => box.type === 'traf');
  if (!traf) throw new ExtractError('malformed', `fragmented mp4: moof at byte ${fragmentStart} has no traf`);

  const children = readBoxes(v, traf.start, traf.end);
  const tfhd = children.find((box) => box.type === 'tfhd');
  if (!tfhd) throw new ExtractError('malformed', `fragmented mp4: traf at byte ${fragmentStart} has no tfhd`);
  const tfhdFlags = v.getUint32(tfhd.start) & 0xffffff;

  let at = tfhd.start + 8; // version/flags + track_ID
  let baseOffset = fragmentStart; // default-base-is-moof, and the sane default besides
  if (tfhdFlags & 0x000001) {
    baseOffset = Number(v.getBigUint64(at));
    at += 8;
  }
  if (tfhdFlags & 0x000002) at += 4; // sample_description_index
  let defaultDuration = defaults.duration;
  let defaultSize = defaults.size;
  if (tfhdFlags & 0x000008) {
    defaultDuration = v.getUint32(at);
    at += 4;
  }
  if (tfhdFlags & 0x000010) {
    defaultSize = v.getUint32(at);
    at += 4;
  }

  const tfdt = children.find((box) => box.type === 'tfdt');
  let decodeTicks = 0;
  if (tfdt) {
    decodeTicks = v.getUint8(tfdt.start) === 1 ? Number(v.getBigUint64(tfdt.start + 4)) : v.getUint32(tfdt.start + 4);
  }

  const samples: FragmentSample[] = [];
  // "If the data-offset is not present, then the data for this run starts immediately after the
  // data of the previous run" — so the cursor carries across runs rather than resetting to base.
  let byteCursor = baseOffset;
  for (const trun of children.filter((box) => box.type === 'trun')) {
    const version = v.getUint8(trun.start);
    const flags = v.getUint32(trun.start) & 0xffffff;
    const count = v.getUint32(trun.start + 4);
    let cursor = trun.start + 8;
    let dataOffset = 0;
    if (flags & 0x000001) {
      dataOffset = v.getInt32(cursor);
      cursor += 4;
    }
    let firstSampleFlags: number | null = null;
    if (flags & 0x000004) {
      firstSampleFlags = v.getUint32(cursor);
      cursor += 4;
    }
    void firstSampleFlags; // every fragment here starts on a sync sample; kept for shape

    if (flags & 0x000001) byteCursor = baseOffset + dataOffset;
    for (let i = 0; i < count; i++) {
      let duration = defaultDuration;
      let size = defaultSize;
      let compositionOffset = 0;
      if (flags & 0x000100) {
        duration = v.getUint32(cursor);
        cursor += 4;
      }
      if (flags & 0x000200) {
        size = v.getUint32(cursor);
        cursor += 4;
      }
      if (flags & 0x000400) cursor += 4; // sample_flags
      if (flags & 0x000800) {
        // signed from version 1 on, so a B-frame presenting before its decode time reads correctly
        compositionOffset = version === 0 ? v.getUint32(cursor) : v.getInt32(cursor);
        cursor += 4;
      }
      samples.push({ presentationTicks: decodeTicks + compositionOffset - editShiftTicks, byteOffset: byteCursor, byteSize: size });
      decodeTicks += duration;
      byteCursor += size;
    }
  }
  return samples;
}

/**
 * The fragmented index. Same contract as the progressive one, with the one asymmetry the format
 * forces: `planRead` cannot narrow, because the per-sample sizes it would narrow by are inside the
 * bytes it is about to ask for. A fragment is read whole — a few kilobytes at one GOP each.
 */
export const mfraIndexAdapter: IndexAdapter = {
  kind: 'mfra',
  claims: (config) => config.fragmented,
  open: async (source, moovBytes, config, signal) => {
    const { keyframeTicks, moofOffsets, mediaEnd, defaults, totalTicks } = await readFragmentIndex(source, moovBytes, config, signal);
    const { timescale, editShiftTicks } = config;

    const gopStartTicks = new Float64Array(keyframeTicks.length);
    for (let i = 0; i < keyframeTicks.length; i++) {
      const ticks = keyframeTicks[i];
      if (ticks === undefined) throw new ExtractError('malformed', `fragmented mp4: tfra entry ${i} has no timestamp`);
      gopStartTicks[i] = ticks - editShiftTicks;
    }
    const firstTicks = gopStartTicks[0];
    const lastGopTicks = gopStartTicks[gopStartTicks.length - 1];
    if (firstTicks === undefined || lastGopTicks === undefined) {
      throw new ExtractError('malformed', 'fragmented mp4: tfra indexes no sync samples');
    }
    // mehd when the file states one; otherwise the last sync sample, short by a fragment.
    const lastTicks = totalTicks > 0 ? totalTicks - editShiftTicks : lastGopTicks;
    const toMicros = (ticks: number) => Math.round((ticks / timescale) * MICROSECONDS_PER_SECOND);

    /** Fragments are contiguous, so the next one's moof bounds this one exactly. */
    const range = (i: number) => {
      const start = moofOffsets[i];
      if (start === undefined) throw new ExtractError('malformed', `fragmented mp4: fragment ${i} has no moof offset`);
      const next = moofOffsets[i + 1];
      return { start, end: next === undefined ? mediaEnd : next };
    };

    const index: FrameIndex = {
      kind: 'mfra',
      config,
      durationSeconds: lastTicks / timescale,
      // A fragmented file states no whole-file table; see FrameExtractor.sampleTable.
      sampleTable: null,
      gopStartTicks,
      clampTicks: (seconds) => Math.min(Math.max(Math.round(seconds * timescale), firstTicks), lastTicks),
      // Fragment granularity: the exact sample is inside bytes we have not fetched.
      snapMicros: (targetTicks) => {
        const ticks = gopStartTicks[lastAtOrBefore(gopStartTicks, targetTicks)];
        if (ticks === undefined) throw new ExtractError('malformed', 'fragmented mp4: snap missed every GOP');
        return toMicros(ticks);
      },
      planRead: (gopIndex) => range(gopIndex),
      resolve: (gopIndex, targetTicks, bytes, bytesStart) => {
        const samples = parseFragment(bytes, bytesStart, defaults, editShiftTicks);
        if (samples.length === 0) throw new ExtractError('malformed', `fragmented mp4: fragment ${gopIndex} declared no samples`);
        const nearest = targetTicks.map((ticks) => {
          let best = 0;
          for (let i = 1; i < samples.length; i++) {
            const sample = samples[i];
            const bestSample = samples[best];
            if (!sample || !bestSample) continue;
            if (Math.abs(sample.presentationTicks - ticks) < Math.abs(bestSample.presentationTicks - ticks)) best = i;
          }
          return best;
        });
        const deepest = nearest.reduce((max, i) => Math.max(max, i), 0);
        const run: RunSample[] = [];
        for (let i = 0; i <= deepest; i++) {
          const sample = samples[i];
          if (!sample) continue;
          run.push({
            presentationMicros: toMicros(sample.presentationTicks),
            byteOffset: sample.byteOffset,
            byteSize: sample.byteSize,
          });
        }
        return {
          run,
          micros: nearest.map((i) => {
            const sample = samples[i];
            if (!sample) throw new ExtractError('malformed', `fragmented mp4: fragment ${gopIndex} missing sample ${i}`);
            return toMicros(sample.presentationTicks);
          }),
        };
      },
    };
    return index;
  },
};
