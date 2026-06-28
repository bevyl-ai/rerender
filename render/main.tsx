// Render page: the composition ONLY (no Player chrome), at native resolution,
// played from `from`→`to` in real time. Playwright records this page; setting
// window.__renderDone signals the segment is finished. Query params drive the
// frame range so a slice can render just its part.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigContext, FrameContext, PlayingContext } from '../src/core/frame';
import { Demo } from '../demo/composition';

const p = new URLSearchParams(location.search);
const config = {
  width: Number(p.get('w')) || 1080,
  height: Number(p.get('h')) || 1920,
  fps: Number(p.get('fps')) || 30,
  durationInFrames: Number(p.get('dur')) || 90,
};
const from = Number(p.get('from')) || 0;
const to = Number(p.get('to')) || config.durationInFrames;

declare global {
  interface Window {
    __renderDone?: boolean;
  }
}

function RenderStage(): JSX.Element {
  const [frame, setFrame] = useState(from);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = (): void => {
      const elapsed = (performance.now() - t0) / 1000;
      const f = from + Math.floor(elapsed * config.fps);
      if (f >= to) {
        setFrame(to - 1);
        window.__renderDone = true;
        return;
      }
      setFrame(f);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{ width: config.width, height: config.height, position: 'relative', overflow: 'hidden' }}>
      <ConfigContext.Provider value={config}>
        <PlayingContext.Provider value={true}>
          <FrameContext.Provider value={frame}>
            <Demo />
          </FrameContext.Provider>
        </PlayingContext.Provider>
      </ConfigContext.Provider>
    </div>
  );
}

const root = document.getElementById('stage');
if (!root) throw new Error('no #stage');
createRoot(root).render(<RenderStage />);
