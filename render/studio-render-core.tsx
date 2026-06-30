// Shared studio boot — mounts the chosen registered composition for capture. Used
// by the templates studio page (studio-main) and by the renderer's in-process
// bundle (which imports the user's entry, then calls bootStudio). The Root must
// already be registered (via registerRoot) before this runs.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Stage } from './stage';
import { getComposition, getCompositions, getRoot, type CompositionMeta } from '../src/core/registry';

interface CompositionInfo {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  defaultProps: Record<string, unknown>;
}

declare global {
  interface Window {
    __getCompositions?: () => CompositionInfo[];
  }
}

export function bootStudio(): void {
  const p = new URLSearchParams(location.search);
  const compId = p.get('comp') ?? '';
  const stepMode = p.has('step');

  // inputProps arrive statelessly via ?props= so the renderer's serveUrl stays a string.
  const propsParam = p.get('props');
  if (propsParam) window.__rerenderInputProps = JSON.parse(decodeURIComponent(propsParam));
  const inputProps = window.__rerenderInputProps ?? {};

  // let the renderer enumerate registered compositions (after the hidden <Root/> mounts).
  window.__getCompositions = () =>
    getCompositions().map((c) => ({
      id: c.id,
      width: c.width,
      height: c.height,
      fps: c.fps,
      durationInFrames: c.durationInFrames,
      defaultProps: c.defaultProps,
    }));

  function Studio(): JSX.Element {
    const Root = getRoot();
    const [meta, setMeta] = useState<CompositionMeta | undefined>(undefined);
    // the hidden <Root/> registers compositions during this first render; read back after.
    useEffect(() => setMeta(getComposition(compId) ?? getCompositions()[0]), []);
    return (
      <>
        <div style={{ display: 'none' }}>{Root ? <Root /> : null}</div>
        {meta ? (
          <Stage
            Component={meta.component}
            props={{ ...meta.defaultProps, ...inputProps }}
            config={{ width: meta.width, height: meta.height, fps: meta.fps, durationInFrames: meta.durationInFrames }}
            from={0}
            to={meta.durationInFrames}
            stepMode={stepMode}
          />
        ) : null}
      </>
    );
  }

  const root = document.getElementById('stage');
  if (!root) throw new Error('no #stage');
  createRoot(root).render(<Studio />);
}
