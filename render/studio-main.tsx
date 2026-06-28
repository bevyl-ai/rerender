// Studio render page — renders a composition from a REAL Remotion project's
// registered Root (registerRoot + <Composition>), proving the entry model. The
// hidden <Root/> populates the registry; <Stage> renders the chosen composition.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Stage } from './stage';
import '../template/src/index'; // executes registerRoot(RemotionRoot)
import { getComposition, getRoot, type CompositionMeta } from '../src/core/registry';

const p = new URLSearchParams(location.search);
const compId = p.get('comp') ?? 'MyVideo';
const stepMode = p.has('step');
const Root = getRoot();

function Studio(): JSX.Element {
  const [meta, setMeta] = useState<CompositionMeta | undefined>(undefined);
  // The hidden <Root/> registers its <Composition>s during this first render;
  // read the chosen one back after the commit.
  useEffect(() => setMeta(getComposition(compId)), []);
  return (
    <>
      <div style={{ display: 'none' }}>{Root ? <Root /> : null}</div>
      {meta ? (
        <Stage
          Component={meta.component}
          props={meta.defaultProps}
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
