// <Player> — the preview. Mounts the composition at native resolution, scales it to
// fit, and drives the frame clock. What plays here is exactly what the recorder
// records — preview and render are the same DOM, by construction.
import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { ConfigContext, FrameContext, PlayingContext, type VideoConfig } from './frame';
import { injectRemoverCSS } from './default-css';

injectRemoverCSS(); // match Remotion's global reset so preview == render == Remotion

export interface PlayerProps extends VideoConfig {
  composition: ComponentType;
  controls?: boolean;
  /** Display height in px; the composition is scaled to fit. */
  displayHeight?: number;
  style?: CSSProperties;
}

export function Player({
  composition: Composition,
  width,
  height,
  fps,
  durationInFrames,
  controls = true,
  displayHeight = 600,
  style,
}: PlayerProps): JSX.Element {
  const config: VideoConfig = { width, height, fps, durationInFrames };
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const anchor = useRef({ t: 0, f: 0 });

  useEffect(() => {
    if (!playing) return;
    anchor.current = { t: performance.now(), f: frame >= durationInFrames - 1 ? 0 : frame };
    const tick = (): void => {
      const elapsed = (performance.now() - anchor.current.t) / 1000;
      let f = anchor.current.f + Math.floor(elapsed * fps);
      if (f >= durationInFrames) {
        f = 0;
        anchor.current = { t: performance.now(), f: 0 };
      }
      setFrame(f);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, fps, durationInFrames]);

  const scale = displayHeight / height;
  const displayWidth = width * scale;

  return (
    <div style={{ width: displayWidth, ...style }}>
      <div
        style={{
          width: displayWidth,
          height: displayHeight,
          overflow: 'hidden',
          background: '#000',
          borderRadius: 12,
          position: 'relative',
        }}
      >
        <div
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        >
          <ConfigContext.Provider value={config}>
            <PlayingContext.Provider value={playing}>
              <FrameContext.Provider value={frame}>
                <Composition />
              </FrameContext.Provider>
            </PlayingContext.Provider>
          </ConfigContext.Provider>
        </div>
      </div>

      {controls && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 12,
            color: '#e9e9ee',
            font: '13px ui-monospace, monospace',
          }}
        >
          <button
            onClick={() => setPlaying((p) => !p)}
            style={{
              width: 38,
              height: 38,
              flex: 'none',
              borderRadius: '50%',
              border: '1px solid #2a2a30',
              background: '#141417',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {playing ? '❙❙' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={durationInFrames - 1}
            value={frame}
            onChange={(e) => {
              setPlaying(false);
              setFrame(Number(e.target.value));
            }}
            style={{ flex: 1 }}
          />
          <span style={{ color: '#8a8a93', minWidth: 90, textAlign: 'right' }}>
            {(frame / fps).toFixed(1)}s / {((durationInFrames - 1) / fps).toFixed(1)}s
          </span>
        </div>
      )}
    </div>
  );
}
