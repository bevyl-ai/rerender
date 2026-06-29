// Fully client-side export — the renderer with NO server. The composition mounts to real
// DOM, we frame-step it (flushSync, like the headless StepStage), capture each frame by
// serializing the live DOM into an SVG <foreignObject> and rasterizing it to a canvas
// (the in-browser stand-in for a CDP screenshot), then encode with WebCodecs + mux with
// mediabunny — both already browser-native. Result: an mp4 Blob produced entirely in the
// user's tab. Works for inline-styled compositions (the Remotion/remover convention).
// <video> is handled by compositing it natively under the foreignObject (see paintFrame);
// backdrop-filter and other compositor-only effects still aren't captured.
import { type ComponentType, type ReactElement, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny';
import { CompositionFrame, type VideoConfig } from '../core/frame';
import type { VideoCodec } from '../renderer/types';

export interface ClientExportOptions {
  Component: ComponentType<Record<string, unknown>>;
  props?: Record<string, unknown>;
  config: VideoConfig;
  codec?: VideoCodec;
  onProgress?: (done: number, total: number) => void;
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

const once = (el: EventTarget, event: string): Promise<void> =>
  new Promise((res) => el.addEventListener(event, () => res(), { once: true }));

/** Wait for every <video> to have a decodable frame at the current position — the
 *  client-side equivalent of the headless settle()'s video wait. Check `seeking` FIRST: a
 *  seek transiently drops readyState below 2, and `loadeddata` only fires once (initial
 *  load), so waiting on it mid-seek would hang — `seeked` is the event that fires. (A rAF
 *  would also hang: a non-foregrounded tab throttles it to ~0; drawImage reads the decoded
 *  frame directly, so no rAF is needed.) */
async function settleVideos(stage: HTMLElement): Promise<void> {
  await Promise.all(
    Array.from(stage.querySelectorAll('video')).map(async (v) => {
      if (v.seeking) await once(v, 'seeked');
      else if (v.readyState < 2) await once(v, 'loadeddata');
    }),
  );
}

/** Capture one frame: composite each <video> natively (its laid-out box, with object-fit
 *  and any scale/translate transform reflected via getBoundingClientRect — rotation/skew
 *  are not), then draw the DOM overlay — everything except the videos — on top via an SVG
 *  foreignObject. Correct for the common structure of a video background (or mid-stack)
 *  with DOM overlays above it. */
async function paintFrame(stage: HTMLElement, ctx: CanvasRenderingContext2D, w: number, h: number): Promise<void> {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const stageRect = stage.getBoundingClientRect();
  const sx = w / stageRect.width;
  const sy = h / stageRect.height;
  for (const v of Array.from(stage.querySelectorAll('video'))) {
    if (!v.videoWidth) continue;
    const r = v.getBoundingClientRect();
    drawVideo(
      ctx,
      v,
      (r.left - stageRect.left) * sx,
      (r.top - stageRect.top) * sy,
      r.width * sx,
      r.height * sy,
      getComputedStyle(v).objectFit || 'fill',
    );
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
  const { Component, props = {}, config, codec = 'avc', onProgress, signal } = opts;
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

  try {
    await document.fonts.ready;
    for (let f = 0; f < durationInFrames; f++) {
      if (signal?.aborted) throw new Error('export aborted');
      flushSync(() => setFrameRef.current(f));
      await settleVideos(stage); // ensure <video>s are decodable + seeked to frame f
      await paintFrame(stage, ctx, width, height);
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
