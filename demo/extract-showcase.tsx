// A zoomable filmstrip, the way an editor timeline actually works.
//
// The strip always spans one window of the file and fills the track with as many thumbnails as fit.
// Zooming shrinks the window around the playhead, so the same number of thumbnails covers less
// time and the frames get closer together — 5.8 s apart at 1x, 0.2 s apart at 16x. Every zoom is a
// fresh extract() for the new timestamps: nothing is pre-rendered, and there is no sprite sheet to
// fall back on. This is the job the module does in production.
//
// Thumbnails are centre-cropped to the slot, which is what makes it read as a ribbon of film rather
// than a row of tiny letterboxes.
//
// Pointer moves are coalesced latest-wins: one seek in flight at a time, and when it lands, if the
// pointer has moved on, go again for wherever it is now. snapToSampleMicros means a move that stays
// within the same frame costs nothing at all.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createFrameExtractor, type FrameExtractor } from '../src/extract';
import { paintThumb, prepareStrip, STRIP_H, stripTimestamps, TARGET_SLOT_W } from './filmstrip';
import { ACCENT, card, SMOKE_TEST } from './ui';

const SRC = '/sintel-480p.mp4';
/** The hero rendition's native size (2.35:1, letterbox cropped out). */
const FRAME_W = 854;
const FRAME_H = 362;
const ZOOMS = [1, 2, 4, 8, 16] as const;
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

/** The slice of the file the strip is showing. */
interface Window {
  start: number;
  span: number;
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
  /** Running total from the wrapped fetch; a seek snapshots it before and after. */
  const bytes = useRef(0);
  /** Bumped per strip build so a slow one can't paint over a newer one. */
  const build = useRef(0);

  const [duration, setDuration] = useState(0);
  const [window_, setWindow] = useState<Window>({ start: 0, span: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [playhead, setPlayhead] = useState(0);
  const [seek, setSeek] = useState<Seek | null>(null);
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

  /** One extract() for the window's timestamps, centre-cropped into the strip as frames land.
   *  Waits for the track to have a width first: a background tab or a hidden pane lays out at 0,
   *  and giving up there would leave the strip blank for as long as the page stayed hidden. */
  const buildStrip = useCallback(async (live: FrameExtractor, at: Window, aborted: () => boolean) => {
    const canvas = strip.current;
    const el = track.current;
    if (!canvas || !el) return;

    const width = el.clientWidth || (await measured(el));
    if (aborted() || width === 0) return;

    build.current += 1;
    const token = build.current;
    const layout = prepareStrip(canvas, width);
    if (!layout) return;

    const times = stripTimestamps(layout.count, at.start, at.span);
    const indexOf = new Map(times.map((seconds, i) => [seconds, i]));

    await live.extract(times, (frame, requestedSeconds) => {
      const i = indexOf.get(requestedSeconds);
      // A newer build owns the canvas now; drop this frame rather than painting a stale window.
      if (i !== undefined && token === build.current) paintThumb(layout, frame, i);
      frame.close();
    });
  }, []);

  /** Re-window around a time and rebuild. Zoom 1 is the whole file. */
  const applyZoom = useCallback(
    (nextZoom: number, around: number) => {
      const live = extractor.current;
      if (!live || duration === 0) return;
      const span = duration / nextZoom;
      const start = Math.min(Math.max(around - span / 2, 0), Math.max(0, duration - span));
      setZoom(nextZoom);
      setWindow({ start, span });
      void buildStrip(live, { start, span }, () => false);
    },
    [buildStrip, duration],
  );

  const seekTo = useCallback(
    (seconds: number) => {
      const clamped = Math.min(Math.max(seconds, 0), duration);
      setPlayhead(clamped);
      target.current = clamped;
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
        const whole = { start: 0, span: live.durationSeconds };
        setDuration(live.durationSeconds);
        setWindow(whole);
        setPlayhead(live.durationSeconds * OPENING_RATIO);
        target.current = live.durationSeconds * OPENING_RATIO;
        // Preview first so there's something to look at, then fill the strip in behind it.
        await pump();
        if (!disposed) await buildStrip(live, whole, () => disposed);
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

  /** x within the track → the time that column of the strip represents. */
  const timeAt = (event: React.PointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    return window_.start + ratio * window_.span;
  };

  const onPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.type === 'pointermove' && event.buttons === 0 && event.pointerType !== 'mouse') return;
    setTouched(true);
    seekTo(timeAt(event));
  };

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = window_.span / 100;
    const delta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    if (delta === 0) return;
    event.preventDefault();
    seekTo(target.current + delta);
  };

  const inWindow = window_.span > 0 ? (playhead - window_.start) / window_.span : 0;
  const gap = window_.span > 0 && track.current ? window_.span / Math.max(1, Math.round(track.current.clientWidth / TARGET_SLOT_W)) : 0;

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
          aria-valuenow={Math.round(playhead)}
          aria-valuetext={timecode(playhead)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            onPointer(event);
          }}
          onPointerMove={onPointer}
          onKeyDown={onKey}
          style={{
            position: 'relative',
            height: STRIP_H,
            borderTop: '1px solid #1d1d25',
            cursor: supported ? 'ew-resize' : 'default',
            touchAction: 'none',
            background: '#08080b',
            overflow: 'hidden',
          }}
        >
          <canvas ref={strip} style={{ display: 'block', width: '100%', height: STRIP_H }} />
          {/* No fill behind the playhead: nothing is playing, so "progress" would be a lie. */}
          <div
            style={{
              position: 'absolute',
              left: `${inWindow * 100}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: ACCENT,
              marginLeft: -1,
              boxShadow: '0 0 0 1px rgba(8,8,11,0.55)',
            }}
          />
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

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            borderTop: '1px solid #1d1d25',
            flexWrap: 'wrap',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 12,
          }}
        >
          <span style={{ color: '#55555f' }}>zoom</span>
          {ZOOMS.map((level) => (
            <button
              key={level}
              type="button"
              disabled={!supported || duration === 0}
              onClick={() => applyZoom(level, playhead)}
              style={{
                background: level === zoom ? 'rgba(97,175,239,0.14)' : 'transparent',
                border: `1px solid ${level === zoom ? ACCENT : '#26262e'}`,
                color: level === zoom ? ACCENT : '#8a8a99',
                borderRadius: 7,
                padding: '4px 10px',
                fontSize: 12,
                fontFamily: 'inherit',
                cursor: duration === 0 ? 'default' : 'pointer',
              }}
            >
              {level}×
            </button>
          ))}
          <span style={{ color: '#55555f', marginLeft: 'auto' }}>
            {gap > 0 ? `${gap < 1 ? `${(gap * 1000).toFixed(0)} ms` : `${gap.toFixed(1)} s`} between frames` : ''}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 12, minHeight: 20, fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#6a6a76' }}>
        {!supported ? (
          <span>No VideoDecoder in this browser. WebCodecs ships in Chrome and Edge 94+, Safari 17+.</span>
        ) : err ? (
          <span style={{ color: '#ff6b6b' }}>{err}</span>
        ) : seek ? (
          <span>
            decoded in <span style={{ color: '#cfcfd8' }}>{seek.ms.toFixed(0)} ms</span> from{' '}
            <span style={{ color: '#cfcfd8' }}>{kb(seek.bytes)}</span>
          </span>
        ) : (
          <span>reading the index…</span>
        )}
      </div>
    </div>
  );
}
