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

rerender is an all-in-one toolkit for video in the browser. It ships as one MIT package with no
ffmpeg, no server, and no preprocessing step.

At its core is _extract_, which pulls any frame of any mp4 in **one HTTP Range request and one
decode** — however deep into the file you seek. It reads the `moov` box once, flattens it into typed
arrays, and from then on time → bytes is a binary search. Deep seeks into a two-hour file measure
**125 ms against 15.9 s** for `@remotion/webcodecs`, which re-walks its index every time. It has zero
dependencies and runs in production.

Around it is a **drop-in replacement for Remotion**. The same React API — same hooks, same
components, same `<Sequence>` and `<AbsoluteFill>` semantics — so existing compositions run
unchanged. Underneath it is real DOM, real CSS, and WebCodecs, which means a composition can encode
itself to MP4 in a single browser tab with no infrastructure at all. The same code renders across N
headless-Chrome workers when you want it to, on any host rather than Lambda only.

rerender also ships `parseMedia` for drag-and-drop metadata, mediabunny-backed `<Video>`/`<Audio>`,
and a Web Audio preview scheduler you can drive from your own player.

## Install

```sh
npm i @bevyl-ai/rerender
```

The bare `rerender` on npm belongs to an unrelated package from 2018. To keep the short specifier in
your imports:

```sh
npm i rerender@npm:@bevyl-ai/rerender
```

`extract` is browser-only — fetch and WebCodecs, nothing else. `react` and `react-dom` >=18 are peer
dependencies. The CLI needs Node >=20.3.

## Quick links

- **Extract**
  - [`createFrameExtractor`](./docs/frame-extraction.md) — any frame of any mp4, in milliseconds
  - [`createFrameStore`](./docs/frame-extraction.md#frame-store-batteries-included) — LRU cache, nearest-frame
    placeholders, multi-subscriber fan-out
  - [Benchmarks](./docs/frame-extraction.md#benchmarks) — measured against `@remotion/webcodecs` and
    mediabunny
  - [Migrating from `@remotion/webcodecs`](./docs/frame-extraction.md#migrating) — three behaviours
    that differ
- **Render**
  - [In a browser tab](https://rerender.video) — a composition encodes itself, client-side
  - [`rerender render`](./docs/rendering.md) — fan a render across N headless-Chrome workers
  - [vs Remotion](./docs/rendering.md#vs-remotion) — licensing, hosting, fidelity
- **Reference**
  - [Entry points](./docs/entry-points.md) — what each of the five imports gives you
  - [Limitations](./docs/rendering.md#limitations) — what the in-browser capture cannot draw

```ts
import { createFrameExtractor } from '@bevyl-ai/rerender/extract';

const extractor = await createFrameExtractor({ src: url });

await extractor.extract([0, 12.5, 97.25], (frame /* VideoFrame */, requestedSeconds) => {
  ctx.drawImage(frame, x, 0, w, h);
  frame.close(); // the receiver owns the frame
});

extractor.dispose();
```

## Status

`extract` carries production traffic in Bevyl's editor timeline, where it replaced
`@remotion/webcodecs` and `@remotion/media-parser`. It is the mature half.

The renderer is proven end to end by CI on every push — a real multi-slice headless render and a
real in-browser export — but has not carried a production workload. The in-browser capture path
cannot draw nested `<video>`, `<canvas>` or WebGL, and drops `backdrop-filter` and
`mix-blend-mode`; the headless path drives real Chrome and has none of those limits.

## License

MIT
