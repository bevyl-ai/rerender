// Drag the track, get the frame. That's the whole demo.
//
// The source is a plain mp4 on a static host — no sprite sheet, no pre-rendered thumbnails, no
// server. Every frame drawn here was located in the file's own sample table, fetched as one small
// Range request, and decoded by WebCodecs in the moment you asked for it.
//
// Pointer moves are coalesced latest-wins: one extract in flight at a time, and when it lands, if
// the pointer has moved on, go again for wherever it is now. snapToSampleMicros means a move that
// stays within the same frame costs nothing at all.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createFrameExtractor, type FrameExtractor } from '../src/extract';
import { ACCENT, card, cardLabel, SMOKE_TEST } from './ui';

const SRC = '/sintel-480p.mp4';
/** The source's native size (2.35:1, letterbox cropped out) — the canvas draws 1:1, CSS fits it. */
const FRAME_W = 854;
const FRAME_H = 362;
/** Arrow-key step, in seconds. */
const KEY_STEP = 0.5;
/** Where the scrubber opens: mid-trailer, on the flight over the city. */
const OPENING_RATIO = 0.52;

const timecode = (seconds: number): string => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}.${Math.floor((seconds - whole) * 100)
    .toString()
    .padStart(2, '0')}`;
};

interface Readout {
  seconds: number;
  ms: number;
  bytes: number;
}

export function ExtractShowcase(): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const extractor = useRef<FrameExtractor | null>(null);
  /** Where the pointer is, in seconds. Written on every move, read by the pump. */
  const target = useRef(0);
  const inFlight = useRef(false);
  /** Presentation µs of the frame currently painted — a move that resolves here is a no-op. */
  const painted = useRef(-1);
  /** Bytes for the in-progress extract, tallied by the wrapped fetch. */
  const bytes = useRef(0);

  const [duration, setDuration] = useState(0);
  const [ratio, setRatio] = useState(0);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [err, setErr] = useState('');

  const supported = typeof VideoDecoder !== 'undefined';

  const countingFetch = useCallback<typeof fetch>(async (input, init) => {
    const res = await fetch(input, init);
    bytes.current += Number(res.headers.get('content-length') ?? 0);
    return res;
  }, []);

  /** Drains toward `target` until the painted frame is the one the pointer is on. */
  const pump = useCallback(async () => {
    const live = extractor.current;
    if (!live || inFlight.current) return;
    inFlight.current = true;
    try {
      for (;;) {
        const seconds = target.current;
        if (live.snapToSampleMicros(seconds) === painted.current) break;
        bytes.current = 0;
        const started = performance.now();
        await live.extract([seconds], (frame) => {
          canvas.current?.getContext('2d')?.drawImage(frame, 0, 0, FRAME_W, FRAME_H);
          frame.close();
        });
        painted.current = live.snapToSampleMicros(seconds);
        setReadout({ seconds, ms: performance.now() - started, bytes: bytes.current });
        if (target.current === seconds) break; // pointer didn't move while we decoded
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.current = false;
    }
  }, []);

  const seekTo = useCallback(
    (nextRatio: number) => {
      const clamped = Math.min(1, Math.max(0, nextRatio));
      setRatio(clamped);
      target.current = clamped * duration;
      void pump();
    },
    [duration, pump],
  );

  useEffect(() => {
    if (!supported || SMOKE_TEST) return;
    let disposed = false;
    void (async () => {
      try {
        const live = await createFrameExtractor({ src: SRC, fetchFn: countingFetch });
        if (disposed) return live.dispose();
        extractor.current = live;
        setDuration(live.durationSeconds);
        target.current = live.durationSeconds * OPENING_RATIO;
        setRatio(OPENING_RATIO);
        void pump();
      } catch (error) {
        setErr(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      disposed = true;
      extractor.current?.dispose();
      extractor.current = null;
    };
  }, [countingFetch, pump, supported]);

  const onPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.type === 'pointermove' && event.buttons === 0 && event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    seekTo((event.clientX - rect.left) / rect.width);
  };

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const delta = event.key === 'ArrowRight' ? KEY_STEP : event.key === 'ArrowLeft' ? -KEY_STEP : 0;
    if (delta === 0 || duration === 0) return;
    event.preventDefault();
    seekTo((target.current + delta) / duration);
  };

  return (
    <div>
      <div style={card}>
        <div style={cardLabel}>
          <span>● {supported ? 'DRAG TO SCRUB' : 'rerender/extract'}</span>
          <span style={{ color: ACCENT }}>createFrameExtractor()</span>
        </div>

        <canvas
          ref={canvas}
          width={FRAME_W}
          height={FRAME_H}
          style={{ display: 'block', width: '100%', aspectRatio: `${FRAME_W} / ${FRAME_H}`, background: '#08080b' }}
        />

        {/* biome-ignore lint/a11y/useSemanticElements: a range input can't carry the playhead + tick rendering */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(ratio * duration)}
          aria-valuetext={timecode(ratio * duration)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            onPointer(event);
          }}
          onPointerMove={onPointer}
          onKeyDown={onKey}
          style={{
            position: 'relative',
            height: 46,
            borderTop: '1px solid #1d1d25',
            cursor: supported ? 'ew-resize' : 'default',
            touchAction: 'none',
            background: 'linear-gradient(#101017, #0c0c12)',
          }}
        >
          {/* one tick per 5 s, so the track reads as a timeline rather than a progress bar */}
          {duration > 0 &&
            Array.from({ length: Math.floor(duration / 5) }, (_, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${(((i + 1) * 5) / duration) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: '#1d1d25',
                }}
              />
            ))}
          <div
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${ratio * 100}%`, background: 'rgba(97,175,239,0.10)' }}
          />
          <div style={{ position: 'absolute', left: `${ratio * 100}%`, top: 0, bottom: 0, width: 2, background: ACCENT, marginLeft: -1 }} />
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          minHeight: 20,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 13,
          color: '#6a6a76',
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        {!supported ? (
          <span>This browser has no VideoDecoder — WebCodecs ships in Chrome/Edge 94+ and Safari 17+.</span>
        ) : err ? (
          <span style={{ color: '#ff6b6b' }}>✗ {err}</span>
        ) : readout ? (
          <>
            <span style={{ color: '#cfcfd8' }}>{timecode(readout.seconds)}</span>
            <span>·</span>
            <span>
              fetched + decoded in <span style={{ color: '#cfcfd8' }}>{readout.ms.toFixed(0)} ms</span>
            </span>
            <span>·</span>
            <span>
              <span style={{ color: '#cfcfd8' }}>{(readout.bytes / 1024).toFixed(1)} KB</span> off the wire
            </span>
          </>
        ) : (
          <span>indexing…</span>
        )}
      </div>
    </div>
  );
}
