// esbuild-bundle a browser-side worker (render/*-worker.ts) into a self-contained IIFE
// wrapped in minimal HTML, served to a headless-chrome page. Cached per worker path —
// the bundle is identical every render.

import { build } from 'esbuild';

const cache = new Map<string, string>();

export async function bundleWorkerHtml(workerPath: string): Promise<string> {
  let html = cache.get(workerPath);
  if (!html) {
    const result = await build({ entryPoints: [workerPath], bundle: true, format: 'iife', write: false, logLevel: 'error' });
    const file = result.outputFiles[0];
    if (!file) throw new Error(`esbuild produced no output for ${workerPath}`);
    html = `<!doctype html><html><body><script>${file.text}</script></body></html>`;
    cache.set(workerPath, html);
  }
  return html;
}
