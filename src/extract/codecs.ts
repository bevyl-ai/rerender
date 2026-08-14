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
export type CodecId = 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1';

export interface CodecHandler {
  readonly id: CodecId;
  /** `stsd` sample-entry types this handler claims. */
  readonly sampleEntries: readonly string[];
  /** The sample entry's child box holding the decoder configuration record. */
  readonly configBox: string;
  /** WebCodecs codec string, derived from that record's payload. */
  codecString(config: Uint8Array): string;
  /**
   * Shortest configuration record this handler can read. A truncated one otherwise reads
   * `undefined` at a fixed offset, and JavaScript obliges: `undefined >> 5` is 0, so a zero-byte
   * av1C produced the perfectly plausible `av01.0.00M.08` and a 4-byte hvcC produced
   * `hvc1.0.0.Lundefined`. A fabricated codec string is worse than a refusal.
   */
  readonly minConfigBytes: number;
  /**
   * Whether the configuration record is also the decoder's `description`. True for every codec that
   * carries parameter sets out of band; false for one that does not, where passing the record along
   * would be inventing a meaning for it. Defaults to true.
   */
  readonly describes?: boolean | undefined;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const dec2 = (n: number) => String(n).padStart(2, '0');

/**
 * avcC: `[configurationVersion, AVCProfileIndication, profile_compatibility, AVCLevelIndication]`.
 * The codec string is those three indication bytes as hex — `avc1.4d4014` is Main@4.0.
 *
 * `avc3` differs only in carrying parameter sets in-band rather than in avcC. Both spell the codec
 * string `avc1.`, and so does `hev1` spell `hvc1.`: the prefix says which form the decoder is being
 * handed, and extraction always hands it the configuration record as `description`.
 */
const avc: CodecHandler = {
  id: 'avc',
  minConfigBytes: 4,
  sampleEntries: ['avc1', 'avc3'],
  configBox: 'avcC',
  codecString: (config) => {
    const profile = config[1];
    const compat = config[2];
    const level = config[3];
    if (profile === undefined || compat === undefined || level === undefined) {
      throw new Error('avcC shorter than 4 bytes');
    }
    return `avc1.${hex2(profile)}${hex2(compat)}${hex2(level)}`;
  },
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
  minConfigBytes: 4,
  sampleEntries: ['av01'],
  configBox: 'av1C',
  codecString: (config) => {
    const b1 = config[1];
    const b2 = config[2];
    if (b1 === undefined || b2 === undefined) throw new Error('av1C shorter than 4 bytes');
    const profile = (b1 >> 5) & 0b111;
    const level = b1 & 0b11111;
    const tier = (b2 >> 7) & 1 ? 'H' : 'M';
    const highBitDepth = (b2 >> 6) & 1;
    const twelveBit = (b2 >> 5) & 1;
    const bitDepth = twelveBit ? 12 : highBitDepth ? 10 : 8;
    return `av01.${profile}.${dec2(level)}${tier}.${dec2(bitDepth)}`;
  },
};

/**
 * hvcC packs the profile three ways at once, and the codec string spells each differently:
 *
 *   byte 1     profile_space (2) | tier_flag (1) | profile_idc (5)
 *   bytes 2-5  profile_compatibility_flags, written MSB-first, spelled LSB-first
 *   bytes 6-11 constraint flags, trailing zero bytes omitted from the string
 *   byte 12    level_idc, printed in decimal after L or H
 *
 * giving `hvc1.1.6.L30.90` for Main tier L level 3.0. The bit reversal is the part worth knowing
 * about: 0x60000000 in the box is `6` in the string.
 */
const hevc: CodecHandler = {
  id: 'hevc',
  minConfigBytes: 13,
  sampleEntries: ['hvc1', 'hev1'],
  configBox: 'hvcC',
  codecString: (config) => {
    const b1 = config[1];
    const b2 = config[2];
    const b3 = config[3];
    const b4 = config[4];
    const b5 = config[5];
    const level = config[12];
    if (b1 === undefined || b2 === undefined || b3 === undefined || b4 === undefined || b5 === undefined || level === undefined) {
      throw new Error('hvcC shorter than 13 bytes');
    }
    const profileSpace = (b1 >> 6) & 0b11;
    const tier = (b1 >> 5) & 1 ? 'H' : 'L';
    const profileIdc = b1 & 0b11111;
    const compatibility = reverseBits32(((b2 << 24) | (b3 << 16) | (b4 << 8) | b5) >>> 0);
    const constraints = [...config.subarray(6, 12)];
    while (constraints.length > 0 && constraints[constraints.length - 1] === 0) constraints.pop();
    const spaces = ['', 'A', 'B', 'C'] as const;
    return [
      `hvc1.${spaces[profileSpace] ?? ''}${profileIdc}`,
      compatibility.toString(16),
      `${tier}${level}`,
      ...constraints.map(hex2),
    ].join('.');
  },
};

/** Reverses the bit order of a 32-bit value — what the HEVC codec string wants of the compatibility flags. */
function reverseBits32(value: number): number {
  let out = 0;
  for (let i = 0; i < 32; i++) out = ((out << 1) | ((value >>> i) & 1)) >>> 0;
  return out >>> 0;
}

/**
 * vpcC is a FullBox, so its four version/flags bytes come first and everything below is offset by
 * them: profile, then level, then a byte whose top nibble is the bit depth. `vp09.00.10.08` is
 * profile 0, level 1.0, 8-bit.
 */
const vp9: CodecHandler = {
  id: 'vp9',
  minConfigBytes: 7,
  sampleEntries: ['vp09'],
  configBox: 'vpcC',
  codecString: (config) => {
    const profile = config[4];
    const level = config[5];
    const depth = config[6];
    if (profile === undefined || level === undefined || depth === undefined) {
      throw new Error('vpcC shorter than 7 bytes');
    }
    return `vp09.${dec2(profile)}.${dec2(level)}.${dec2(depth >> 4)}`;
  },
};

/**
 * VP8 shares VP9's configuration box and has no codec-string parameters at all — WebCodecs
 * registers it as the bare `vp8`, so nothing in vpcC changes the answer.
 *
 * It also has no out-of-band configuration, which is the one place a codec here needs to say so:
 * `description` is what an mp4's configuration record means to a decoder, and VP8 does not have
 * one. Handing vpcC over as though it did is the kind of thing a decoder is entitled to reject.
 */
const vp8: CodecHandler = {
  id: 'vp8',
  minConfigBytes: 0,
  sampleEntries: ['vp08'],
  configBox: 'vpcC',
  codecString: () => 'vp8',
  describes: false,
};

export const CODECS: readonly CodecHandler[] = [avc, hevc, vp8, vp9, av1];

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
  | { readonly ok: true; readonly id: CodecId; readonly codec: string; readonly description: Uint8Array; readonly describes: boolean }
  | { readonly ok: false; readonly reason: 'no-video-track' }
  | { readonly ok: false; readonly reason: 'fragmented' }
  | { readonly ok: false; readonly reason: 'unsupported-codec'; readonly sampleEntry: string }
  | { readonly ok: false; readonly reason: 'missing-config'; readonly sampleEntry: string; readonly configBox: string }
  | {
      readonly ok: false;
      readonly reason: 'truncated-config';
      readonly configBox: string;
      readonly bytes: number;
      readonly needed: number;
    };

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
    case 'truncated-config':
      return `${failure.configBox} is ${failure.bytes} bytes, too short to describe a decoder (needs ${failure.needed})`;
  }
}
