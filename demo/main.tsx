import { createRoot } from 'react-dom/client';
import { ExportShowcase } from './export-showcase';

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
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 54, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>rerender</span>
        <span style={{ fontSize: 13, color: '#8a8a99' }}>a drop-in, MIT-licensed Remotion alternative</span>
      </header>

      <section style={{ marginBottom: 36 }}>
        <h1 style={{ fontSize: 'clamp(34px, 8.5vw, 56px)', fontWeight: 850, lineHeight: 1.05, margin: '0 0 18px', letterSpacing: -1.6 }}>
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
          It's the same React you'd write in Remotion: real DOM, real CSS. One click frame-steps the composition, captures each frame from
          the page, and encodes an MP4 with WebCodecs, right here in this tab. No server, no native ffmpeg, no render farm to stand up.
        </p>
      </section>

      <ExportShowcase />

      <footer style={{ marginTop: 64, paddingTop: 24, borderTop: '1px solid #1d1d25', color: '#55555f', fontSize: 12, lineHeight: 1.5 }}>
        Independent open-source project. Not affiliated with, endorsed by, or sponsored by Remotion or Remotion Inc. &ldquo;Remotion&rdquo;
        is a trademark of its respective owner; used here only to describe API compatibility.
      </footer>
    </div>
  </>,
);
