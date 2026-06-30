# rerender — architecture

The whole thing is: **author in Remotion's API → render to real DOM → record the preview → slice +
stitch for scale.** No second renderer, no WASM rasterizer, no screenshot pipeline.

## The pieces

### 1. The runtime (`@rerender/core`) — Remotion-compatible, renders to real DOM
The drop-in surface. Thin React over real DOM, matching Remotion's signatures exactly:
- Hooks: `useCurrentFrame`, `useVideoConfig`.
- Timing: `interpolate`, `spring`, `Easing`, `<Sequence>`, `<Series>`.
- Primitives: `<AbsoluteFill>` (a positioned `<div>`), `<Img>`, `<Video>`/`<OffthreadVideo>`
  (real `<video>`), `<Audio>`, plus whatever a composition's own arbitrary DOM/CSS uses.
- Registration: `<Composition>`, `registerRoot`, `getInputProps`.

It renders to **real DOM** — so the browser does layout/paint and arbitrary CSS just works.

### 2. The player — preview = the real composition running
Mount the composition to DOM, drive a frame clock (`currentFrame` → React re-renders → browser
paints), expose play/pause/seek. This is *also the renderer's source*: what plays here is what gets
recorded.

### 3. The recorder — render one slice = record the playback
Given a frame range `[a, b)`: seek the composition (and its `<video>` sources) to `a`, play forward,
**record** the rendered output to a video chunk.
- **Client:** `getDisplayMedia` + Region Capture (one permission prompt per session) → `MediaRecorder`.
- **Server (default for scale):** a browser *you* control on a VM → record with full perms, or
  `--auto-accept-this-tab-capture`. No prompt.

### 4. The orchestrator — slice + stitch
Split `[0, durationInFrames)` into N slices, run N recorders **in parallel** (N browser instances /
Firecracker microVMs), then `ffmpeg concat` the chunks (stream-copy if keyframe-aligned). Wall-clock
≈ (video length ÷ N) + stitch.

### 5. The drop-in shim — `remotion` → `rerender`
A `remotion`-compatible entry so existing projects alias `remotion` to `rerender` and run unchanged.

## The non-negotiable property

Preview and render are the **same DOM composition in the same browser engine**, so they're identical
by construction — the render is a *recording of the preview*, not a re-render of it. Everything else
(client vs server recording, 1 vs N slices) is a speed/cost dial on top of that one fact.

## Where it breaks (own it)

- Per-slice must sustain ≥1× real-time, or fall back to frame-stepping (CDP `Page.captureScreenshot`)
  for that slice — same parity, slower-but-deterministic.
- Seam frames: keyframe-align slice boundaries; record slightly over and trim to exact counts.
- Audio: record per-slice and butt-join, or render audio once and mux at the end.

## Build order

1. `@rerender/core` runtime + a `<Player>` (preview). Get a composition playing in real DOM.
2. The recorder (client `getDisplayMedia` first — fastest to verify a real MP4 out).
3. The orchestrator: 2 slices → stitch → prove the seam is clean. Then N.
4. The server recorder (controlled browser, no prompt) + Firecracker fan-out.
5. The `remotion` drop-in shim + a real Remotion template running unchanged.
