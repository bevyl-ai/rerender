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

export interface RaceProps {
  /** Which rendition to race on. Defaults to the H.264 one the headline number is measured against;
   *  /codecs passes a per-codec rendition cut from the same source with the same GOP structure. */
  src?: string;
}
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

export function Race({ src: source = SRC }: RaceProps = {}): JSX.Element {
  const canvases = useRef<Record<Engine, HTMLCanvasElement | null>>({ rerender: null, remotion: null });
  const [results, setResults] = useState<Partial<Record<Engine, Result>>>({});
  const [running, setRunning] = useState<Phase | null>(null);
  const [warmup, setWarmup] = useState<Warmup | null>(null);
  /** Logical width the strips were drawn at; the row scrolls when it exceeds the container. */
  const [stripWidth, setStripWidth] = useState(0);
  const [err, setErr] = useState('');
  /** An engine that cannot read the file at all. Not a slow result — no result. */
  const [cannotRead, setCannotRead] = useState<Engine | null>(null);
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
    setCannotRead(null);
    setDone(false);

    try {
      // Warm the file into the browser's cache before either engine is timed. Otherwise the first
      // press measures a 5 MB download (~850 ms cold at the edge) and every press after it reads
      // from disk (~210 ms), so the number would depend on how many times you had clicked rather
      // than on the engines. Not counted against either side.
      setRunning('warming');
      const warmStarted = performance.now();
      const file = await (await fetch(source)).arrayBuffer();
      setWarmup({ ms: performance.now() - warmStarted, bytes: file.byteLength });

      // ── rerender: build the index, then pull the frames ──
      setRunning('rerender');
      const ours = prepareStrip(oursCanvas, width, FRAMES);
      if (!ours) throw new Error('no 2d context');
      let started = performance.now();
      const extractor = await createFrameExtractor({ src: source });
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
      // Their API returns a frame, not the request it answers, so the slot has to be inferred —
      // and inferred without collisions, or a thumbnail goes missing from their strip.
      const theirSlots = new Set<number>();
      await extractFramesOnWebWorker({
        src: new URL(source, location.href).href,
        timestampsInSeconds: [...wanted], // their extractor mutates what it is handed
        acknowledgeRemotionLicense: true,
        onFrame: (frame) => {
          paintThumb(theirs, frame, nearestIndex(wanted, frame.timestamp, theirSlots));
          theirPainted += 1;
          frame.close();
        },
      });
      setResults((prev) => ({ ...prev, remotion: { ms: performance.now() - started, frames: theirPainted } }));
      setDone(true);
    } catch (error) {
      // Reaching here after our own run means their parser refused the file — VP8 in mp4 is the
      // case that turned this up. Report it as a capability difference and keep our result, rather
      // than discarding both or dressing a refusal up as an enormous speed win.
      if (results.rerender || oursCanvas) setCannotRead('remotion');
      setErr(error instanceof Error ? error.message : String(error));
      setDone(true);
    } finally {
      setRunning(null);
    }
  }, [source]);

  const ours = results.rerender;
  const theirs = results.remotion;
  const factor = ours && theirs && ours.ms > 0 ? theirs.ms / ours.ms : 0;
  const won = factor >= 1;
  /** Always the larger of the two ratios, so it reads as "N× faster" or "N× slower", never "0.9× faster". */
  const margin = won ? factor : 1 / factor;

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
              ) : cannotRead === engine ? (
                <span style={{ color: '#ff6b6b' }}>Not supported by remotion</span>
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

      {/* The heading above deliberately carries no number. Run to run this lands anywhere from
          2.5x to 3.4x, and a fixed claim printed above a button that disagrees with it is worse
          than no claim at all. This is the number, and the reader is the one who made it. */}
      {/* The heading above deliberately carries no number. Run to run this lands anywhere from
          2.5x to 6.7x, and a fixed claim printed above a button that disagrees with it is worse
          than no claim at all. This is the number, and the reader is the one who made it.

          Below 1.0 it has to invert. "0.9x faster" reads as a win while reporting a loss, which
          is the one thing a benchmark must never do. */}
      {done && factor > 0 && (
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 26, fontWeight: 700, letterSpacing: -0.5, margin: '6px 0 16px' }}>
          <span style={{ color: won ? ACCENT : '#ff6b6b' }}>{margin >= 10 ? margin.toFixed(0) : margin.toFixed(1)}×</span>
          <span style={{ color: '#8a8a99' }}>{won ? ' faster' : ' slower'}</span>
        </div>
      )}
    </div>
  );
}
