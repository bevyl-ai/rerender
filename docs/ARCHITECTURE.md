# rerender: architecture

The whole thing is: **author in Remotion's API, render to real DOM, capture each frame
deterministically, encode with WebCodecs, mux with mediabunny.** No ffmpeg, no screenshot
recording, no reimplemented CSS renderer.

This document covers the **renderer**. The package also ships standalone browser media modules
that the render path does not use and that do not import it — most importantly
`rerender-video/extract`, the zero-dependency mp4 frame extractor that runs in production in
Bevyl's editor timeline. It has its own doc: [frame-extraction.md](frame-extraction.md).

## The pieces

### 1. The runtime (`src/core`, `src/index.ts`): Remotion-compatible, renders to real DOM
The drop-in surface. Thin React over real DOM, matching Remotion's signatures:
- Hooks: `useCurrentFrame`, `useVideoConfig`, `useIsPlaying`.
- Timing: `interpolate`, `spring`, `measureSpring`, `Easing`, `interpolateColors`, `<Sequence>`,
  `<Series>`, `<Freeze>`, `<Loop>`.
- Primitives: `<AbsoluteFill>` (a positioned `<div>`), `<Img>`, `<Video>`/`<OffthreadVideo>` (a real
  `<video>`), `<Audio>`, plus whatever a composition's own arbitrary DOM/CSS uses.
- Registration: `<Composition>`, `registerRoot`, `getInputProps`.

It renders to **real DOM**, so the browser does layout and paint and arbitrary CSS just works. No
CSS property has to be individually reimplemented to render correctly.

### 2. The player (`src/core/player.tsx`): preview is the real composition running
Mounts the composition to DOM, drives a frame clock (`currentFrame` changes, React re-renders, the
browser paints), exposes play/pause/seek. This is the same tree that gets captured for export: the
render is not a second, separate pass over a re-derived representation of the composition.

### 3. Two capture paths, one encode path

**Client-side, in-browser (`src/client/export.tsx`)**: the whole point of the demo. Each frame: seek
the composition, serialize the live DOM into an SVG `<foreignObject>`, rasterize it to a `<canvas>`
(the in-browser stand-in for a screenshot), composite any `<video>` elements natively underneath it
(a `<video>`'s own frame, decoded via mediabunny at the exact source timestamp, drawn under the DOM
overlay so backgrounds and mid-stack video both work). Encode each captured canvas frame with
WebCodecs, mux with mediabunny. One tab, no server, no native binary.

**Server-side (`src/renderer`, the `rerender render`/`rerender still` CLI)**: fans a render across N
parallel headless-Chrome workers, one browser per slice rather than one browser with N pages (a
shared CDP connection serializes per-frame commands; N separate browsers measured about 2x faster).
Each worker frame-steps its own slice, captures frames with CDP screenshots to local files, and
encodes them independently with the same WebCodecs+mediabunny path into its own segment. Segments
are concatenated with a mediabunny packet-copy (no re-encode, no ffmpeg). Audio is collected
per-frame during capture, positioned, and muxed in at the end.

Both paths converge on the same encoder: capture differs (canvas raster vs. CDP screenshot), but the
frame that gets encoded is the browser's own rendered output either way.

### 4. The cloud deploy layer (`cloud/`): an AWS Lambda target, API-compatible with `@remotion/lambda-client`
A `renderMediaOnLambda` / `getRenderProgress` implementation with the same field-for-field shape as
Remotion's own Lambda client, so a caller already built against `@remotion/lambda-client` can switch
the import and keep its polling/webhook code unchanged. `cloud/lambda-client.ts` runs in the
caller's own server (invokes the deployed function, polls S3 for progress); `cloud/handler.ts` is
the deployed Lambda function itself (one container, three modes: `launch` for a full async render,
`still` for a single frame, `segment` for the per-range worker the CLI's local orchestrator also
uses); `cloud/deploy.ts` builds the worker image and deploys the CloudFormation stack (Lambda + S3),
no SAM, just Docker and the AWS CLI.

### 5. The `remotion` drop-in shim
A `remotion`-compatible entry so an existing Remotion project can alias `remotion` to `rerender` and
run with minimal changes.

## The non-negotiable property

Every render path, in every environment, captures the actual rendered output of the actual
composition tree running in an actual browser. There is no separate, re-derived renderer to keep
in sync with the preview: whatever the DOM looks like is what gets captured.

## Where it breaks (own it)

- **The in-browser DOM capture (SVG `<foreignObject>` to canvas) is the least faithful of the two
  paths.** It can't render nested `<video>`, `<canvas>`, or WebGL content inside the DOM tree
  (`<video>` elements are composited separately for exactly this reason), and it drops
  `backdrop-filter` and `mix-blend-mode` since there's nothing behind an isolated foreignObject to
  sample. This is a real constraint of the technique, not a bug to fix later.
- **The server render path (CDP screenshots) doesn't share that limitation**: it's the same
  compositor doing the same paint the preview does, so backdrop-filter, blend modes, and nested
  video/canvas/WebGL all render correctly there.
- **Frame-stepped capture is deterministic, not free.** Every frame still costs whatever the browser
  takes to lay out, paint, and rasterize it. Slicing a render across N workers divides wall-clock
  across them; it doesn't make an individual frame cheaper to capture.
- **Seam accuracy on the server path.** Slice boundaries have to land on exact frames so the
  packet-copy concat never drops or doubles a frame at a segment boundary.
