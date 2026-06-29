// Shared render stage — drives a single composition for capture, in two modes:
//   realtime — plays from→to via rAF (Playwright recordVideo captures it).
//   step     — paused; Playwright drives window.__setFrame(f) per frame, so
//              recorded-frame N == composition-frame N exactly.
// Used by both the examples render page and the studio (registered-Root) page.
import { useEffect, useState, type ComponentType } from 'react';
import { ConfigContext, FrameContext, PlayingContext, TimelineContext } from '../src/core/frame';
import { getPendingDelays } from '../src/core/delay-render';
import { injectRemoverCSS } from '../src/core/default-css';

injectRemoverCSS(); // match Remotion's global reset (box-sizing: border-box)

export interface StageConfig {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

declare global {
  interface Window {
    __renderDone?: boolean;
    __ready?: boolean;
    __setFrame?: (f: number) => Promise<void>;
    __config?: StageConfig;
  }
}

const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

// Resolves once React has committed + painted the frame, any delayRender() holds
// (e.g. async audio decode) have cleared, and every <video> has finished seeking.
async function settle(): Promise<void> {
  await raf();
  await raf();
  let guard = 0;
  while (getPendingDelays() > 0 && guard++ < 600) await raf();
  await raf();
  await raf();
  const videos = Array.from(document.querySelectorAll('video'));
  await Promise.all(
    videos.map((v) =>
      v.readyState >= 2 && !v.seeking
        ? Promise.resolve()
        : new Promise<void>((res) => v.addEventListener('seeked', () => res(), { once: true })),
    ),
  );
  await raf();
}

interface FrameProps {
  Component: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
  config: StageConfig;
  playing: boolean;
  frame: number;
}

function Frame({ Component, props, config, playing, frame }: FrameProps): JSX.Element {
  return (
    <div style={{ width: config.width, height: config.height, position: 'relative', overflow: 'hidden' }}>
      <ConfigContext.Provider value={config}>
        <PlayingContext.Provider value={playing}>
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

interface StageProps {
  Component: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
  config: StageConfig;
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
        window.__renderDone = true;
        return;
      }
      setFrame(f);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  return <Frame Component={Component} props={props} config={config} playing frame={frame} />;
}

function StepStage({ Component, props, config, from }: Omit<StageProps, 'stepMode' | 'to'>): JSX.Element {
  const [frame, setFrame] = useState(from);
  useEffect(() => {
    window.__setFrame = (f: number) =>
      new Promise<void>((resolve) => {
        setFrame(f);
        void settle().then(resolve);
      });
    window.__ready = true;
  }, []);
  return <Frame Component={Component} props={props} config={config} playing={false} frame={frame} />;
}

export function Stage({ Component, props, config, from, to, stepMode }: StageProps): JSX.Element {
  if (typeof window !== 'undefined') {
    window.__removerEnv = 'rendering';
    window.__config = config;
  }
  return stepMode ? (
    <StepStage Component={Component} props={props} config={config} from={from} />
  ) : (
    <RealtimeStage Component={Component} props={props} config={config} from={from} to={to} />
  );
}
