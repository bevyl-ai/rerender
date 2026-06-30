// The in-browser export showcase. A composition plays live in the <Player>; one click
// frame-steps it, captures each frame from the real DOM (foreignObject) + decodes the footage
// with mediabunny, and encodes an mp4 — entirely in this tab (WebCodecs, no server, no ffmpeg).
// The exported file is shown side-by-side with the live preview: the same frame-counter HUD
// ticks in both, one a React tree and one a decoded .mp4. A live filmstrip, a CSS reveal of how
// the visuals are built, and a caniuse-style support matrix round it out.
import { type ComponentType, type CSSProperties, useEffect, useRef, useState } from 'react';
import { Player, type PlayerRef } from '../src';
import { exportToMp4 } from '../src/client/export';
import { CodeToFilm, CODE_TO_FILM_DURATION } from './code-to-film';

const W = 1280;
const H = 720;
const FPS = 30;
const DUR = CODE_TO_FILM_DURATION; // single source of truth — the comp owns its own length
const ACCENT = '#ff5e8a';
const DISPLAY_W = 468; // the hero's pre-measure fallback width basis

const card: CSSProperties = { background: '#0f0f15', border: '1px solid #23232c', borderRadius: 14, overflow: 'hidden' };
const bigStat: CSSProperties = {
  fontSize: 40,
  fontWeight: 850,
  lineHeight: 1,
  background: 'linear-gradient(90deg,#ff5e8a,#ffa14a)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  letterSpacing: -1,
};
const cardLabel: CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 11,
  letterSpacing: 1.5,
  color: '#8a8a99',
  padding: '10px 14px',
  borderBottom: '1px solid #1d1d25',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
};

function Badge({ icon, children }: { icon: string; children: React.ReactNode }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        background: '#16161d',
        border: '1px solid #26262e',
        borderRadius: 999,
        padding: '7px 14px',
        fontSize: 13,
        color: '#cfcfd8',
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      {children}
    </span>
  );
}

/** True on narrow (phone) viewports — drives the tables' stacked mobile layout. */
function useNarrow(maxWidth = 640): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const on = (): void => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [maxWidth]);
  return narrow;
}

// ── CSS reveal: the actual Orb component, so it's obvious the visuals are real DOM/CSS ──
function CssReveal(): JSX.Element {
  const k: CSSProperties = { color: '#c678dd' }; // keyword
  const f: CSSProperties = { color: '#61afef' }; // function/name
  const s: CSSProperties = { color: '#98c379' }; // string/value
  const d: CSSProperties = { color: '#5c6370' }; // dim
  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Every shape in that film is one styled &lt;div&gt;.</div>
      <div style={{ color: '#8a8a99', fontSize: 14, marginBottom: 14, maxWidth: 720 }}>
        No canvas drawing, no shader — just CSS the renderer rasterizes straight into the mp4. The radial-gradient tile in the grid, for
        one:
      </div>
      <pre
        style={{
          ...card,
          margin: 0,
          padding: '16px 18px',
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          fontSize: 13,
          lineHeight: 1.65,
          color: '#abb2bf',
          overflowX: 'auto',
        }}
      >
        <span style={k}>function</span> <span style={f}>Orb</span>(<span style={{ color: '#e06c75' }}>{'{ hue, size }'}</span>) {'{'}
        {'\n'} <span style={k}>return</span> ({'\n'} <span style={d}>&lt;</span>
        <span style={f}>div</span> <span style={{ color: '#d19a66' }}>style</span>={'{{'}
        {'\n'} <span style={{ color: '#d19a66' }}>width</span>: size, <span style={{ color: '#d19a66' }}>height</span>: size,{' '}
        <span style={{ color: '#d19a66' }}>borderRadius</span>: <span style={s}>'50%'</span>,{'\n'}{' '}
        <span style={{ background: 'rgba(255,94,138,0.14)', borderRadius: 4, padding: '1px 3px' }}>
          <span style={{ color: '#d19a66' }}>background</span>: <span style={s}>{'`radial-gradient(circle at 35% 30%,'}</span>
          {'\n'} <span style={s}>{'  hsla(${hue}, 92%, 68%, .85),'}</span>
          {'\n'} <span style={s}>{'  hsla(${hue}, 92%, 55%, 0) 70%)`'}</span>
        </span>
        ,{'\n'} {'}}'} <span style={d}>/&gt;</span>
        {'\n'} );
        {'\n'}
        {'}'}
      </pre>
    </div>
  );
}

// ── where the FARM runs — portability, not browser-export trivia ──
const HOSTS: { icon: string; name: string; note: string }[] = [
  { icon: '🪰', name: 'Fly.io', note: 'Firecracker microVMs' },
  { icon: '☁️', name: 'AWS', note: 'EC2, ECS, your own box' },
  { icon: '🐳', name: 'Docker', note: 'anywhere it runs' },
  { icon: '🖥', name: 'Bare metal', note: 'no platform required' },
];

