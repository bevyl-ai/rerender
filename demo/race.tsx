// The same filmstrip, built twice, by two different extraction engines.
//
// Both strips use the identical painting code (demo/filmstrip.ts) and the identical timestamps.
// The only difference is who fetches and decodes the frames. They run one after the other, not
// side by side, so neither is contending with the other for the decoder or the network.
//
// Deliberately generous to Remotion:
//   - it gets extractFramesOnWebWorker, which decodes off the main thread; rerender's extractor
//     runs on the main thread, where it also competes with React.
//   - it gets a defensive copy of the timestamp array, because its extractor sorts and drains the
//     caller's array in place and would otherwise throw on the second run.
//   - every timestamp is in range, so its past-end frame-dropping never comes into it.
//   - rerender builds a fresh index each run rather than reusing a warm one, which is the whole
//     advantage it has, given away.
import { useCallback, useRef, useState } from 'react';
import { createFrameExtractor } from '../src/extract';
import { nearestIndex, paintThumb, prepareStrip, STRIP_H, stripTimestamps } from './filmstrip';
import { ACCENT, card } from './ui';

// A 12-minute 128p rendition — the shape Bevyl actually stores for timeline filmstrips, and the
// scenario the benchmark is about. 17,620 samples, so walking the sample table costs something.
// On the hero's 52 s file the two engines are within ~25% of each other, because a short table is
// cheap to walk however you do it; the gap is a function of how deep into the file you seek.
//
// It has to be one continuous film. The first version of this was the 52 s trailer looped 34
// times, which put the sample count where it needed to be but made the strip unreadable: twelve
// frames spread over the file land at arbitrary points in the loop, so the credits showed up
// fourth and the sequence ran backwards.
const SRC = '/filmstrip-12min-128p.mp4';
/** Fixed so the numbers mean the same thing on every screen size. */
const FRAMES = 12;
/** Narrowest a thumbnail may get before the strip scrolls instead of shrinking. Twelve frames
 *  squeezed into a phone would be 26px slivers, which shows nothing. */
const MIN_SLOT_W = 64;

type Engine = 'rerender' | 'remotion';
type Phase = Engine | 'warming';

interface Result {
  ms: number;
  frames: number;
}

interface Warmup {
  ms: number;
  bytes: number;
}

const LABEL: Record<Engine, string> = {
  rerender: 'rerender/extract',
  remotion: '@remotion/webcodecs',
};

