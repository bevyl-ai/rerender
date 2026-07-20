# rerender: frame extraction (`rerender/extract`)

Random-access frame extraction from mp4 URLs — the thing every timeline UI needs for
filmstrips/thumbnails — as a self-contained, zero-dependency module. Fetch ranges over HTTP,
decode with WebCodecs, done. No ffmpeg, no parser library, no server-side preprocessing, no
sidecar files.

## Why it exists

Remotion's `@remotion/webcodecs` `extractFramesOnWebWorker` is the incumbent, and it is slow in a
way that compounds with file length, plus buggy at the edges. Measured head-to-head in Chrome
against real CloudFront-hosted 128p H.264 filmstrip renditions (2026-07-09):

| scenario | this module | remotion |
| -- | -- | -- |
| 6 sparse frames, 28 s file, cold | 196 ms | 168 ms |
| 20 frames @ 0.1 s apart, cold → warm | 341 ms → 14 ms (1 fetch, 23 KB) | 578 ms → 108 ms |
| 5 seeks across a 2-hour file, cold | **125 ms** (187 KB) | **15.9 s** |
| same, all bytes already cached | **51 ms** | **16.6 s** — parse cost, cache can't help |

Correctness: pixel-diff 0.000 against remotion's own decoder output at identical timestamps.

Bugs found in remotion's extractor while benchmarking, which this module's tests encode as
regression cases:

- It **mutates the caller's `timestampsInSeconds` array** (in-place `sort()`, then `shift()`s it
  empty) — reusing an array across two calls throws
  `expected at least one timestamp to extract but found zero`.
- Past-end timestamps **silently drop frames** (4 requested → 2 delivered, no error). This module
  clamps to the last sample and dedupes, so every requested timestamp resolves to a frame.
- It forces `cache: 'no-store'` on every fetch (a Next.js server-side guard applied in the
  browser), so nothing it downloads is ever HTTP-cached. This module uses default fetch semantics;
  immutable/cacheable URLs get browser-disk-cache behavior for free.

mediabunny (already a rerender dependency, and excellent as a muxer/demuxer) was also benchmarked:
great on short files, but its lazy sample-table walk makes deep seeks O(distance) — `getSample(10)`
43 ms, `getSample(1800)` 473 ms, `getSample(7000)` did not finish in 2 minutes. Not its use case;
not a knock on it for muxing.

## The idea

An mp4's `moov` box already contains a complete index of the file: every frame's byte offset,
size, decode/presentation timestamp, and keyframe flag. Remotion and mediabunny both consume it
lazily, re-walking structures per seek. This module does the boring thing instead:

1. **Fetch the `moov` once** (one or two Range requests; ~33 KB for a 30 s file, ~1.7 MB for a
   2-hour file; HTTP-cached across sessions on immutable URLs).
2. **Flatten the sample table into typed arrays** (105 ms for 140,556 samples). After this,
   time→bytes is a binary search.
3. Per requested timestamp: find its GOP, **fetch exactly that byte range** (one Range request,
   ~25–60 KB — samples within a GOP are contiguous), feed the samples to a `VideoDecoder` in
   decode order (AVCC sample data is already `EncodedVideoChunk` payload), emit the frames whose
   presentation timestamps were requested.

Nothing here is a format: the moov IS the index, standardized since ISO 14496-12. There is no
sidecar, no fragmenting, no re-encoding, and it works on any progressive H.264 mp4 that already
exists.

## Module layout (`src/extract/`)

Self-contained: no imports from the rest of rerender, no dependencies, browser-only Web APIs
(fetch, DataView, WebCodecs). Consumable as `rerender/extract` without pulling in the renderer.

- `mp4-sample-table.ts` — box walk (`moov` → `trak` → `stbl`), front- or back-of-file moov,
  `stts`/`ctts`(v0+v1)/`stss`/`stsz`/`stsc`/`stco`/`co64`/`elst`, avcC decoder config. Output:
  flat typed arrays + GOP key index.
- `source.ts` — ranged-fetch source: probe the head, locate moov (tail probe if needed), fetch
  GOP ranges. `fetch` injectable for tests.
- `extractor.ts` — `createFrameExtractor(...)`: groups requested timestamps by GOP, bounded
  parallel GOP fetches, one `VideoDecoder` pass per GOP, presentation-timestamp matching with
  clamping + dedupe.
- `frame-store.ts` / `frame-cache.ts` — the batteries-included layer (see below).
- `index.ts` — public API.

## API

