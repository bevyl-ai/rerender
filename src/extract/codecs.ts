// What extraction needs to know about a codec, and nothing else.
//
// Everything expensive in this module — the flattened sample table, GOP windowing, read
// coalescing, decode — is codec-agnostic. An mp4 stores each codec's decoder configuration the same
// way: a sample entry in `stsd` whose four-character type names the codec, containing one child box
// holding an opaque configuration record. WebCodecs then wants that record verbatim as
// `description`, plus a codec string it can match against.
//
// So a codec is three facts and one function, and adding one is adding a row.

/** Discriminant for a codec family. Sample entry types map many-to-one onto these. */
export type CodecId = 'avc' | 'av1';

export interface CodecHandler {
  readonly id: CodecId;
  /** `stsd` sample-entry types this handler claims. */
  readonly sampleEntries: readonly string[];
  /** The sample entry's child box holding the decoder configuration record. */
  readonly configBox: string;
  /** WebCodecs codec string, derived from that record's payload. */
  codecString(config: Uint8Array): string;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const dec2 = (n: number) => String(n).padStart(2, '0');

/**
 * avcC: `[configurationVersion, AVCProfileIndication, profile_compatibility, AVCLevelIndication]`.
 * The codec string is those three indication bytes as hex — `avc1.4d4014` is Main@4.0.
 *
 * `avc3` differs only in carrying parameter sets in-band rather than in avcC; the box and the
 * string are identical, and the decoder is told which by the sample entry type it came from.
 */
const avc: CodecHandler = {
  id: 'avc',
  sampleEntries: ['avc1', 'avc3'],
  configBox: 'avcC',
  codecString: (config) => `avc1.${hex2(config[1]!)}${hex2(config[2]!)}${hex2(config[3]!)}`,
};

/**
 * av1C is a bitfield rather than bytes to print. After the marker/version byte:
 *
 *   byte 1  seq_profile (3) | seq_level_idx_0 (5)
 *   byte 2  seq_tier_0 (1) | high_bitdepth (1) | twelve_bit (1) | monochrome (1) | …
 *
 * which yields `av01.<profile>.<level><tier>.<bitDepth>`, e.g. `av01.0.00M.08`. The optional
 * colour-description suffix is omitted: it defaults to the same 1/1/1 values a browser assumes.
 */
const av1: CodecHandler = {
  id: 'av1',
  sampleEntries: ['av01'],
  configBox: 'av1C',
  codecString: (config) => {
    const profile = (config[1]! >> 5) & 0b111;
    const level = config[1]! & 0b11111;
    const tier = (config[2]! >> 7) & 1 ? 'H' : 'M';
    const highBitDepth = (config[2]! >> 6) & 1;
    const twelveBit = (config[2]! >> 5) & 1;
    const bitDepth = twelveBit ? 12 : highBitDepth ? 10 : 8;
    return `av01.${profile}.${dec2(level)}${tier}.${dec2(bitDepth)}`;
  },
};

export const CODECS: readonly CodecHandler[] = [avc, av1];

/** The handler claiming a `stsd` sample entry type, or null if no codec here knows it. */
export function handlerFor(sampleEntry: string): CodecHandler | null {
  return CODECS.find((codec) => codec.sampleEntries.includes(sampleEntry)) ?? null;
}

/**
 * Why a moov did or didn't yield a decodable configuration. Exhaustive on purpose: every way this
 * can fail is a case here rather than a thrown string, so adding a codec — or a new failure, like
 * the fragmented-mp4 one — has to be handled everywhere it matters.
 */
export type CodecResolution =
  | { readonly ok: true; readonly id: CodecId; readonly codec: string; readonly description: Uint8Array }
  | { readonly ok: false; readonly reason: 'no-video-track' }
  | { readonly ok: false; readonly reason: 'fragmented' }
  | { readonly ok: false; readonly reason: 'unsupported-codec'; readonly sampleEntry: string }
  | { readonly ok: false; readonly reason: 'missing-config'; readonly sampleEntry: string; readonly configBox: string };

export type CodecFailure = Extract<CodecResolution, { ok: false }>;

/** Human-readable reason, with the fix where there is one. */
export function describeFailure(failure: CodecFailure): string {
  switch (failure.reason) {
    case 'no-video-track':
      return 'no video track with a recognised sample entry';
    case 'fragmented':
      // Worth its own case rather than falling out as "0 samples": the moov of a fragmented file
      // parses perfectly and describes a video with no frames, so without this the failure
      // surfaces somewhere unrelated, long after the cause.
      return 'this is a fragmented mp4 (moov carries mvex); its sample table lives in each fragment, not the moov';
    case 'unsupported-codec':
      return `unsupported codec '${failure.sampleEntry}' (supported: ${CODECS.flatMap((c) => c.sampleEntries).join(', ')})`;
    case 'missing-config':
      return `'${failure.sampleEntry}' sample entry has no ${failure.configBox} box`;
  }
}
