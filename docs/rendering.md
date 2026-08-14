# Rendering

rerender is a drop-in replacement for Remotion. The same React API — same hooks, same components,
same `<Sequence>` and `<AbsoluteFill>` semantics — so existing compositions run unchanged.

The runtime is in this repo, not on npm (`@bevyl-ai/rerender` on the registry is
[extract](./frame-extraction.md)). Compositions keep `import { … } from 'remotion'`;
tsconfig and Vite alias that specifier to `src/remotion.ts`.

```tsx
import {
  useCurrentFrame, useVideoConfig, useIsPlaying,
  interpolate, Easing, interpolateColors, spring, measureSpring,
  Sequence, Series, Freeze, Loop,
  AbsoluteFill, Img, Video, OffthreadVideo, Audio,
  registerRoot, Composition, Still, Folder,
  Player,
} from 'remotion';
```

## How it renders

Every frame, on both paths: seek the composition to that exact frame, capture the browser's own
rendered pixels, encode with WebCodecs, mux with [mediabunny](https://mediabunny.dev).

### In a browser tab

A composition exports itself client-side. The live DOM is serialized into an SVG `<foreignObject>`,
rasterized to canvas, encoded and muxed. One tab, zero infrastructure, an `.mp4` in your downloads.

This is what runs at [rerender.video](https://rerender.video).

### Self-hosted, at scale

```sh
rerender render <entry> <comp-id>
```

Fans a render across N headless-Chrome workers — one browser per slice, not one browser with N
pages. A shared CDP connection serializes per-frame commands, and N separate browsers measured about
2× faster.

Segments concatenate with a packet copy: no re-encode, no ffmpeg. It's a Node package rather than a
Lambda function, so it runs on Fly.io microVMs, a plain AWS box, Docker, or bare metal.

## vs Remotion

| | Remotion | rerender |
| -- | -- | -- |
| License | Paid company license above 3 employees | MIT. No seats, no restrictions |
| Source | Source-available, license-gated | Open source |
| Render in the browser | Experimental (`@remotion/web-renderer`) | Yes — it's the demo |
| Distributed render | AWS Lambda only | Any host, or your own Firecracker |
| Render with no cloud | Node + headless Chrome + an ffmpeg binary | A browser tab |

## Limitations

**The in-browser capture is the less faithful of the two paths.** SVG `<foreignObject>` to canvas
cannot render nested `<video>`, `<canvas>` or WebGL, and drops `backdrop-filter` and
`mix-blend-mode` — there is nothing behind an isolated foreignObject to sample. rerender composites
a composition's own `<video>` elements separately, underneath the DOM overlay, to work around it.
That is a workaround, not a solved problem.

**The headless path drives real Chrome**, so it has none of those limits. Same compositor, same
paint as the preview, captured over CDP.

**Frame-stepped capture is deterministic, not free.** Every frame costs whatever the browser takes
to lay out, paint and rasterize it. Parallelizing divides wall-clock across workers; it does not
make a frame cheaper.

**The renderer has not carried a production workload.** CI proves it end to end on every push — a
real multi-slice headless render and a real in-browser export — but
[`extract`](./frame-extraction.md) is the half that runs in production.
