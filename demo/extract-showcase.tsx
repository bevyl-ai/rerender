// A filmstrip, assembled in this tab, that you can scrub.
//
// The source is a plain mp4 on a static host: no sprite sheet, no pre-rendered thumbnails, no
// server. The strip is one extract() call for N evenly spaced timestamps, which groups them by GOP
// and fetches each GOP once. The big frame above it is a second extract for wherever the playhead
// is. Both are located through the file's own sample table and decoded by WebCodecs.
//
// Pointer moves are coalesced latest-wins: one seek in flight at a time, and when it lands, if the
// pointer has moved on, go again for wherever it is now. snapToSampleMicros means a move that stays
// within the same frame costs nothing at all.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createFrameExtractor, type FrameExtractor } from '../src/extract';
import { ACCENT, card, SMOKE_TEST } from './ui';

const SRC = '/sintel-480p.mp4';
/** The source's native size (2.35:1, letterbox cropped out) — the canvas draws 1:1, CSS fits it. */
const FRAME_W = 854;
const FRAME_H = 362;
/** Filmstrip thumbnail size, CSS px. The count falls out of however wide the strip renders. */
const THUMB_W = 116;
const THUMB_H = Math.round((THUMB_W * FRAME_H) / FRAME_W);
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

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`;

/** Resolves with the element's width once it has one. */
const measured = (el: HTMLElement): Promise<number> =>
  new Promise((resolve) => {
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === 0) return;
      observer.disconnect();
      resolve(el.clientWidth);
    });
    observer.observe(el);
  });

interface Seek {
  seconds: number;
  ms: number;
  bytes: number;
}

interface Strip {
  frames: number;
  ms: number;
  bytes: number;
}

export function ExtractShowcase(): JSX.Element {
  const preview = useRef<HTMLCanvasElement>(null);
  const strip = useRef<HTMLCanvasElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const extractor = useRef<FrameExtractor | null>(null);
  /** Where the pointer is, in seconds. Written on every move, read by the pump. */
  const target = useRef(0);
  const inFlight = useRef(false);
  /** Presentation µs of the frame currently in the preview — a move that resolves here is a no-op. */
  const painted = useRef(-1);
  /** Running total from the wrapped fetch; each measured operation snapshots it before and after. */
  const bytes = useRef(0);

  const [duration, setDuration] = useState(0);
  const [ratio, setRatio] = useState(0);
  const [seek, setSeek] = useState<Seek | null>(null);
  const [built, setBuilt] = useState<Strip | null>(null);
  const [err, setErr] = useState('');
  /** Drops the drag hint once the visitor has worked out that they can. */
  const [touched, setTouched] = useState(false);

  const supported = typeof VideoDecoder !== 'undefined';

  const countingFetch = useCallback<typeof fetch>(async (input, init) => {
    const res = await fetch(input, init);
    bytes.current += Number(res.headers.get('content-length') ?? 0);
    return res;
  }, []);

  /** Drains toward `target` until the preview holds the frame the pointer is on. */
  const pump = useCallback(async () => {
    const live = extractor.current;
    if (!live || inFlight.current) return;
    inFlight.current = true;
    try {
      for (;;) {
        const seconds = target.current;
        if (live.snapToSampleMicros(seconds) === painted.current) break;
        const startedBytes = bytes.current;
        const started = performance.now();
        await live.extract([seconds], (frame) => {
          preview.current?.getContext('2d')?.drawImage(frame, 0, 0, FRAME_W, FRAME_H);
          frame.close();
        });
        painted.current = live.snapToSampleMicros(seconds);
        setSeek({ seconds, ms: performance.now() - started, bytes: bytes.current - startedBytes });
        if (target.current === seconds) break; // pointer didn't move while we decoded
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.current = false;
    }
  }, []);

  /** One extract() for N evenly spaced timestamps, drawn into the strip canvas as they land.
   *  Waits for the track to have a width first: a background tab or a hidden pane lays out at 0,
   *  and giving up there would leave the strip blank for as long as the page stayed hidden. */
  const buildStrip = useCallback(async (live: FrameExtractor, aborted: () => boolean) => {
    const canvas = strip.current;
    const el = track.current;
    if (!canvas || !el) return;

    const width = el.clientWidth || (await measured(el));
    if (aborted() || width === 0) return;

    const count = Math.max(1, Math.round(width / THUMB_W));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(THUMB_H * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const slot = width / count;
    const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * live.durationSeconds);
    const indexOf = new Map(times.map((seconds, i) => [seconds, i]));

    const startedBytes = bytes.current;
    const started = performance.now();
    await live.extract(times, (frame, requestedSeconds) => {
      const i = indexOf.get(requestedSeconds);
      if (i !== undefined) ctx.drawImage(frame, i * slot, 0, slot, THUMB_H);
      frame.close();
    });
    setBuilt({ frames: count, ms: performance.now() - started, bytes: bytes.current - startedBytes });
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
        // Preview first so there's something to look at, then fill the strip in behind it.
        await pump();
        if (!disposed) await buildStrip(live, () => disposed);
      } catch (error) {
        if (!disposed) setErr(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      disposed = true;
      extractor.current?.dispose();
      extractor.current = null;
    };
  }, [buildStrip, countingFetch, pump, supported]);

  const onPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.type === 'pointermove' && event.buttons === 0 && event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTouched(true);
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
        <div style={{ position: 'relative' }}>
          <canvas
            ref={preview}
            width={FRAME_W}
            height={FRAME_H}
            style={{ display: 'block', width: '100%', aspectRatio: `${FRAME_W} / ${FRAME_H}`, background: '#08080b' }}
          />
          {seek && (
            <span
              style={{
                position: 'absolute',
                left: 14,
                bottom: 14,
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
                color: '#e9e9ee',
                background: 'rgba(8,8,11,0.7)',
                padding: '4px 8px',
                borderRadius: 6,
              }}
            >
              {timecode(seek.seconds)}
            </span>
          )}
        </div>

        {/* biome-ignore lint/a11y/useSemanticElements: a range input can't carry a filmstrip + playhead */}
        <div
          ref={track}
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
            height: THUMB_H,
            borderTop: '1px solid #1d1d25',
            cursor: supported ? 'ew-resize' : 'default',
            touchAction: 'none',
            background: '#08080b',
          }}
        >
          <canvas ref={strip} style={{ display: 'block', width: '100%', height: THUMB_H }} />
          {/* No fill behind the playhead: nothing is playing, so "progress" would be a lie. */}
          <div style={{ position: 'absolute', left: `${ratio * 100}%`, top: 0, bottom: 0, width: 2, background: ACCENT, marginLeft: -1 }} />
          <span
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12,
              color: '#e9e9ee',
              background: 'rgba(8,8,11,0.72)',
              padding: '3px 8px',
              borderRadius: 999,
              pointerEvents: 'none',
              opacity: supported && !touched ? 1 : 0,
              transition: 'opacity 0.4s',
            }}
          >
            drag to scrub
          </span>
        </div>
      </div>

      <div style={{ marginTop: 12, minHeight: 20, fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#6a6a76' }}>
        {!supported ? (
          <span>No VideoDecoder in this browser. WebCodecs ships in Chrome and Edge 94+, Safari 17+.</span>
        ) : err ? (
          <span style={{ color: '#ff6b6b' }}>{err}</span>
        ) : (
          <span>
            {built ? (
              <>
                strip: <span style={{ color: '#cfcfd8' }}>{built.frames} frames</span> in{' '}
                <span style={{ color: '#cfcfd8' }}>{built.ms.toFixed(0)} ms</span>, {kb(built.bytes)}
              </>
            ) : (
              <>strip: building…</>
            )}
            {seek && (
              <>
                {'   ·   '}this frame: <span style={{ color: '#cfcfd8' }}>{seek.ms.toFixed(0)} ms</span>, {kb(seek.bytes)}
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
