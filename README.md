# rerender

> **Drop-in, MIT Remotion.** Same React API — but the renderer is just a *recording of the
> preview*, sliced across N browsers and stitched. Preview and export are the same pixels, by
> construction.

## What it is

You write video compositions in the **exact Remotion API** — `useCurrentFrame`, `useVideoConfig`,
`interpolate`, `<Sequence>`, `<AbsoluteFill>`, and arbitrary DOM/CSS. Existing Remotion projects
drop in. The difference is entirely underneath.

## The idea

Remotion renders by screenshotting a headless browser frame-by-frame, then stitching with FFmpeg,
fanned across Lambda. That's a **second** rendering pipeline, separate from the `<Player>` preview —
and keeping the two pixel-identical is a whole class of bugs (`OffthreadVideo` vs `Video`, font
drift, Chrome-version skew).

**rerender deletes the second pipeline. The render is a recording of the preview.** Your composition
plays once in a real browser; rerender captures that exact playback. Preview and export aren't *kept*
in sync — they **are** the same pixels, because the export is literally a recording of the thing you
previewed. One engine. No drift. Arbitrary CSS works because it's a real browser, not a reimplemented
renderer.

## How it scales

Recording is real-time — so rerender **slices the timeline** and records the slices **in parallel**:
N compositors, each seeks to its slice, plays + records it, and rerender stitches the chunks
(`ffmpeg concat`). A 60s video across 60 browsers ≈ rendered in ~a second + a stitch. Remotion-class
speed, without Remotion's screenshot machinery — just **slice → record → stitch.**

## Why "rerender"

The export is a *re-render* of the preview — the same React tree, played once and recorded — so
the two can't drift. And `rerender` is already React's word for it: the audience this is for
reads it as native vocabulary.

## The honest tradeoffs

- **Each slice must render at ≥1× real-time.** Slicing parallelizes wall-clock, not per-frame cost.
  A composition that drops frames at 1× won't be saved by slicing — those fall back to frame-stepping.
- **Seam accuracy.** Slices must start/stop on exact frames (keyframe-aligned) so the stitch never
  drops or doubles a frame at a boundary.
- **It's browser-bound.** Rendering is a real browser on your own machines/VMs — that's *why*
  arbitrary CSS works and parity is free, but it's not a from-scratch WASM renderer.

## Status

Just started — the architecture is proven end-to-end (the record-the-preview path was spiked and
works); this repo is the clean build. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

MIT
