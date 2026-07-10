// @remotion/media-parser drop-in over mediabunny (already a rerender dependency). Parses a
// media URL/blob/buffer and returns the requested metadata fields: what an editor uses for
// drag-drop import (videoCodec / slowDurationInSeconds / dimensions; videoCodec === null
// means an audio-only file). Editor-side tooling; the render path doesn't use it.
import { ALL_FORMATS, BlobSource, BufferSource, Input, type Source, UrlSource } from 'mediabunny';

/** Remotion's media-parser timescale (microseconds). */
export const WEBCODECS_TIMESCALE = 1_000_000;

interface ParseMediaFieldValues {
  durationInSeconds: number | null;
  slowDurationInSeconds: number;
  dimensions: { width: number; height: number } | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

export type ParseMediaFields = { [K in keyof ParseMediaFieldValues]?: boolean };

/** Requested fields are present in the result — same contract as Remotion's parseMedia. */
export type ParseMediaResult<F extends ParseMediaFields = ParseMediaFields> = {
  [K in keyof ParseMediaFieldValues as F[K] extends true ? K : never]: ParseMediaFieldValues[K];
};

export interface ParseMediaOptions<F extends ParseMediaFields = ParseMediaFields> {
  src: string | Blob | ArrayBuffer | Uint8Array;
  fields?: F;
  acknowledgeRemotionLicense?: boolean;
}

// mediabunny codec ids -> Remotion's names where they differ. Most callers only check null vs
// non-null to tell audio-only files apart, but match the common strings anyway.
const VIDEO_CODEC_NAMES: Record<string, string> = { avc: 'h264', hevc: 'h265' };

function toSource(src: ParseMediaOptions['src']): Source {
  if (typeof src === 'string') return new UrlSource(src);
  if (src instanceof Blob) return new BlobSource(src);
  if (src instanceof Uint8Array) return new BufferSource(src);
  return new BufferSource(new Uint8Array(src));
}

export async function parseMedia<const F extends ParseMediaFields>(options: ParseMediaOptions<F>): Promise<ParseMediaResult<F>> {
  const input = new Input({ formats: ALL_FORMATS, source: toSource(options.src) });
  const fields: ParseMediaFields = options.fields ?? {};
  const result: Partial<ParseMediaFieldValues> = {};
  const video = await input.getPrimaryVideoTrack();

  if (fields.durationInSeconds) result.durationInSeconds = await input.getDurationFromMetadata();
  if (fields.slowDurationInSeconds) result.slowDurationInSeconds = await input.computeDuration();
  if (fields.dimensions) {
    if (!video) {
      result.dimensions = null;
    } else {
      const swap = video.rotation === 90 || video.rotation === 270;
      result.dimensions = {
        width: swap ? video.codedHeight : video.codedWidth,
        height: swap ? video.codedWidth : video.codedHeight,
      };
    }
  }
  if (fields.videoCodec) {
    const codec = video?.codec ?? null;
    result.videoCodec = codec ? (VIDEO_CODEC_NAMES[codec] ?? codec) : null;
  }
  if (fields.audioCodec) result.audioCodec = (await input.getPrimaryAudioTrack())?.codec ?? null;
  if (fields.fps) result.fps = video ? (await video.computePacketStats()).averagePacketRate : null;
  // The conditional construction above fills exactly the requested keys; TS cannot prove it.
  return result as ParseMediaResult<F>;
}
