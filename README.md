<h1 align="center">rerender</h1>

<p align="center">
<a href="https://www.npmjs.com/package/@bevyl-ai/rerender"><img src="https://img.shields.io/npm/v/@bevyl-ai/rerender" alt="npm"></a>
<img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
<img src="https://img.shields.io/badge/dependencies-0-success" alt="zero dependencies">
<img src="https://img.shields.io/github/stars/bevyl-ai/rerender" alt="stars">
</p>

<div align="center">
  <a href="https://rerender.video">Demo</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="./docs/frame-extraction.md">Documentation</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/bevyl-ai/rerender/issues/new">Issues</a>
  <br />
</div>

### [Scrub a 12-minute mp4 at rerender.video →](https://rerender.video)

## What is rerender?

rerender pulls any frame of any mp4 in milliseconds. One HTTP Range request, one decode, however
deep into the file you seek.

It runs in the browser on fetch and WebCodecs. **Zero dependencies.** No server, no sidecar index,
no preprocessing step, no ffmpeg.

## Install

```sh
npm i @bevyl-ai/rerender
```

```ts
import { createFrameExtractor } from '@bevyl-ai/rerender/extract';

const extractor = await createFrameExtractor({ src: url });

await extractor.extract([0, 12.5, 97.25], (frame /* VideoFrame */, requestedSeconds) => {
  ctx.drawImage(frame, x, 0, w, h);
  frame.close(); // the receiver owns the frame
});

extractor.dispose();
```

## Why it's fast

An mp4's `moov` box is already a complete index of the file: every frame's byte offset, size, decode
and presentation timestamps, and keyframe flag. Standardized since ISO 14496-12.

Most players consume it lazily and re-walk it on every seek. rerender reads it once and flattens it
into typed arrays. After that, time → bytes is a binary search, so what a seek costs stops depending
on how deep it lands.

Against `@remotion/webcodecs` in Chrome, on CloudFront-hosted 128p H.264:

| | rerender | `@remotion/webcodecs` |
| -- | -- | -- |
| 6 sparse frames, 28 s file | 196 ms | 168 ms |
| 20 frames 0.1 s apart, cold → warm | 341 ms → 14 ms | 578 ms → 108 ms |
| 5 seeks across a 2-hour file | **125 ms** | 15.9 s |
| the same seeks, fully cached | **51 ms** | 16.6 s |

Short files are a fair fight. The gap opens with duration. Caching doesn't close it — that cost is
parsing, and it is paid again every time.

[rerender.video](https://rerender.video) runs the same comparison live, on your connection.

## Guarantees

- Timestamps you pass are never mutated. They may repeat and arrive unsorted.
- Out-of-range timestamps clamp. Every requested timestamp gets exactly one callback.
- `extract()` is safe to call repeatedly and concurrently. The index is built once.
- Aborting settles the affected promises promptly and closes their decoders. No call outlives its
  signal.

## Quick links

- [API and architecture](./docs/frame-extraction.md) — the module layout, and the edges it handles
  (B-frames, edit lists, `co64`, moov-at-end)
- [`createFrameStore`](./docs/frame-extraction.md#frame-store-batteries-included) — LRU cache,
  nearest-frame placeholders, multi-subscriber fan-out
- [Benchmarks](./docs/frame-extraction.md#benchmarks) — method, and mediabunny measured too
- [Migrating from `@remotion/webcodecs`](./docs/frame-extraction.md#migrating) — three behaviours
  that differ

In production in Bevyl's editor timeline, where it replaced `@remotion/webcodecs` and
`@remotion/media-parser`.

The package also ships a Remotion-compatible renderer that encodes React compositions to MP4 in a
browser tab. That half is younger — see [rendering](./docs/rendering.md) and
[entry points](./docs/entry-points.md).

## License

MIT
