import { createRoot } from 'react-dom/client';
import { Codecs } from './codecs';

const root = document.getElementById('root');
if (!root) throw new Error('no #root');

createRoot(root).render(
  <>
    <style>{`
      html, body { margin:0; background: #0b0b0d; }
      body { color:#e9e9ee; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing:antialiased; }
      @keyframes fadein { to { opacity:1 } }
      a { text-decoration:none }
      button { font-family: inherit }
    `}</style>
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 28px 80px' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 48, flexWrap: 'wrap' }}>
        <a href="/" style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, color: '#e9e9ee' }}>
          rerender
        </a>
        <span style={{ fontSize: 13, color: '#8a8a99' }}>Codecs</span>
        <a
          href="/"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            background: '#16161d',
            border: '1px solid #26262e',
            borderRadius: 999,
            padding: '7px 14px',
            fontSize: 13,
            fontWeight: 600,
            color: '#cfcfd8',
          }}
        >
          ← Back to the demo
        </a>
      </header>

      <Codecs />

      <footer style={{ marginTop: 64, paddingTop: 24, borderTop: '1px solid #1d1d25', color: '#55555f', fontSize: 12, lineHeight: 1.6 }}>
        <div>
          Footage:{' '}
          <a href="https://mango.blender.org" style={{ color: '#6a6a76' }}>
            Tears of Steel
          </a>
          , © Blender Foundation,{' '}
          <a href="https://creativecommons.org/licenses/by/3.0/" style={{ color: '#6a6a76' }}>
            CC BY 3.0
          </a>
          .
        </div>
        <div style={{ marginTop: 8 }}>
          Built by the team at{' '}
          <a href="https://www.bevyl.ai" style={{ color: '#6a6a76' }}>
            Bevyl
          </a>
          .
        </div>
        <div style={{ marginTop: 8 }}>
          Independent open-source project. Not affiliated with, endorsed by, or sponsored by Remotion or Remotion Inc.
          &ldquo;Remotion&rdquo; is a trademark of its respective owner; used here only to describe API compatibility.
        </div>
      </footer>
    </div>
  </>,
);
