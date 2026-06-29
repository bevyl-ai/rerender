// Fully client-side export — the renderer with NO server. The composition mounts to real
// DOM, we frame-step it (flushSync, like the headless StepStage), capture each frame by
// serializing the live DOM into an SVG <foreignObject> and rasterizing it to a canvas
// (the in-browser stand-in for a CDP screenshot), then encode with WebCodecs + mux with
// mediabunny — both already browser-native. Result: an mp4 Blob produced entirely in the
// user's tab. Works for inline-styled compositions (the Remotion/remover convention);
// <video> frames and backdrop-filter are not captured by foreignObject (see exportToMp4).
import { type ComponentType, type ReactElement, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny';
import { ConfigContext, FrameContext, PlayingContext, TimelineContext, type VideoConfig } from '../core/frame';
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

/** Wait for every <video> in the stage to finish seeking to the current frame — the
 *  client-side equivalent of the headless settle()'s video wait. */
async function settleVideos(stage: HTMLElement): Promise<void> {
  const videos = Array.from(stage.querySelectorAll('video'));
  if (!videos.length) return;
  await Promise.all(
    videos.map((v) =>
      v.readyState >= 2 && !v.seeking
        ? Promise.resolve()
        : new Promise<void>((res) => v.addEventListener('seeked', () => res(), { once: true })),
    ),
  );
}

/** Capture one frame: composite each <video> natively (its laid-out box, object-fit and
 *  transform reflected via getBoundingClientRect), then draw the DOM overlay — everything
 *  except the videos — on top via an SVG foreignObject. Correct for the common structure
 *  of a video background (or mid-stack) with DOM overlays above it. */
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

  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);

  // Harness mirrors the headless StepStage: a frame we drive synchronously via flushSync.
  let drive!: (f: number) => void;
  function Harness(): ReactElement {
    const [frame, setFrame] = useState(0);
    drive = setFrame;
    return (
      <div style={{ width, height, position: 'relative', overflow: 'hidden' }}>
        <ConfigContext.Provider value={config}>
          <PlayingContext.Provider value={false}>
            <TimelineContext.Provider value={frame}>
              <FrameContext.Provider value={frame}>
                <Component {...props} />
              </FrameContext.Provider>
            </TimelineContext.Provider>
          </PlayingContext.Provider>
        </ConfigContext.Provider>
      </div>
    );
  }
  flushSync(() => root.render(<Harness />));
  const stage = host.firstElementChild as HTMLElement;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH });
  out.addVideoTrack(source, { frameRate: fps });
  await out.start();

  try {
    await document.fonts.ready;
    // wait for any <video> to have decodable data before the first capture
    await Promise.all(
      Array.from(stage.querySelectorAll('video')).map((v) =>
        v.readyState >= 2 ? Promise.resolve() : new Promise<void>((res) => v.addEventListener('loadeddata', () => res(), { once: true })),
      ),
    );
    for (let f = 0; f < durationInFrames; f++) {
      if (signal?.aborted) throw new Error('export aborted');
      flushSync(() => drive(f));
      await settleVideos(stage); // let <video> elements seek to frame f before capture
      await paintFrame(stage, ctx, width, height);
      await source.add(f / fps, 1 / fps, f === 0 ? { keyFrame: true } : undefined);
      onProgress?.(f + 1, durationInFrames);
    }
    await out.finalize();
    return new Blob([(out.target as BufferTarget).buffer!], { type: 'video/mp4' });
  } finally {
    root.unmount();
    host.remove();
  }
}