export function Race(): JSX.Element {
  const canvases = useRef<Record<Engine, HTMLCanvasElement | null>>({ rerender: null, remotion: null });
  const [results, setResults] = useState<Partial<Record<Engine, Result>>>({});
  const [running, setRunning] = useState<Phase | null>(null);
  const [warmup, setWarmup] = useState<Warmup | null>(null);
  /** Logical width the strips were drawn at; the row scrolls when it exceeds the container. */
  const [stripWidth, setStripWidth] = useState(0);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const supported = typeof VideoDecoder !== 'undefined';

  const run = useCallback(async () => {
    const oursCanvas = canvases.current.rerender;
    const theirsCanvas = canvases.current.remotion;
    const available = oursCanvas?.parentElement?.clientWidth ?? 0;
    if (!oursCanvas || !theirsCanvas || available === 0) return;
    const width = Math.max(available, FRAMES * MIN_SLOT_W);
    setStripWidth(width);
    setResults({});
    setWarmup(null);
    setErr('');
    setDone(false);

    try {
      // Warm the file into the browser's cache before either engine is timed. Otherwise the first
      // press measures a 5 MB download (~850 ms cold at the edge) and every press after it reads
      // from disk (~210 ms), so the number would depend on how many times you had clicked rather
      // than on the engines. Not counted against either side.
      setRunning('warming');
      const warmStarted = performance.now();
      const file = await (await fetch(SRC)).arrayBuffer();
      setWarmup({ ms: performance.now() - warmStarted, bytes: file.byteLength });

      // ── rerender: build the index, then pull the frames ──
      setRunning('rerender');
      const ours = prepareStrip(oursCanvas, width, FRAMES);
      if (!ours) throw new Error('no 2d context');
      let started = performance.now();
      const extractor = await createFrameExtractor({ src: SRC });
      const wanted = stripTimestamps(FRAMES, 0, extractor.durationSeconds);
      const byTime = new Map(wanted.map((seconds, i) => [seconds, i]));
      let painted = 0;
      await extractor.extract(wanted, (frame, requestedSeconds) => {
        const i = byTime.get(requestedSeconds);
        if (i !== undefined) {
          paintThumb(ours, frame, i);
          painted += 1;
        }
        frame.close();
      });
      extractor.dispose();
      setResults((prev) => ({ ...prev, rerender: { ms: performance.now() - started, frames: painted } }));

      // ── remotion: same timestamps, same painting, its own worker ──
      setRunning('remotion');
      const theirs = prepareStrip(theirsCanvas, width, FRAMES);
      if (!theirs) throw new Error('no 2d context');
      const { extractFramesOnWebWorker } = await import('@remotion/webcodecs/worker');
      started = performance.now();
      let theirPainted = 0;
      await extractFramesOnWebWorker({
        src: new URL(SRC, location.href).href,
        timestampsInSeconds: [...wanted], // their extractor mutates what it is handed
        acknowledgeRemotionLicense: true,
        onFrame: (frame) => {
          paintThumb(theirs, frame, nearestIndex(wanted, frame.timestamp));
          theirPainted += 1;
          frame.close();
        },
      });
      setResults((prev) => ({ ...prev, remotion: { ms: performance.now() - started, frames: theirPainted } }));
      setDone(true);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(null);
    }
  }, []);

  const ours = results.rerender;
  const theirs = results.remotion;
  const factor = ours && theirs && ours.ms > 0 ? theirs.ms / ours.ms : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!supported || running !== null}
          style={{
            background: running ? '#1c2733' : ACCENT,
            color: running ? '#9a9aa6' : '#0b0b0d',
            border: 0,
            borderRadius: 12,
            padding: '13px 26px',
            fontSize: 16,
            fontWeight: 700,
            cursor: running ? 'default' : 'pointer',
          }}
        >
          {running === 'warming' ? 'Fetching the file…' : running ? 'Running…' : done ? 'Run again' : 'Run benchmark'}
        </button>
        {err && <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#ff6b6b' }}>{err}</span>}
      </div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#55555f', margin: '0 0 12px', minHeight: 18 }}>
        {running === 'warming' ? 'download: …' : warmup ? `download: ${(warmup.ms / 1000).toFixed(2)}s` : ''}
      </div>

      {(['rerender', 'remotion'] as const).map((engine) => (
        <div key={engine} style={{ ...card, marginBottom: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              padding: '10px 14px',
              borderBottom: '1px solid #1d1d25',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ color: engine === 'rerender' ? ACCENT : '#8a8a99' }}>{LABEL[engine]}</span>
            <span style={{ marginLeft: 'auto', color: '#8a8a99' }}>
              {running === engine ? (
                'decoding…'
              ) : results[engine] ? (
                <>
                  <span style={{ color: '#cfcfd8' }}>{results[engine]?.ms.toFixed(0)} ms</span> · {results[engine]?.frames}/{FRAMES} frames
                </>
              ) : (
                ''
              )}
            </span>
          </div>
          <div style={{ overflowX: 'auto', background: '#08080b' }}>
            <canvas
              ref={(el) => {
                canvases.current[engine] = el;
              }}
              style={{ display: 'block', width: stripWidth ? stripWidth : '100%', height: STRIP_H }}
            />
          </div>
        </div>
      ))}

      {done && factor > 0 && (
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 15, color: '#8a8a99', margin: '2px 0 14px' }}>
          <span style={{ color: '#cfcfd8' }}>{factor >= 10 ? factor.toFixed(0) : factor.toFixed(1)}× faster</span>
        </div>
      )}

      <p style={{ margin: '4px 0 0', fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#55555f', lineHeight: 1.65 }}>
        Remotion runs in a web worker; ours runs on the main thread. It gets a fresh timestamp array, in-range timestamps only, and our
        index is rebuilt cold on every run.
      </p>
    </div>
  );
}
