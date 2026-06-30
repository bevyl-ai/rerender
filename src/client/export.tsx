// Fully client-side export — the renderer with NO server. The composition mounts to real
// DOM, we frame-step it (flushSync, like the headless StepStage), capture each frame by
// serializing the live DOM into an SVG <foreignObject> and rasterizing it to a canvas
// (the in-browser stand-in for a CDP screenshot), then encode with WebCodecs + mux with
// mediabunny — both already browser-native. Result: an mp4 Blob produced entirely in the
// user's tab. Works for inline-styled compositions (the Remotion/rerender convention).
// <video> is handled by compositing it natively under the foreignObject (see paintFrame);
// backdrop-filter and other compositor-only effects still aren't captured.
import { type ComponentType, type ReactElement, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type VideoSample,
  VideoSampleSink,
} from 'mediabunny';
import { CompositionFrame, type VideoConfig } from '../core/frame';
import type { VideoCodec } from '../renderer/types';

export interface ClientExportOptions {
  Component: ComponentType<Record<string, unknown>>;
  props?: Record<string, unknown>;
  config: VideoConfig;
  codec?: VideoCodec;
  onProgress?: (done: number, total: number) => void;
  /** Called after each frame is painted, with the live capture canvas — for a preview/filmstrip
   *  during export. The canvas is reused every frame, so snapshot it synchronously if needed. */
  onFrame?: (canvas: HTMLCanvasElement, frame: number) => void;
  signal?: AbortSignal;
}

const loadImage = (url: string, w: number, h: number): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image(w, h);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('foreignObject rasterization failed'));
    img.src = url;
  });

/** Draw a <video>'s current frame into a destination box with object-fit semantics.
 *  (Chrome's SVG-as-image secure mode won't render nested raster images, so videos can't
 *  ride inside the foreignObject — they're composited natively underneath it instead.) */
function drawVideo(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, dx: number, dy: number, dw: number, dh: number, fit: string): void {
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) return;
  const boxRatio = dw / dh;
  const vidRatio = vw / vh;
  if (fit === 'contain') {
    let tw = dw;
    let th = dh;
    if (vidRatio > boxRatio) th = dw / vidRatio;
    else tw = dh * vidRatio;
    ctx.drawImage(v, 0, 0, vw, vh, dx + (dw - tw) / 2, dy + (dh - th) / 2, tw, th);
    return;
  }
  // cover (default): crop the source to the box aspect, centered
  let sw = vw;
  let sh = vh;
  if (vidRatio > boxRatio) {
    sw = vh * boxRatio;
  } else {
    sh = vw / boxRatio;
  }
  ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, dx, dy, dw, dh);
}

/** Draw a decoded mediabunny VideoSample into a destination box with object-fit semantics —
 *  the deterministic path. We decode the clip ourselves (WebCodecs via mediabunny) at the
 *  exact source time the <video> is seeked to, so a frame is always present, regardless of
 *  whether the element managed to paint it (offscreen/throttled tabs otherwise capture black). */
function drawSample(ctx: CanvasRenderingContext2D, s: VideoSample, dx: number, dy: number, dw: number, dh: number, fit: string): void {
  const vw = s.displayWidth;
  const vh = s.displayHeight;
  if (!vw || !vh) return;
  const boxRatio = dw / dh;
  const vidRatio = vw / vh;
  if (fit === 'contain') {
    let tw = dw;
    let th = dh;
    if (vidRatio > boxRatio) th = dw / vidRatio;
    else tw = dh * vidRatio;
    s.draw(ctx, 0, 0, vw, vh, dx + (dw - tw) / 2, dy + (dh - th) / 2, tw, th);
    return;
  }
  let sw = vw;
  let sh = vh;
  if (vidRatio > boxRatio) sw = vh * boxRatio;
  else sh = vw / boxRatio;
  s.draw(ctx, (vw - sw) / 2, (vh - sh) / 2, sw, sh, dx, dy, dw, dh);
}

/** Open a mediabunny decoder (VideoSampleSink) for each distinct <video> source in the stage,
 *  so paintFrame can pull the exact source frame deterministically. Falls back to the element
 *  for any source that can't be opened (e.g. CORS). */
async function openVideoSinks(stage: HTMLElement): Promise<Map<string, VideoSampleSink>> {
  const sinks = new Map<string, VideoSampleSink>();
  const srcs = new Set(
    Array.from(stage.querySelectorAll('video'))
      .map((v) => v.src)
      .filter(Boolean),
  );
  for (const src of srcs) {
    try {
      // Fetch the whole clip into memory and decode from a BlobSource — no HTTP range
      // requests, so this works on hosts that don't serve 206 (e.g. Cloudflare Workers assets).
      const blob = await (await fetch(src)).blob();
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
      const track = await input.getPrimaryVideoTrack();
      if (track) sinks.set(src, new VideoSampleSink(track));
    } catch {
      /* fall back to the <video> element for this source */
    }
  }
  return sinks;
}