```ts
import { createFrameExtractor } from 'rerender/extract';

// signal (optional) is a LIFETIME signal — aborting it is equivalent to dispose(),
// so tie it to the owner (e.g. component unmount). Don't pass AbortSignal.timeout
// here: it would kill the extractor at T even after a successful setup.
const owner = new AbortController();
const extractor = await createFrameExtractor({ src: url, signal: owner.signal });
// timestamps in seconds; frames arrive as they decode, not necessarily in request order
await extractor.extract(
  [0, 1.5, 3.0],
  (frame /* VideoFrame */, requestedSeconds) => {
    ctx.drawImage(frame, x, 0, w, h);
    frame.close(); // receiver owns the frame
  },
  // per-call signal (optional) cancels this call's fetches/decodes; the extractor stays usable
  { signal: AbortSignal.timeout(30_000) },
);
extractor.dispose();
```

Design rules:

- Input timestamps are **never mutated** and may repeat/be unsorted.
- Out-of-range timestamps clamp to the first/last sample; every requested timestamp gets exactly
  one callback (duplicates after clamping share a decoded frame via per-target callbacks).
- The caller owns delivered frames (`close()` them); everything else is closed internally.
- `extract()` is safe to call repeatedly and concurrently; the sample table is built once.
- Aborting (dispose, extractor signal, or per-call signal) settles the affected `extract()`
  promises promptly with the abort reason and eagerly closes their decoders — no call ever
  hangs past its signal.
- To bound **setup only**, abort a dedicated controller from a timer you clear once
  `createFrameExtractor` settles; per-call `extract()` signals can be plain
  `AbortSignal.timeout(...)` since each call composes its own signal.
- Passing a signal (extractor-level or per-call) uses `AbortSignal.any` (Chrome 116+,
  Safari 17.4+, Node 20.3+); signal-free usage never touches it.

## Frame store (batteries included)

`createFrameExtractor` is deliberately low-level — one src, caller owns lifecycle and frames.
`createFrameStore` is the layer every timeline-filmstrip consumer would otherwise rebuild:

```ts
import { createFrameStore } from 'rerender/extract';

const store = createFrameStore();
// timestamps in µs; the store snaps them to the sample grid, dedupes in-flight decodes,
// serves cache hits synchronously-ish, and fans decoded frames out to every subscriber.
const unsubscribe = store.subscribeToExtraction(url, [0, 1_500_000], (frame) => {
  ctx.drawImage(frame, x, 0, w, h); // store closes the frame after the callback
});
store.getClosestCachedFrame(url, 1_400_000); // nearest cached frame for placeholder paints
store.snapToSampleMicros(url, 1_400_000); // the frame identity a request resolves to
store.dispose();
```

What it owns (all unit-tested in `test/frame-store.test.ts`):

- One extractor per src for the store's lifetime — the sample table is fetched/flattened once.
- Snap-to-sample-grid keying, so requests at different granularities hit the same cache entries
  and in-flight decodes instead of re-decoding the same GOP per subscriber.
- An LRU `FrameCache` of decoded frames with a per-src sorted index for nearest-frame lookups
  (`getClosestCachedFrame`, for painting a stale-but-close frame while the exact one decodes).
- Delivery safety: subscribers are isolated (one throwing doesn't starve the rest), late frames
  after `dispose()` are closed not leaked, failed extractions retry on the next subscription.

Extraction hoisted from Bevyl's filmstrip stack once the API went cold
(`apps/web/lib/video-extraction/frame-service.ts` → here, `createFrameService` →
`createFrameStore`). The product keeps its fill planners and canvas hydration; the store is the
product-agnostic half.

## Edges handled (and tested)

- B-frames: decode order ≠ presentation order (`ctts`, verified against ffprobe packet tables —
  560/560 exact on offset/size/pts/keyflag; MediaConvert 128p output has `has_b_frames=2`).
- Edit lists (`elst`): presentation-time shift applied so t=0 is the first displayed frame.
- moov at end of file (`faststart` not applied): tail probe.
- `co64`, v1 `ctts` (signed offsets), uniform `stsz`.
- Fractional/unsorted/duplicate/past-end timestamps.

## Non-goals (for now)

- Codecs beyond H.264/AVC (HEVC/AV1/VP9 are additive: same sample table, different decoder
  config box) and containers beyond mp4/mov.
- Audio.
- Encrypted media.

## First consumer

Bevyl's editor timeline filmstrips (`apps/web/lib/video-extraction/frame-service.ts`): swaps
`extractFramesOnWebWorker` for this module and deletes `@remotion/webcodecs` +
`@remotion/media-parser` from the app in the same change. No server-side work: the module reads
the filmstrip renditions (and legacy fallback renditions) already in production. Plan doc lives in
the Bevyl repo (`docs/planning/active/2026-07-10-filmstrip-extraction-rerender-migration.md`).

## Roadmap after POC

1. Web Worker wrapper (`extract/worker`) so table-flatten + decode never touch the main thread.
2. Puppeteer E2E in rerender's own test suite (same pattern as `test/export.test.ts`).
3. Publish story: rerender is currently `private: true`; Bevyl consumes via a pinned git
   dependency until rerender publishes to npm.
4. Benchmark page for the README (the vs-remotion table above, reproducible).
