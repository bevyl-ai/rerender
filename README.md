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

Browser-only, on fetch and WebCodecs. **Zero dependencies.** No server, no sidecar index, no ffmpeg.

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

An mp4's `moov` box is already a complete index of the file. Most players re-walk it on every seek.
rerender reads it once into typed arrays, so time → bytes is a binary search and a seek stops
costing more the deeper it lands.

Five seeks across a two-hour file: **125 ms**, against 15.9 s for `@remotion/webcodecs`.
[Run it yourself.](https://rerender.video)

In production in Bevyl's editor timeline, where it replaced `@remotion/webcodecs` and
`@remotion/media-parser`.

## Docs

[API and architecture](./docs/frame-extraction.md) &nbsp;·&nbsp;
[Frame store](./docs/frame-extraction.md#frame-store-batteries-included) &nbsp;·&nbsp;
[Benchmarks](./docs/frame-extraction.md#benchmarks) &nbsp;·&nbsp;
[Rendering](./docs/rendering.md)

## License

MIT
