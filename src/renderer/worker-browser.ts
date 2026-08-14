// Browser-as-worker — the shared lifecycle behind the in-browser WebCodecs encoder
// (encode.ts) and the audio mixer/muxer (audio.ts). Both bundle a TS worker module to an
// IIFE, serve it (plus some data routes) from a plain http server, drive a headless-shell
// page that exposes a window.__* entry, and tear both down. This centralizes that dance;
// callers supply only the data routes and the page.evaluate() call.

import { createServer, type Server, type ServerResponse } from 'node:http';
import type { Page } from 'puppeteer-core';
import { must } from '../core/must';
import { launchBrowser } from './capture';
import { bundleWorkerHtml } from './worker-bundle';

export interface WorkerBrowser {
  page: Page;
  close: () => Promise<void>;
}

/** Bundle `workerPath`, serve it (with `handleRoute` for the worker's data routes), launch
 *  a headless-shell page on it, and wait for window.__ready. Returns the page to evaluate
 *  against and a close() that tears down the browser then the server.
 *
 *  `handleRoute(pathname, res)` returns true once it has taken ownership of the response
 *  (it may end it later, e.g. after reading a file); false to fall through to a 404. */
export async function spawnWorkerBrowser(
  exe: string,
  workerPath: string,
  handleRoute: (pathname: string, res: ServerResponse) => boolean,
): Promise<WorkerBrowser> {
  const html = await bundleWorkerHtml(workerPath);
  const server: Server = createServer((req, res) => {
    const pathname = must((req.url ?? '/').split('?')[0]);
    if (pathname === '/') {
      res.setHeader('content-type', 'text/html');
      res.end(html);
      return;
    }
    if (handleRoute(pathname, res)) return;
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const browser = await launchBrowser(exe);
  // Use the browser's already-attached initial page — a fresh newPage() can race the
  // frame-tree attach over Lambda's pipe transport ("Requesting main frame too early!").
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  page.on('pageerror', (e) => console.error('[worker]', String(e).slice(0, 200)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 30_000 });
  return {
    page,
    close: async () => {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
