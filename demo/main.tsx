import { createRoot } from 'react-dom/client';
import { Player } from '../src';
import { Demo } from './composition';

const root = document.getElementById('root');
if (!root) throw new Error('no #root');

createRoot(root).render(
  <div style={{ padding: 28, fontFamily: 'system-ui, sans-serif', color: '#e9e9ee' }}>
    <div style={{ fontWeight: 600, marginBottom: 4 }}>remover · @remover/core</div>
    <div style={{ color: '#8a8a93', fontSize: 13, marginBottom: 20, maxWidth: 520 }}>
      A Remotion-API composition playing in <b>real DOM</b> — video, a Ken Burns push, and a<code> backdrop-filter</code> glass caption
      (arbitrary CSS). This preview <i>is</i> the renderer.
    </div>
    <Player composition={Demo} width={1080} height={1920} fps={30} durationInFrames={90} displayHeight={620} />
  </div>,
);
