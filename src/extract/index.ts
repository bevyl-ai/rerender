// rerender/extract — random-access frame extraction from mp4 URLs.
// Zero dependencies: Range requests + a flattened moov sample table + WebCodecs.
// See docs/frame-extraction.md for the architecture and benchmarks.

export { createFrameExtractor } from './extractor';
export type { ExtractOptions, FrameExtractor, FrameExtractorOptions, OnFrame } from './extractor';
export { createFrameStore } from './frame-store';
export type { FrameStore, FrameStoreOptions } from './frame-store';
// FrameCache itself is not exported: createFrameStore builds its own and takes no cache, so the
// class was surface nobody could use and everybody would be stuck with. These two types are on the
// FrameStore surface and are genuinely needed.
export type { CachedFrameKey, ClosestCachedFrame } from './frame-cache';
export { parseSampleTable } from './mp4-sample-table';
export type { SampleTable, TrackConfig } from './mp4-sample-table';
export type { CodecId } from './codecs';
export { ExtractError, isExtractError } from './errors';
export type { ExtractErrorCode } from './errors';
export { createUrlSource } from './source';
export type { RangeSource } from './source';
