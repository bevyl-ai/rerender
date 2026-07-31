# rerender

**MIT video primitives for the browser.** Pull any frame of any mp4 in milliseconds. Render React
compositions to MP4 in a tab. Built on WebCodecs and [mediabunny](https://mediabunny.dev). No
ffmpeg, no server, no preprocessing.

```sh
npm i @bevyl-ai/rerender
```

The bare `rerender` on npm belongs to an unrelated package from 2018. To keep the short specifier in
your imports:

```sh
npm i rerender@npm:@bevyl-ai/rerender
```

**[rerender.video](https://rerender.video)** — drag a scrubber and watch every frame get fetched and
decoded as you move.

---

## extract

Any frame of any mp4, in milliseconds. Zero dependencies, browser only.

```ts
import { createFrameExtractor } from '@bevyl-ai/rerender/extract';

const extractor = await createFrameExtractor({ src: url });

await extractor.extract([0, 12.5, 97.25], (frame /* VideoFrame */, requestedSeconds) => {
  ctx.drawImage(frame, x, 0, w, h);
  frame.close(); // the receiver owns the frame
});

extractor.dispose();
```

An mp4's `moov` box is already a complete index of the file: every frame's byte offset, size, decode
and presentation timestamps, and keyframe flag. Standardized since ISO 14496-12.

Most players consume it lazily and re-walk it on every seek. `extract` fetches it once and flattens
it into typed arrays. After that, time → bytes is a binary search, so a seek costs one Range request
and one decode however deep into the file it lands. No parser library, no sidecar index, no server.

### Speed

Against `@remotion/webcodecs` in Chrome, on CloudFront-hosted 128p H.264 renditions:

| | `extract` | `@remotion/webcodecs` |
| -- | -- | -- |
| 6 sparse frames, 28 s file, cold | 196 ms | 168 ms |
| 20 frames 0.1 s apart, cold → warm | 341 ms → 14 ms | 578 ms → 108 ms |
| 5 seeks across a 2-hour file, cold | **125 ms** | 15.9 s |
| the same seeks, fully cached | **51 ms** | 16.6 s |

Cache doesn't rescue the last row — that cost is parsing, and it is paid again every time.

Short files are a fair fight. The gap opens with duration, because one design re-walks the index and
the other doesn't.

Pixel-diff is 0.000 against Remotion's own decoder at identical timestamps, and offset, size, PTS and
keyframe flag match ffprobe's packet tables 560/560.

### What it guarantees

- Input timestamps are never mutated. They may repeat and arrive unsorted.
- Out-of-range timestamps clamp. Every requested timestamp gets exactly one callback.
- `extract()` is safe to call repeatedly and concurrently. The sample table is built once.
- Aborting — `dispose()`, an extractor signal, or a per-call signal — settles affected promises
  promptly and closes their decoders. No call outlives its signal.

### Migrating from `@remotion/webcodecs`

Three behaviors differ. Each is a regression test here.

- It **mutates the `timestampsInSeconds` array you pass it** — sorts in place, then empties it — so
  reusing one array across two calls throws.
- Past-end timestamps are **silently dropped**: request 4, receive 2, no error.
- It forces `cache: 'no-store'` on every fetch, so nothing it downloads is ever HTTP-cached.

mediabunny was measured too. It's excellent on short files, but its lazy sample-table walk makes deep
seeks O(distance) — `getSample(7000)` didn't finish in two minutes. That isn't its job, and it's no
knock on it as a muxer/demuxer; rerender depends on it for exactly that.

### Frame store

`createFrameStore()` is the batteries-included layer: one extractor per src, snap-to-sample cache
keys, an LRU cache with nearest-frame lookups for placeholder paints, and multi-subscriber fan-out.

[docs/frame-extraction.md](docs/frame-extraction.md) covers the architecture, the edges handled
(B-frames, edit lists, `co64`, moov-at-end), and the non-goals.

Running in production in Bevyl's editor timeline since July 2026, where it replaced
`@remotion/webcodecs` and `@remotion/media-parser` in one change.

## media-parser

`@remotion/media-parser`'s `parseMedia`, over mediabunny. Codec, duration, dimensions, fps — the
metadata call an editor needs on drag-and-drop import. Same field-selection contract, so the fields
you ask for are the fields in the returned type.

```ts
import { parseMedia } from '@bevyl-ai/rerender/media-parser';

const { dimensions, videoCodec } = await parseMedia({
  src: file,
  fields: { dimensions: true, videoCodec: true },
});
```

---

## A drop-in Remotion alternative

The same React API: same hooks, same components, same `<Sequence>` and `<AbsoluteFill>` semantics.
Existing compositions run unchanged. What differs is underneath — real DOM, real CSS, no ffmpeg, and
a render path that runs in a browser tab with no infrastructure at all.

```tsx
import {
  useCurrentFrame, useVideoConfig, useIsPlaying,
  interpolate, Easing, interpolateColors, spring, measureSpring,
  Sequence, Series, Freeze, Loop,
  AbsoluteFill, Img, Video, OffthreadVideo, Audio,
  registerRoot, Composition, Still, Folder,
  Player,
} from '@bevyl-ai/rerender';
```

Point an existing Remotion entry point at these instead and it should run.

### How it renders

Every frame, everywhere: seek the composition to that exact frame, capture the browser's own
rendered pixels, encode with WebCodecs, mux with mediabunny.

**In a tab**, a composition exports itself client-side — serialize the live DOM into an SVG
`<foreignObject>`, rasterize to canvas, encode, mux. One tab, zero infrastructure, an `.mp4` in your
downloads.

**Self-hosted at scale**, `rerender render <entry> <comp-id>` fans a render across N headless-Chrome
workers, one browser per slice rather than one browser with N pages — a shared CDP connection
serializes per-frame commands, and N browsers measured about 2× faster. Segments concatenate with a
packet copy: no re-encode, no ffmpeg. It's a Node package, not a Lambda function, so it runs on
Fly.io microVMs, a plain AWS box, Docker, or bare metal.

### vs Remotion

| | Remotion | rerender |
| -- | -- | -- |
| License | Paid company license above 3 employees | MIT. No seats, no restrictions |
| Source | Source-available, license-gated | Open source |
| Render in the browser | Experimental (`@remotion/web-renderer`) | Yes — it's the demo |
| Distributed render | AWS Lambda only | Any host, or your own Firecracker |
| Render with no cloud | Node + headless Chrome + an ffmpeg binary | A browser tab |

### Limits

**The in-browser capture is the less faithful of the two paths.** SVG `<foreignObject>` to canvas
can't render nested `<video>`, `<canvas>`, or WebGL, and drops `backdrop-filter` and
`mix-blend-mode` — there's nothing behind an isolated foreignObject to sample. rerender composites a
composition's own `<video>` elements separately, underneath the DOM overlay, to work around it. That
is a workaround, not a solved problem.

**The server path drives real Chrome**, so it doesn't share that limit. Same compositor, same paint
as the preview, captured over CDP.

**Frame-stepped capture is deterministic, not free.** Every frame costs whatever the browser takes to
lay out, paint and rasterize it. Parallelizing divides wall-clock across workers; it doesn't make a
frame cheaper.

**Extraction is the mature half.** It carries production traffic and is benchmarked against the
incumbent. The renderer is proven end to end by CI on every push — a real multi-slice headless
render and a real in-browser export — but it has not carried a production workload the way `extract`
has.

## Entry points

| import | what it is |
| -- | -- |
| `@bevyl-ai/rerender` | Remotion-compatible runtime, primitives, `<Player>` |
| `@bevyl-ai/rerender/extract` | mp4 frame extraction + frame store. Zero dependencies |
| `@bevyl-ai/rerender/media-parser` | `parseMedia`, over mediabunny |
| `@bevyl-ai/rerender/media` | `@remotion/media`'s `<Video>`/`<Audio>`, over mediabunny sinks |
| `@bevyl-ai/rerender/audio-engine` | the Web Audio preview scheduler, for external players |

`extract` is browser-only — fetch and WebCodecs, nothing else. `react` and `react-dom` >=18 are peer
dependencies. The CLI needs Node >=20.3.

## License

MIT
