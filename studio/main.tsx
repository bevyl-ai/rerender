// Studio boot — mounts the editor. The studio server's HTML imports the user's
// entry first (firing registerRoot), then calls bootStudioApp, so getCompositions()
// in <App> already has the project's compositions.
import { createRoot } from 'react-dom/client';
import { App } from './App';

export function bootStudioApp(): void {
  if (typeof window !== 'undefined') window.__rerenderEnv = 'player';
  const root = document.getElementById('root');
  if (!root) throw new Error('no #root');
  createRoot(root).render(<App />);
}
