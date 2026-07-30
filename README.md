# rerender

**MIT video primitives for the browser.** Random-access frame extraction from mp4 URLs, a
Remotion-compatible React runtime, and an MP4 render path built on WebCodecs and
[mediabunny](https://mediabunny.dev). No ffmpeg anywhere.

```sh
npm install rerender-video
```

**[rerender.video](https://rerender.video): pull frames out of a 2-minute mp4, live, in a browser
tab.**

---

## `rerender-video/extract` — any frame of any mp4, in milliseconds

The thing every timeline UI needs for filmstrips and thumbnails, as a self-contained,
**zero-dependency** module. Range requests + a flattened `moov` sample table + WebCodecs. No
parser library, no server-side preprocessing, no sidecar files.

An mp4's `moov` box is already a complete index of the file: every frame's byte offset, size,
decode/presentation timestamp, and keyframe flag, standardized since ISO 14496-12. The incumbents
consume it lazily and re-walk it per seek. This module fetches it once, flattens it into typed
arrays, and after that time→bytes is a binary search — so a seek costs one Range request and one
decode, no matter how deep into the file it lands.

### Measured against `@remotion/webcodecs`

Head-to-head in Chrome against real CloudFront-hosted 128p H.264 filmstrip renditions (2026-07-09):

| scenario | `rerender-video/extract` | `@remotion/webcodecs` |
| -- | -- | -- |
| 6 sparse frames, 28 s file, cold | 196 ms | 168 ms |
| 20 frames @ 0.1 s apart, cold → warm | 341 ms → 14 ms (1 fetch, 23 KB) | 578 ms → 108 ms |
| 5 seeks across a 2-hour file, cold | **125 ms** (187 KB) | **15.9 s** |
| same, all bytes already cached | **51 ms** | **16.6 s** — parse cost, cache can't help |

Correctness: pixel-diff 0.000 against remotion's own decoder output at identical timestamps, and
560/560 exact on offset/size/pts/keyflag against ffprobe's packet tables.

Three bugs turned up in the incumbent while benchmarking; each one is a regression test here:

- It **mutates the caller's `timestampsInSeconds` array** (in-place `sort()`, then `shift()`s it
  empty), so reusing an array across two calls throws.
- Past-end timestamps **silently drop frames** (4 requested → 2 delivered, no error).
- It forces `cache: 'no-store'` on every fetch — a Next.js server-side guard applied in the
  browser — so nothing it downloads is ever HTTP-cached.

mediabunny was benchmarked too: great on short files, but its lazy sample-table walk makes deep
seeks O(distance) (`getSample(7000)` did not finish in 2 minutes). Not its use case, and no knock
on it as a muxer/demuxer — rerender depends on it for exactly that.

### Using it

```ts
import { createFrameExtractor } from 'rerender-video/extract';

const extractor = await createFrameExtractor({ src: url });

await extractor.extract([0, 12.5, 97.25], (frame /* VideoFrame */, requestedSeconds) => {
  ctx.drawImage(frame, x, 0, w, h);
  frame.close(); // the receiver owns the frame
});

extractor.dispose();
```

- Input timestamps are **never mutated**, and may repeat or arrive unsorted.
- Out-of-range timestamps clamp; **every requested timestamp gets exactly one callback**.
- `extract()` is safe to call repeatedly and concurrently; the sample table is built once.
- Aborting (via `dispose()`, an extractor-level signal, or a per-call signal) settles the affected
  promises promptly and eagerly closes their decoders — no call hangs past its signal.

`createFrameStore()` is the batteries-included layer on top: one extractor per src, snap-to-sample
cache keying, an LRU frame cache with nearest-frame lookups for placeholder paints, and
multi-subscriber fan-out. See [docs/frame-extraction.md](docs/frame-extraction.md) for the full
architecture, the edges it handles (B-frames, edit lists, `co64`, moov-at-end), and the non-goals.

**In production**: Bevyl's editor timeline filmstrips, since July 2026, where it replaced
`@remotion/webcodecs` and `@remotion/media-parser` in the same change.

## `rerender-video/media-parser` — `@remotion/media-parser`'s `parseMedia`, over mediabunny

The metadata call an editor needs for drag-and-drop import — codec, duration, dimensions, fps —
with the same field-selection contract as Remotion's, so the requested fields are the ones you get
back in the type.

```ts
import { parseMedia } from 'rerender-video/media-parser';

const { dimensions, videoCodec } = await parseMedia({ src: file, fields: { dimensions: true, videoCodec: true } });
```

---

## The rest of the package: a drop-in Remotion alternative

Same React API — the same hooks, the same components, the same `<Sequence>`/`<AbsoluteFill>`
semantics. Existing Remotion compositions run unchanged. What's different is underneath: real DOM,
real CSS, no ffmpeg, and a render path that can run entirely in a browser tab with zero
infrastructure.

```tsx
import {
  useCurrentFrame, useVideoConfig, useIsPlaying,
  interpolate, Easing, interpolateColors, spring, measureSpring,
  Sequence, Series, Freeze, Loop,
  AbsoluteFill, Img, Video, OffthreadVideo, Audio,
  registerRoot, Composition, Still, Folder,
  Player,
} from 'rerender-video';
```

Point an existing Remotion entry point at these instead and it should run.

### How it renders

Every frame, regardless of where it runs: seek the composition to that exact frame, capture the
browser's own rendered pixels, encode with
[WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), mux with mediabunny.

**In the browser**, a composition can export itself entirely client-side: serialize the live DOM
into an SVG `<foreignObject>`, rasterize it to canvas, encode the frames, mux, done. One tab, zero
infrastructure, an `.mp4` in your downloads.

**At scale, self-hosted**, `rerender render <entry> <comp-id>` fans a render across N parallel
headless-Chrome workers — one browser per slice rather than one browser with N pages (a shared CDP
connection serializes per-frame commands; N separate browsers measured about 2x faster). Segments
are concatenated with a packet-copy: no re-encode, no ffmpeg. It's a Node package, not a Lambda
function, so it runs on Fly.io Firecracker microVMs, a plain AWS box, Docker, or bare metal.

### rerender vs Remotion

| | Remotion | rerender |
|---|---|---|
| License | Paid company license above 3 employees | MIT, free, no seats, no restrictions |
| Source | Source-available, license-gated | Fully open source |
| Render in the browser | Experimental (`@remotion/web-renderer`) | Yes, this is the demo |
| Distributed / farm render | AWS Lambda only | Any host, or your own Firecracker |
| To render with no cloud | Node + headless Chrome + an ffmpeg binary | A browser tab |

### The honest tradeoffs

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
- **Extraction is the mature half.** It runs in production and is benchmarked against the
  incumbent. The renderer is proven end to end by CI on every push — a real multi-slice
  headless render, and a real in-browser export — but it has not carried a production workload
  the way `extract` has.

## Entry points

| import | what it is |
| -- | -- |
| `rerender-video` | the Remotion-compatible runtime, primitives, and `<Player>` |
| `rerender-video/extract` | zero-dependency mp4 frame extraction + frame store |
| `rerender-video/media-parser` | `@remotion/media-parser`'s `parseMedia`, over mediabunny |
| `rerender-video/media` | `@remotion/media`'s `<Video>`/`<Audio>`, over mediabunny sinks |
| `rerender-video/audio-engine` | the Web Audio preview scheduler, for external players |

Requires Node >=20.3 for the CLI; `react`/`react-dom` >=18 are peer dependencies. `rerender-video/extract`
is browser-only (fetch + WebCodecs) and pulls in nothing else.

## License

MIT
