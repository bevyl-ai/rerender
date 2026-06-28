// Render page. Two modes:
//   realtime (default) — plays from→to via rAF; Playwright recordVideo captures it.
//   step (?step=1)     — paused; Playwright drives window.__setFrame(f) per frame and
//                        screenshots → recorded-frame N == composition-frame N exactly.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigContext, FrameContext, PlayingContext } from '../src/core/frame';
import { getPendingDelays } from '../src/core/delay-render';
import { byId, examples } from '../examples/registry';

if (typeof window !== 'undefined') window.__removerEnv = 'rendering';

const p = new URLSearchParams(location.search);
const entry = byId(p.get('comp') ?? '') ?? examples[examples.length - 1]!;
const config = {
  width: Number(p.get('w')) || entry.width,
  height: Number(p.get('h')) || entry.height,
  fps: Number(p.get('fps')) || entry.fps,
  durationInFrames: Number(p.get('dur')) || entry.durationInFrames,
};
const from = Number(p.get('from')) || 0;
const to = Number(p.get('to')) || config.durationInFrames;
const stepMode = p.has('step');

declare global {
  interface Window {
    __renderDone?: boolean;
    __ready?: boolean;
    __setFrame?: (f: number) => Promise<void>;
  }
}

const Composition = entry.component;

function Stage({ frame }: { frame: number }): JSX.Element {
  return (
    <div style={{ width: config.width, height: config.height, position: 'relative', overflow: 'hidden' }}>
      <ConfigContext.Provider value={config}>
        <PlayingContext.Provider value={!stepMode}>
          <FrameContext.Provider value={frame}>
            <Composition />
          </FrameContext.Provider>
        </PlayingContext.Provider>
      </ConfigContext.Provider>
    </div>
  );
}

const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

// Resolves once React has committed + painted the new frame and every <video> has
// finished seeking to its target time — i.e. the frame is fully settled to capture.
async function settle(): Promise<void> {
  await raf();
  await raf(); // commit + paint, then the seek effect has run
  // wait for any delayRender() holds (e.g. async audio decode) to clear
  let guard = 0;
  while (getPendingDelays() > 0 && guard++ < 600) await raf();
  await raf();
  await raf(); // let the post-load re-render paint
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

function RealtimeStage(): JSX.Element {
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
  return <Stage frame={frame} />;
}

function StepStage(): JSX.Element {
  const [frame, setFrame] = useState(from);
  useEffect(() => {
    window.__setFrame = (f: number) =>
      new Promise<void>((resolve) => {
        setFrame(f);
        void settle().then(resolve);
      });
    window.__ready = true;
  }, []);
  return <Stage frame={frame} />;
}

const root = document.getElementById('stage');
if (!root) throw new Error('no #stage');
createRoot(root).render(stepMode ? <StepStage /> : <RealtimeStage />);