function PortableHosting(): JSX.Element {
  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Self-host the render farm anywhere.</div>
      <div style={{ color: '#8a8a99', fontSize: 14, marginBottom: 14, maxWidth: 720 }}>
        The renderer is a plain Node package — no proprietary runtime, no vendor lock-in. Slice a render across Firecracker microVMs on
        Fly.io, a box on AWS, or your own metal: wherever you already deploy.
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {HOSTS.map((h) => (
          <span
            key={h.name}
            style={{
              ...card,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 16px',
            }}
          >
            <span style={{ fontSize: 18 }}>{h.icon}</span>
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{h.name}</span>
              <span style={{ color: '#8a8a99', fontSize: 12 }}>{h.note}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── us vs them ──
const VS: { label: string; remotion: string; rerender: string }[] = [
  { label: 'License', remotion: 'Paid company license above 3 employees', rerender: 'MIT — free, no seats, no restrictions' },
  { label: 'Source', remotion: 'Source-available, license-gated', rerender: 'Fully open source' },
  { label: 'Render in the browser', remotion: 'Experimental (@remotion/web-renderer)', rerender: 'Yes — what this page just did' },
  { label: 'Distributed / farm render', remotion: 'AWS Lambda only', rerender: 'Any host — or your own Firecracker' },
  { label: 'To render with no cloud', remotion: 'Node + headless Chrome + an ffmpeg binary', rerender: 'a browser tab' },
];

function VsTable(): JSX.Element {
  const narrow = useNarrow();
  if (narrow) {
    // Stacked cards on phones — rerender first/highlighted, no sideways scroll.
    return (
      <div style={{ marginTop: 30 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
          rerender <span style={{ color: '#6a6a76' }}>vs</span> Remotion
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {VS.map((r) => (
            <div key={r.label} style={{ ...card, padding: '14px 16px' }}>
              <div style={{ color: '#8a8a99', fontWeight: 600, fontSize: 12.5, letterSpacing: 0.3, marginBottom: 10 }}>{r.label}</div>
              <div style={{ display: 'flex', gap: 9, marginBottom: 7 }}>
                <span style={{ color: '#7fdca0' }}>✓</span>
                <span style={{ color: '#fff', flex: 1, fontSize: 14 }}>
                  <b style={{ color: ACCENT }}>rerender</b> — {r.rerender}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 9 }}>
                <span style={{ color: '#ff8080' }}>✕</span>
                <span style={{ color: '#9a9aa6', flex: 1, fontSize: 14 }}>Remotion — {r.remotion}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
        rerender <span style={{ color: '#6a6a76' }}>vs</span> Remotion
      </div>
      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14, minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ width: '24%', padding: '14px 16px', borderBottom: '1px solid #1d1d25' }} />
              <th style={{ textAlign: 'left', padding: '14px 16px', color: '#9a9aa6', fontWeight: 700, borderBottom: '1px solid #1d1d25' }}>
                Remotion
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '14px 16px',
                  color: ACCENT,
                  fontWeight: 800,
                  borderBottom: `2px solid ${ACCENT}`,
                  background: 'rgba(255,94,138,0.06)',
                }}
              >
                rerender
              </th>
            </tr>
          </thead>
          <tbody>
            {VS.map((r) => (
              <tr key={r.label}>
                <td style={{ padding: '13px 16px', color: '#8a8a99', fontWeight: 600, borderBottom: '1px solid #16161d' }}>{r.label}</td>
                <td style={{ padding: '13px 16px', color: '#9a9aa6', borderBottom: '1px solid #16161d' }}>
                  <span style={{ color: '#ff8080', marginRight: 8 }}>✕</span>
                  {r.remotion}
                </td>
                <td style={{ padding: '13px 16px', color: '#fff', borderBottom: '1px solid #16161d', background: 'rgba(255,94,138,0.06)' }}>
                  <span style={{ color: '#7fdca0', marginRight: 8 }}>✓</span>
                  {r.rerender}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The hero plays huge at the full content width; the exported file previews small underneath it. */
function useHeroLayout(): { ref: React.RefObject<HTMLDivElement>; heroW: number; heroH: number; smallW: number; smallH: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const heroW = w === 0 ? DISPLAY_W * 2 : w; // the hero fills the whole column
  const smallW = Math.min(heroW, 384); // the exported file rides underneath, deliberately small
  return { ref, heroW, heroH: Math.round((heroW * H) / W), smallW, smallH: Math.round((smallW * H) / W) };
}

export function ExportShowcase(): JSX.Element {
  const { ref: containerRef, heroW, heroH, smallW, smallH } = useHeroLayout();
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [pct, setPct] = useState(0);
  const [frameNo, setFrameNo] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ secs: string; size: string } | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [err, setErr] = useState('');
  const player = useRef<PlayerRef>(null);

  useEffect(() => {
    player.current?.play();
  }, []);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  async function run(): Promise<void> {
    setStatus('running');
    setPct(0);
    setFrameNo(0);
    setUrl(null);
    setDownloaded(false);
    setErr('');
    const t0 = performance.now();
    // ~40 progress repaints, not one per frame: re-rendering the showcase every frame contends with
    // the export's own render loop on the main thread and measurably slows the export itself. We also
    // don't paint the frames anywhere during the render — there's nothing to watch, it just gets fast.
    const step = Math.max(1, Math.round(DUR / 40));
    try {
      const blob = await exportToMp4({
        Component: CodeToFilm as ComponentType<Record<string, unknown>>,
        config: { width: W, height: H, fps: FPS, durationInFrames: DUR },
        onProgress: (done) => {
          if (done % step === 0 || done === DUR) {
            setPct(Math.round((done / DUR) * 100));
            setFrameNo(done);
          }
        },
      });
      const objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      setMeta({ secs: ((performance.now() - t0) / 1000).toFixed(1), size: (blob.size / 1024).toFixed(0) });
      setStatus('done');
      // the whole point of the demo: it just lands in your downloads, no server round-trip
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'rerender-export.mp4';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setDownloaded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <div ref={containerRef}>
      {/* THE HERO — the live React composition, playing huge */}
      <div style={{ ...card, width: heroW }}>
        <div style={cardLabel}>
          <span>● LIVE · REACT COMPOSITION</span>
          <span style={{ color: ACCENT }}>useCurrentFrame()</span>
        </div>
        <Player
          ref={player}
          composition={CodeToFilm}
          width={W}
          height={H}
          fps={FPS}
          durationInFrames={DUR}
          displayHeight={heroH}
          controls={false}
          style={{ display: 'block' }}
        />
      </div>

      {/* export CTA + the headline render-time stat */}
      <div style={{ marginTop: 22, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={run}
          disabled={status === 'running'}
          style={{
            background: status === 'running' ? '#3a2230' : `linear-gradient(135deg, ${ACCENT}, #ff8a4a)`,
            color: '#fff',
            border: 0,
            borderRadius: 12,
            padding: '15px 30px',
            fontSize: 17,
            fontWeight: 700,
            cursor: status === 'running' ? 'default' : 'pointer',
            boxShadow: status === 'running' ? 'none' : '0 10px 36px rgba(255,94,138,0.4)',
          }}
        >
          {status === 'running' ? `Exporting… ${pct}%` : status === 'done' ? '↻ Export again' : '⬇ Export this to MP4 — in your browser'}
        </button>

        {status === 'done' && meta && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ color: '#8a8a99', fontSize: 14 }}>Pixel-perfect render, created in</span>
            <span style={bigStat}>{meta.secs}s</span>
            <span style={{ color: '#55555f', fontSize: 22, fontWeight: 300 }}>/</span>
            <span style={bigStat}>{Number(meta.size) >= 1000 ? `${(Number(meta.size) / 1024).toFixed(1)} MB` : `${meta.size} KB`}</span>
            <span style={{ color: '#8a8a99', fontSize: 14 }}>
              of {W}×{H} mp4
            </span>
          </div>
        )}
      </div>

      {/* THE EXPORTED FILE — smaller, riding underneath the hero */}
      {status !== 'idle' && (
        <div style={{ marginTop: 18, display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ ...card, width: smallW }}>
            <div style={cardLabel}>
              <span style={{ color: status === 'done' ? '#7fdca0' : '#8a8a99' }}>
                {status === 'done' ? '▸ THE .MP4 · DECODED BY YOUR BROWSER' : 'OUTPUT · .MP4'}
              </span>
              <span>{status === 'running' ? `${pct}%` : status === 'done' ? `${meta?.size} KB` : ''}</span>
            </div>
            <div
              style={{
                width: smallW,
                height: smallH,
                background: '#000',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {status === 'running' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, width: '100%' }}>
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#fff' }}>
                    encoding frame {frameNo} / {DUR}
                  </div>
                  <div style={{ width: '80%', height: 6, background: 'rgba(255,255,255,0.15)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg,${ACCENT},#ffa14a)`, transition: 'width 0.15s linear' }} />
                  </div>
                </div>
              )}
              {status === 'done' && url && (
                // biome-ignore lint/a11y/useMediaCaption: a generated demo clip, no captions
                <video src={url} autoPlay loop muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              )}
              {status === 'error' && <div style={{ color: '#ff6b6b', fontSize: 13, padding: 20 }}>✗ {err}</div>}
            </div>
          </div>

          {status === 'done' && url && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', paddingTop: 4 }}>
              {downloaded && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#7fdca0', fontSize: 14, fontWeight: 600 }}>
                  <span style={{ fontSize: 16 }}>✓</span> Saved to your downloads —{' '}
                  <code style={{ fontFamily: 'ui-monospace, monospace' }}>rerender-export.mp4</code>
                </div>
              )}
              <a
                href={url}
                download="rerender-export.mp4"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  background: '#16161d',
                  color: '#fff',
                  border: `1.5px solid ${ACCENT}`,
                  borderRadius: 12,
                  padding: '12px 22px',
                  fontSize: 15,
                  fontWeight: 700,
                }}
              >
                <span style={{ fontSize: 18 }}>⬇</span> Download again
              </a>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Badge icon="🎞">{DUR} frames</Badge>
                <Badge icon="🖥">no server</Badge>
                <Badge icon="🚫">no ffmpeg</Badge>
              </div>
            </div>
          )}
        </div>
      )}

      <CssReveal />
      <PortableHosting />
      <VsTable />
    </div>
  );
}
