// rerender/extract — random-access frame extraction from mp4 URLs.
// Zero dependencies: Range requests + a flattened moov sample table + WebCodecs.
// See docs/frame-extraction.md for the architecture and benchmarks.

export { createFrameExtractor } from './extractor';
export type { FrameExtractor, FrameExtractorOptions, OnFrame } from './extractor';
export { createFrameStore } from './frame-store';
export type { FrameStore, FrameStoreOptions } from './frame-store';
export { FrameCache } from './frame-cache';
export type { CachedFrameKey, ClosestCachedFrame } from './frame-cache';
export { parseSampleTable } from './mp4-sample-table';
export type { SampleTable } from './mp4-sample-table';
export { createUrlSource } from './source';
export type { RangeSource } from './source';
