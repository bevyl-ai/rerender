import { createRoot } from 'react-dom/client';
import { ExportShowcase } from './export-showcase';

const ACCENT = '#ff5e8a';
const root = document.getElementById('root');
if (!root) throw new Error('no #root');

createRoot(root).render(
  <>
    <style>{`
      body { margin:0; background: radial-gradient(1200px 620px at 72% -12%, #1b1226, #07070b 62%); color:#e9e9ee;
             font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing:antialiased; }
      @keyframes fadein { to { opacity:1 } }
      a { text-decoration:none }
      button { font-family: inherit }
    `}</style>
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 28px 80px' }}>
      <header
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 54, gap: 16, flexWrap: 'wrap' }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>rerender</span>
          <span style={{ fontSize: 13, color: '#8a8a99' }}>a drop-in, MIT Remotion</span>
        </div>
        <span
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 12,
            color: '#6a6a76',
            border: '1px solid #26262e',
            borderRadius: 999,
            padding: '6px 12px',
          }}
        >
          render = a recording of the preview
        </span>
      </header>

      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: ACCENT, letterSpacing: 2, fontWeight: 600 }}>
          NO SERVER · NO FFMPEG
        </div>
        <h1 style={{ fontSize: 56, fontWeight: 850, lineHeight: 1.04, margin: '14px 0 18px', letterSpacing: -1.6 }}>
          Export video{' '}
          <span
            style={{
              background: 'linear-gradient(90deg,#ff5e8a,#ffa14a)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            in your browser.
          </span>
        </h1>
        <p style={{ fontSize: 19, color: '#9a9aa6', maxWidth: 660, lineHeight: 1.55, margin: 0 }}>
          The composition plays in real DOM with arbitrary CSS. One click frame-steps it, captures every frame straight from the page, and
          encodes an MP4 with WebCodecs + WASM — all in this tab. The thing Remotion needs a cloud render farm and a bundled ffmpeg for.
        </p>
      </section>

      <ExportShowcase />

      <footer
        style={{
          marginTop: 64,
          paddingTop: 24,
          borderTop: '1px solid #1d1d25',
          color: '#6a6a76',
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <span>WebCodecs · mediabunny · React · foreignObject capture</span>
        <span>same engine renders headless &amp; on AWS Lambda — this is just the no-server path</span>
      </footer>
    </div>
  </>,
);
