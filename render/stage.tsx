// Shared render stage — drives a single composition in two modes:
//   step     — paused; the renderer drives window.__setFrame(f) per frame over CDP, so
//              captured-frame N == composition-frame N exactly. This is the render path.
//   realtime — plays from→to via rAF; the studio's in-browser preview uses this.
// Used by the examples render page and the studio (registered-Root) page.
import { useEffect, useState, type ComponentType } from 'react';
import { flushSync } from 'react-dom';
import { CompositionFrame, type VideoConfig } from '../src/core/frame';
import { getPendingDelays } from '../src/core/delay-render';
import { injectRerenderCSS } from '../src/core/default-css';

// Module-load side effects (this module only ever executes in the render/studio browser):
injectRerenderCSS(); // match Remotion's global reset (box-sizing: border-box)
if (typeof window !== 'undefined') window.__rerenderEnv = 'rendering';

declare global {
  interface Window {
    __ready?: boolean;
    __setFrame?: (f: number) => Promise<void>;
  }
}

const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

// Resolves once React has committed the frame, any delayRender() holds (e.g. async data
// or an <Img> still loading) have cleared, all fonts are loaded, and every <video> has
// finished seeking. The fast path (no delays, no fonts pending, no <video>) is cheap.
async function settle(): Promise<void> {
  // The frame is already committed synchronously (flushSync in __setFrame), and the
  // CDP screenshot rasters the committed DOM — so the fast path needs no rAF at all.
  // Only genuinely-async work waits: delayRender() holds, font loads, and <video> seeks.
  let guard = 0;
  while (getPendingDelays() > 0 && guard++ < 600) await raf();
  // Web/brand fonts: don't screenshot text before its font has loaded (else it renders in
  // a fallback face). document.fonts.ready re-pends when a new font starts loading.
  if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length) {
    await Promise.all(
      videos.map((v) =>
        v.readyState >= 2 && !v.seeking
          ? Promise.resolve()
          : new Promise<void>((res) => v.addEventListener('seeked', () => res(), { once: true })),
      ),
    );
    await raf(); // let the newly-seeked video frame composite before capture
  }
}

interface StageProps {
  Component: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
  config: VideoConfig;
  from: number;
  to: number;
  stepMode: boolean;
}

function RealtimeStage({ Component, props, config, from, to }: Omit<StageProps, 'stepMode'>): JSX.Element {
  const [frame, setFrame] = useState(from);
  useEffect(() => {
    const t0 = performance.now();
    let id = 0;
    const tick = (): void => {
      const f = from + Math.floor(((performance.now() - t0) / 1000) * config.fps);
      if (f >= to) {
        setFrame(to - 1);
        return;
      }
      setFrame(f);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  return <CompositionFrame Component={Component} props={props} config={config} playing frame={frame} />;
}

function StepStage({ Component, props, config, from }: Omit<StageProps, 'stepMode' | 'to'>): JSX.Element {
  const [frame, setFrame] = useState(from);
  useEffect(() => {
    window.__setFrame = (f: number) =>
      new Promise<void>((resolve) => {
        flushSync(() => setFrame(f)); // commit the new frame synchronously — no rAF needed
        void settle().then(resolve);
      });
    window.__ready = true;
  }, []);
  return <CompositionFrame Component={Component} props={props} config={config} playing={false} frame={frame} />;
}

export function Stage({ Component, props, config, from, to, stepMode }: StageProps): JSX.Element {
  return stepMode ? (
    <StepStage Component={Component} props={props} config={config} from={from} />
  ) : (
    <RealtimeStage Component={Component} props={props} config={config} from={from} to={to} />
  );
}