/** Capture one frame: composite each <video> natively (its laid-out box, with object-fit
 *  and any scale/translate transform reflected via getBoundingClientRect — rotation/skew
 *  are not), then draw the DOM overlay — everything except the videos — on top via an SVG
 *  foreignObject. Correct for the common structure of a video background (or mid-stack)
 *  with DOM overlays above it. */
async function paintFrame(
  stage: HTMLElement,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frames: Map<HTMLVideoElement, AsyncGenerator<VideoSample | null>>,
): Promise<void> {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const stageRect = stage.getBoundingClientRect();
  const sx = w / stageRect.width;
  const sy = h / stageRect.height;
  for (const v of Array.from(stage.querySelectorAll('video'))) {
    const r = v.getBoundingClientRect();
    const dx = (r.left - stageRect.left) * sx;
    const dy = (r.top - stageRect.top) * sy;
    const dw = r.width * sx;
    const dh = r.height * sy;
    const fit = getComputedStyle(v).objectFit || 'fill';
    const gen = frames.get(v);
    if (gen) {
      const sample = (await gen.next()).value; // next decoded frame, in order
      if (sample) {
        drawSample(ctx, sample, dx, dy, dw, dh, fit);
        sample.close();
      }
    } else if (v.videoWidth) {
      drawVideo(ctx, v, dx, dy, dw, dh, fit);
    }
  }

  const clone = stage.cloneNode(true) as HTMLElement;
  for (const el of Array.from(clone.querySelectorAll('video'))) el.remove();
  const inner = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml"><style>*{box-sizing:border-box}</style>${inner}</div>` +
    `</foreignObject></svg>`;
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, w, h);
  ctx.drawImage(img, 0, 0, w, h);
}

/** Render `Component` to an mp4 Blob entirely in the browser — no server, no ffmpeg. */
export async function exportToMp4(opts: ClientExportOptions): Promise<Blob> {
  const { Component, props = {}, config, codec = 'avc', onProgress, onFrame, signal } = opts;
  const { width, height, fps, durationInFrames } = config;

  // Mount the composition offscreen. Drive the frame via a stable setter captured in a ref
  // (initialised to a no-op, so it's never undefined); flushSync commits each frame
  // synchronously — like the headless StepStage — so the DOM is ready to capture. Updating
  // state (rather than re-rendering the root) keeps <video> elements seeking, not remounting.
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  const setFrameRef: { current: (f: number) => void } = { current: () => {} };
  function Harness(): ReactElement {
    const [frame, setFrame] = useState(0);
    setFrameRef.current = setFrame;
    return <CompositionFrame Component={Component} props={props} config={config} frame={frame} playing={false} />;
  }
  flushSync(() => root.render(<Harness />));
  const stage = host.firstElementChild as HTMLElement;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  // Decode footage SEQUENTIALLY (one forward pass per <video>, no per-frame re-seeking, which
  // is ~10× faster). Pass 1: frame-step once to record the source time each <video> is at on
  // each frame — cheap, no raster/decode (flushSync flushes rerender's <Video> effect, which
  // sets currentTime synchronously). Pass 2 (the main loop) pulls decoded frames in order.
  const sinks = await openVideoSinks(stage);
  const videoEls = Array.from(stage.querySelectorAll('video'));
  const timelines = new Map<HTMLVideoElement, number[]>(videoEls.map((v) => [v, []]));
  for (let f = 0; f < durationInFrames; f++) {
    flushSync(() => setFrameRef.current(f));
    for (const v of videoEls) timelines.get(v)?.push(v.currentTime);
  }
  const frames = new Map<HTMLVideoElement, AsyncGenerator<VideoSample | null>>();
  for (const v of videoEls) {
    const sink = sinks.get(v.src);
    if (sink) frames.set(v, sink.samplesAtTimestamps(timelines.get(v) ?? []));
  }

  try {
    await document.fonts.ready;
    for (let f = 0; f < durationInFrames; f++) {
      if (signal?.aborted) throw new Error('export aborted');
      flushSync(() => setFrameRef.current(f));
      await paintFrame(stage, ctx, width, height, frames);
      onFrame?.(canvas, f);
      await source.add(f / fps, 1 / fps, f === 0 ? { keyFrame: true } : undefined);
      onProgress?.(f + 1, durationInFrames);
    }
    await output.finalize();
    if (!target.buffer) throw new Error('mediabunny finalize produced no data');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    root.unmount();
    host.remove();
  }
}
