# rerender

**A drop-in, MIT-licensed Remotion alternative.** Same React API: the same hooks, the same
components, the same `<Sequence>`/`<AbsoluteFill>` semantics. Existing Remotion compositions run
unchanged. What's different is underneath: real DOM, real CSS, no ffmpeg, and a render path that
can run entirely in a browser tab with zero infrastructure.

**[rerender.video](https://rerender.video): watch it export a video, live, in a browser tab.**

## What it is

You write compositions in the Remotion API you already know: `useCurrentFrame`, `useVideoConfig`,
`interpolate`, `spring`, `<Sequence>`, `<AbsoluteFill>`, `<Video>`, `<Img>`, `<Audio>`, plus
arbitrary DOM and CSS. rerender renders them to real DOM in a real browser, so the composition you
write is the composition that plays. There's no second, CSS-to-pixel reimplementation of the
renderer that has to be kept in sync with the preview.

## How it renders

Every frame, regardless of where it runs, rerender does the same three things: seek the
composition to that exact frame, capture the browser's own rendered pixels, encode with
[WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) and mux with
[mediabunny](https://mediabunny.dev). There's no ffmpeg anywhere in the pipeline.

**In the browser** is the demo's whole point. A composition can export itself entirely
client-side: serialize the live DOM into an SVG `<foreignObject>`, rasterize it to canvas, encode
the frames with WebCodecs, mux with mediabunny. One tab, zero infrastructure, an `.mp4` in your
downloads.

**At scale, self-hosted**: `rerender render <entry> <comp-id>` fans a render across N parallel
headless-Chrome workers, one browser per slice rather than one browser with N pages (a shared CDP
connection serializes per-frame commands; N separate browsers measured about 2x faster). Each
worker frame-steps and captures its own slice with CDP screenshots, encodes it with the same
WebCodecs+mediabunny path, and the segments are concatenated with a packet-copy, no re-encode, no
ffmpeg. This runs on Fly.io Firecracker microVMs, a plain AWS box, Docker, or bare metal: it's a
Node package, not a Lambda function, so there's nowhere it's locked to.

## The API

Everything an existing Remotion project already imports:

```tsx
import {
  useCurrentFrame, useVideoConfig, useIsPlaying,
  interpolate, Easing, interpolateColors, spring, measureSpring,
  Sequence, Series, Freeze, Loop,
  AbsoluteFill, Img, Video, OffthreadVideo, Audio,
  registerRoot, Composition, Still, Folder,
  Player,
} from 'rerender';
```

Point an existing Remotion entry point at these instead and it should run.

## rerender vs Remotion

| | Remotion | rerender |
|---|---|---|
| License | Paid company license above 3 employees | MIT, free, no seats, no restrictions |
| Source | Source-available, license-gated | Fully open source |
| Render in the browser | Experimental (`@remotion/web-renderer`) | Yes, this is the whole demo |
| Distributed / farm render | AWS Lambda only | Any host, or your own Firecracker |
| To render with no cloud | Node + headless Chrome + an ffmpeg binary | A browser tab |

## The honest tradeoffs

- **The in-browser DOM capture (SVG `<foreignObject>` to canvas) is the least faithful of the two
  render paths.** It can't render nested `<video>`, `<canvas>`, or WebGL content, and it drops
  `backdrop-filter` and `mix-blend-mode` since there's nothing behind an isolated foreignObject to
  sample. rerender composites a composition's own `<video>` elements separately, underneath the
  DOM overlay, specifically to work around this, but it's a real limitation of the technique, not
  a solved problem.
- **The server render path drives real Chrome**, so it doesn't share that limitation: it's the
  same compositor doing the same paint the preview does, captured with CDP screenshots instead of
  a canvas raster. That's the path with full fidelity to a real browser render.
- **Frame-stepped capture is deterministic, not free.** Every frame still costs whatever the
  browser takes to lay out, paint, and rasterize it. Parallelizing across slices divides
  wall-clock across workers; it doesn't make any individual frame cheaper to render.

## Status

The client-side export and the server render path both work end to end, and the drop-in Remotion
API surface covers hooks, primitives, timing, and composition registration.
[rerender.video](https://rerender.video) is the live demo: watch a composition render itself to
`.mp4`, in the browser, with no server round trip.

Not yet published to npm. Clone the repo and `npm install` from source.

## License

MIT
