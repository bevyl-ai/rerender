// esbuild-bundle a browser-side worker (render/*-worker.ts) into a self-contained IIFE
// wrapped in minimal HTML, served to a headless-chrome page. Cached per worker path —
// the bundle is identical every render.

import { build } from 'esbuild';
import { must } from '../core/must';

const cache = new Map<string, string>();

export async function bundleWorkerHtml(workerPath: string): Promise<string> {
  let html = cache.get(workerPath);
  if (!html) {
    const result = await build({ entryPoints: [workerPath], bundle: true, format: 'iife', write: false, logLevel: 'error' });
    html = `<!doctype html><html><body><script>${must(must(result.outputFiles)[0]).text}</script></body></html>`;
    cache.set(workerPath, html);
  }
  return html;
}
