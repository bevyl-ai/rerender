import { createRoot } from 'react-dom/client';
import { ExportShowcase } from './export-showcase';
import { ExtractShowcase } from './extract-showcase';
import { ACCENT, SMOKE_TEST } from './ui';

const root = document.getElementById('root');
if (!root) throw new Error('no #root');

const link = { color: '#8a8a99', borderBottom: '1px solid #2a2a34' };

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
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 54, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>rerender</span>
        <span style={{ fontSize: 13, color: '#8a8a99' }}>MIT video primitives for the browser</span>
        <a
          href="https://github.com/bevyl-ai/rerender"
          target="_blank"
          rel="noopener noreferrer"
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
          <span style={{ fontSize: 14 }}>★</span> Star on GitHub
        </a>
      </header>

      <section style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontSize: 'clamp(34px, 8.5vw, 56px)',
            fontWeight: 850,
            lineHeight: 1.05,
            margin: '0 0 18px',
            letterSpacing: -1.6,
          }}
        >
          Any frame of an mp4, in the browser.
        </h1>
        <p style={{ fontSize: 19, color: '#9a9aa6', maxWidth: 640, lineHeight: 1.55, margin: 0 }}>
          It's a plain .mp4 sitting on a static host. Drag the track and each frame is decoded as you land on it, out of a few kilobytes of
          the file.
        </p>
      </section>

      <ExtractShowcase />

      <p style={{ marginTop: 26, fontSize: 15, color: '#6a6a76', maxWidth: 640, lineHeight: 1.6 }}>
        That's{' '}
        <a href="https://github.com/bevyl-ai/rerender#rerenderextract--any-frame-of-any-mp4-in-milliseconds" style={link}>
          <code style={{ fontFamily: 'ui-monospace, monospace' }}>rerender/extract</code>
        </a>
        . Every mp4 already carries an index of where its frames live. This reads it, then asks the server for just those bytes.{' '}
        <a href="https://bevyl.ai" style={link}>
          Bevyl
        </a>
        's editor timeline runs on it in production, in place of{' '}
        <code style={{ fontFamily: 'ui-monospace, monospace' }}>@remotion/webcodecs</code>, which needed seconds for seeks this deep.
      </p>

      {/* The in-browser export is parked: this page is about extraction. It stays mounted under
          ?smoketest so test/export.test.ts keeps driving the real export flow through the real UI —
          deleting it outright would take the export-smoke CI job down with it. Drop the guard to
          put it back on the page. */}
      {SMOKE_TEST && (
        <section style={{ marginTop: 96, paddingTop: 40, borderTop: '1px solid #1d1d25' }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, letterSpacing: 1.5, color: '#55555f', marginBottom: 14 }}>
            THE REST OF THE PACKAGE
          </div>
          <h2 style={{ fontSize: 'clamp(26px, 5vw, 38px)', fontWeight: 850, lineHeight: 1.1, margin: '0 0 16px', letterSpacing: -1.1 }}>
            Export video <span style={{ color: ACCENT }}>in your browser.</span>
          </h2>
          <p style={{ fontSize: 17, color: '#9a9aa6', maxWidth: 660, lineHeight: 1.55, margin: '0 0 30px' }}>
            Extraction is one module. The rest is a drop-in, MIT-licensed Remotion alternative: React compositions rendered to real DOM.
            Press the button and it encodes the composition below into an MP4 without leaving this tab.
          </p>
          <ExportShowcase />
        </section>
      )}

      <footer style={{ marginTop: 64, paddingTop: 24, borderTop: '1px solid #1d1d25', color: '#55555f', fontSize: 12, lineHeight: 1.6 }}>
        <div>
          Scrubber footage:{' '}
          <a href="https://durian.blender.org" style={{ color: '#6a6a76' }}>
            Sintel
          </a>{' '}
          © Blender Foundation,{' '}
          <a href="https://creativecommons.org/licenses/by/3.0/" style={{ color: '#6a6a76' }}>
            CC BY 3.0
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
