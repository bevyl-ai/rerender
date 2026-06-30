// rerender Studio — the visual editor. Lists registered compositions, previews the
// selected one in the <Player> (scrub/play), edits its inputProps live, and renders
// to MP4 via the studio server's /api/render endpoint.
import { useEffect, useMemo, useState } from 'react';
import { Player } from '../src/core/player';
import { getCompositions, getRoot, type CompositionMeta } from '../src/core/registry';

const C = {
  bg: '#0a0a0c',
  panel: '#0e0e11',
  line: '#1c1c22',
  text: '#e9e9ee',
  dim: '#6a6a73',
  accent: '#ff2e63',
  blue: '#5b8cff',
};

export function App(): JSX.Element {
  // the hidden <Root/> (below) registers compositions during the first render; read
  // them back after the commit.
  const Root = getRoot();
  const [comps, setComps] = useState<CompositionMeta[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [propsText, setPropsText] = useState('{}');
  useEffect(() => {
    const cs = getCompositions();
    setComps(cs);
    if (cs[0]) {
      setSelectedId(cs[0].id);
      setPropsText(JSON.stringify(cs[0].defaultProps ?? {}, null, 2));
    }
  }, []);
  const selected = comps.find((c) => c.id === selectedId) ?? comps[0];
  const [rendering, setRendering] = useState(false);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const propsObj = useMemo<Record<string, unknown> | null>(() => {
    try {
      return JSON.parse(propsText) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [propsText]);

  const select = (id: string): void => {
    setSelectedId(id);
    setRenderUrl(null);
    const c = comps.find((x) => x.id === id);
    setPropsText(JSON.stringify(c?.defaultProps ?? {}, null, 2));
  };

  const render = async (): Promise<void> => {
    if (!selected || !propsObj) return;
    setRendering(true);
    setRenderUrl(null);
    setError(null);
    try {
      const res = await fetch(`/api/render?comp=${encodeURIComponent(selected.id)}&props=${encodeURIComponent(propsText)}`);
      const body = (await res.json()) as { url?: string; error?: string };
      if (body.url) setRenderUrl(body.url);
      else setError(body.error ?? 'render failed');
    } catch (e) {
      setError(String(e));
    } finally {
      setRendering(false);
    }
  };

  return (
    <>
      <div style={{ display: 'none' }}>{Root ? <Root /> : null}</div>
      <div style={{ display: 'flex', height: '100vh', background: C.bg, color: C.text, font: '14px ui-sans-serif, system-ui, sans-serif' }}>
        {/* sidebar */}
        <div style={{ width: 240, flex: 'none', borderRight: `1px solid ${C.line}`, padding: 16, overflow: 'auto', background: C.panel }}>
          <div style={{ font: '700 17px ui-sans-serif', marginBottom: 18, letterSpacing: '-0.02em' }}>
            rerender <span style={{ color: C.accent }}>studio</span>
          </div>
          {comps.map((c) => (
            <div
              key={c.id}
              onClick={() => select(c.id)}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                marginBottom: 4,
                background: c.id === selectedId ? C.line : 'transparent',
              }}
            >
              <div style={{ fontWeight: 600 }}>{c.id}</div>
              <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>
                {c.width}×{c.height} · {c.durationInFrames}f · {c.fps}fps
              </div>
            </div>
          ))}
        </div>

        {/* preview */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, minWidth: 0 }}>
          {selected && propsObj ? (
            <Player
              key={selected.id + propsText}
              composition={selected.component}
              inputProps={propsObj}
              width={selected.width}
              height={selected.height}
              fps={selected.fps}
              durationInFrames={selected.durationInFrames}
              initialFrame={Math.floor(selected.durationInFrames * 0.4)}
              displayHeight={Math.min(window.innerHeight - 120, ((window.innerWidth - 240 - 340 - 64) * selected.height) / selected.width)}
            />
          ) : (
            <div style={{ color: C.dim }}>no composition</div>
          )}
        </div>

        {/* props + render */}
        <div
          style={{
            width: 340,
            flex: 'none',
            borderLeft: `1px solid ${C.line}`,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            background: C.panel,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Props</div>
          <textarea
            value={propsText}
            onChange={(e) => setPropsText(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              background: '#141417',
              color: C.text,
              border: `1px solid ${propsObj ? C.line : C.accent}`,
              borderRadius: 8,
              padding: 12,
              font: '12px ui-monospace, monospace',
              resize: 'none',
              outline: 'none',
            }}
          />
          {!propsObj && <div style={{ color: C.accent, fontSize: 12, marginTop: 6 }}>invalid JSON</div>}
          <button
            onClick={render}
            disabled={rendering || !propsObj}
            style={{
              marginTop: 12,
              padding: 13,
              borderRadius: 8,
              border: 'none',
              background: rendering ? C.line : C.accent,
              color: '#fff',
              fontWeight: 600,
              cursor: rendering ? 'default' : 'pointer',
              fontSize: 14,
            }}
          >
            {rendering ? 'Rendering…' : '● Render MP4'}
          </button>
          {renderUrl && (
            <a href={renderUrl} download style={{ marginTop: 10, color: C.blue, fontSize: 13, textDecoration: 'none' }}>
              ↓ download {selected?.id}.mp4
            </a>
          )}
          {error && <div style={{ color: C.accent, fontSize: 12, marginTop: 10, whiteSpace: 'pre-wrap' }}>{error}</div>}
        </div>
      </div>
    </>
  );
}
