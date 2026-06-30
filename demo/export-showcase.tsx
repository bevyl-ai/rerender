// The in-browser export showcase. A composition plays live in the <Player>; one click
// frame-steps it, captures each frame from the real DOM (foreignObject) + decodes the footage
// with mediabunny, and encodes an mp4 — entirely in this tab (WebCodecs, no server, no ffmpeg).
// The exported file is shown side-by-side with the live preview: the same frame-counter HUD
// ticks in both, one a React tree and one a decoded .mp4. A live filmstrip, a CSS reveal of how
// the visuals are built, and a caniuse-style support matrix round it out.
import { type ComponentType, type CSSProperties, useEffect, useRef, useState } from 'react';
import { Player, type PlayerRef } from '../src';
import { exportToMp4 } from '../src/client/export';
import { CodeToFilm } from './code-to-film';

const W = 1280;
const H = 720;
const FPS = 30;
const DUR = 240;
const ACCENT = '#ff5e8a';
const DISPLAY_W = 468;
const DISPLAY_H = Math.round((DISPLAY_W * H) / W); // whole px → integer container box, one fewer fractional snap

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

// ── CSS reveal: the actual Orb component, so it's obvious the visuals are real DOM/CSS ──
function CssReveal(): JSX.Element {
  const k: CSSProperties = { color: '#c678dd' }; // keyword
  const f: CSSProperties = { color: '#61afef' }; // function/name
  const s: CSSProperties = { color: '#98c379' }; // string/value
  const d: CSSProperties = { color: '#5c6370' }; // dim
  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Those glowing circles? Each is one styled &lt;div&gt;.</div>
      <div style={{ color: '#8a8a99', fontSize: 14, marginBottom: 14, maxWidth: 720 }}>
        No canvas drawing, no shader — just CSS the renderer rasterizes straight into the mp4. This is the exact code behind them:
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

// ── caniuse-style support matrix ──
type Cell = ['ok' | 'partial' | 'no', string];
const COMPAT: { feat: string; cells: Cell[] }[] = [
  {
    feat: 'WebCodecs · VideoEncoder (mp4)',
    cells: [
      ['ok', '94'],
      ['ok', '94'],
      ['ok', '16.4'],
      ['partial', '130'],
    ],
  },
  {
    feat: 'WebCodecs · VideoDecoder (footage)',
    cells: [
      ['ok', '94'],
      ['ok', '94'],
      ['ok', '16.4'],
      ['ok', '130'],
    ],
  },
  {
    feat: 'foreignObject → <canvas>',
    cells: [
      ['ok', '✓'],
      ['ok', '✓'],
      ['partial', '*'],
      ['ok', '✓'],
    ],
  },
  {
    feat: 'This demo, end to end',
    cells: [
      ['ok', ''],
      ['ok', ''],
      ['partial', ''],
      ['partial', ''],
    ],
  },
];
const BROWSERS = ['Chrome', 'Edge', 'Safari', 'Firefox'];
const CELL_BG: Record<Cell[0], string> = { ok: '#15301f', partial: '#332a12', no: '#331717' };
const CELL_FG: Record<Cell[0], string> = { ok: '#7fdca0', partial: '#e8c06b', no: '#ff8080' };
const CELL_MARK: Record<Cell[0], string> = { ok: '✓', partial: '~', no: '✕' };

function CompatMatrix(): JSX.Element {
  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Where it runs</div>
      <div style={{ color: '#8a8a99', fontSize: 14, marginBottom: 14, maxWidth: 720 }}>
        It's all standard web platform — WebCodecs + canvas. <span style={{ color: '#e8c06b' }}>~</span> = works with caveats (Firefox's
        encoder is newer; Safari's foreignObject→canvas has quirks).
      </div>
      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '12px 16px', color: '#8a8a99', fontWeight: 600, borderBottom: '1px solid #1d1d25' }}>
                Feature
              </th>
              {BROWSERS.map((b) => (
                <th
                  key={b}
                  style={{ padding: '12px 8px', color: '#cfcfd8', fontWeight: 600, borderBottom: '1px solid #1d1d25', width: 92 }}
                >
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPAT.map((row) => (
              <tr key={row.feat}>
                <td
                  style={{
                    padding: '10px 16px',
                    color: '#cfcfd8',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 12.5,
                    borderBottom: '1px solid #16161d',
                  }}
                >
                  {row.feat}
                </td>
                {row.cells.map((c, i) => (
                  <td key={BROWSERS[i]} style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #16161d' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 1,
                        background: CELL_BG[c[0]],
                        color: CELL_FG[c[0]],
                        borderRadius: 7,
                        padding: '6px 0',
                        width: 60,
                        fontWeight: 700,
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{CELL_MARK[c[0]]}</span>
                      {c[1] && <span style={{ fontSize: 10, opacity: 0.85, fontWeight: 500 }}>{c[1]}</span>}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── us vs them ──
const VS: { label: string; remotion: string; rerender: string }[] = [
  { label: 'Cost per render', remotion: '~1¢ cloud usage fee', rerender: '$0' },
  { label: 'Infrastructure', remotion: 'AWS Lambda, tightly coupled', rerender: 'your browser — or any static host' },
  { label: 'Video encoder', remotion: 'bundled ffmpeg — a native binary per OS/arch', rerender: 'WebCodecs + WASM, no binary' },
  { label: 'To render a video', remotion: 'deploy + run a cloud render farm', rerender: 'click a button' },
  { label: 'Works offline', remotion: 'no — needs the cloud function', rerender: 'yes (encode is fully local)' },
  { label: 'License', remotion: 'per-seat, with no-compete clauses', rerender: 'MIT' },
];

function VsTable(): JSX.Element {
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

export function ExportShowcase(): JSX.Element {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [pct, setPct] = useState(0);
  const [frameNo, setFrameNo] = useState(0);
  const [strip, setStrip] = useState<string[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ secs: string; size: string } | null>(null);
  const [err, setErr] = useState('');
  const liveCanvas = useRef<HTMLCanvasElement>(null);
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
    setStrip([]);
    setUrl(null);
    setErr('');
    const thumbs: string[] = [];
    const t0 = performance.now();
    try {
      const blob = await exportToMp4({
        Component: CodeToFilm as ComponentType<Record<string, unknown>>,
        config: { width: W, height: H, fps: FPS, durationInFrames: DUR },
        onProgress: (done) => {
          setPct(Math.round((done / DUR) * 100));
          setFrameNo(done);
        },
        onFrame: (canvas, f) => {
          const lc = liveCanvas.current;
          const lctx = lc?.getContext('2d');
          if (lc && lctx) lctx.drawImage(canvas, 0, 0, lc.width, lc.height);
          if (f % 9 === 0) {
            const tc = document.createElement('canvas');
            tc.width = 104;
            tc.height = 58;
            tc.getContext('2d')?.drawImage(canvas, 0, 0, 104, 58);
            thumbs.push(tc.toDataURL('image/jpeg', 0.6));
            setStrip([...thumbs]);
          }
        },
      });
      setUrl(URL.createObjectURL(blob));
      setMeta({ secs: ((performance.now() - t0) / 1000).toFixed(1), size: (blob.size / 1024).toFixed(0) });
      setStatus('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <div>
      {/* the split: live composition ↔ the exported file */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ ...card, width: DISPLAY_W }}>
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
            displayHeight={DISPLAY_H}
            controls={false}
            style={{ display: 'block' }}
          />
        </div>

        <div style={{ ...card, width: DISPLAY_W }}>
          <div style={cardLabel}>
            <span style={{ color: status === 'done' ? '#7fdca0' : '#8a8a99' }}>
              {status === 'done' ? '▸ THE .MP4 · DECODED BY YOUR BROWSER' : 'OUTPUT · .MP4'}
            </span>
            <span>{status === 'running' ? `${pct}%` : status === 'done' ? `${meta?.size} KB` : ''}</span>
          </div>
          <div
            style={{
              width: DISPLAY_W,
              height: DISPLAY_H,
              background: '#000',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {status === 'idle' && (
              <div style={{ color: '#55555f', fontSize: 14, textAlign: 'center', padding: 20, lineHeight: 1.6 }}>
                hit <b style={{ color: ACCENT }}>Export</b> →<br />
                the .mp4 is built right here, in this tab
              </div>
            )}
            {status === 'running' && (
              <>
                <canvas ref={liveCanvas} width={DISPLAY_W} height={DISPLAY_H} style={{ width: '100%', height: '100%', display: 'block' }} />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    paddingBottom: 16,
                    background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent 40%)',
                  }}
                >
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#fff', marginBottom: 8 }}>
                    capturing frame {frameNo} / {DUR}
                  </div>
                  <div style={{ width: '82%', height: 5, background: 'rgba(255,255,255,0.15)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg,${ACCENT},#ffa14a)` }} />
                  </div>
                </div>
              </>
            )}
            {status === 'done' && url && (
              // biome-ignore lint/a11y/useMediaCaption: a generated demo clip, no captions
              <video
                src={url}
                autoPlay
                loop
                muted
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            )}
            {status === 'error' && <div style={{ color: '#ff6b6b', fontSize: 13, padding: 20 }}>✗ {err}</div>}
          </div>
        </div>
      </div>

      {/* export CTA + the headline render-time stat + big download */}
      <div style={{ marginTop: 22, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
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

      {status === 'done' && meta && url && (
        <div style={{ marginTop: 18, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
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
              padding: '14px 26px',
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            <span style={{ fontSize: 18 }}>⬇</span> Download the .mp4
          </a>
          <Badge icon="🎞">{DUR} frames</Badge>
          <Badge icon="🖥">no server</Badge>
          <Badge icon="🚫">no ffmpeg</Badge>
        </div>
      )}

      {/* filmstrip of captured frames */}
      {strip.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#6a6a76', letterSpacing: 1, marginBottom: 8 }}>
            FRAMES CAPTURED FROM THE LIVE DOM →
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {strip.map((src, i) => (
              // biome-ignore lint/a11y/useAltText: decorative filmstrip thumbnail
              // biome-ignore lint/suspicious/noArrayIndexKey: frames are append-only and ordered
              <img
                key={i}
                src={src}
                width={104}
                height={58}
                style={{ borderRadius: 5, border: '1px solid #26262e', opacity: 0, animation: `fadein .3s ease ${i * 0.02}s forwards` }}
              />
            ))}
          </div>
        </div>
      )}

      <CssReveal />
      <CompatMatrix />
      <VsTable />
    </div>
  );
}
