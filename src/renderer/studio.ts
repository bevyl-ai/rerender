// studioServer — `remover studio`. A Vite server that serves the remover Studio
// editor (sidebar + live preview + props editor) over the user's project, plus an
// /api/render endpoint backing the render button (bundles + renders to an mp4 it
// then serves at /renders/<file>).
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removerAliases } from '../../render/aliases';
import { bundle } from './bundle';
import { renderMedia } from './render-media';
import { selectComposition } from './select-composition';

const REMOVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STUDIO_MAIN = fileURLToPath(new URL('../../studio/main.tsx', import.meta.url));

export async function studioServer(
  entryPoint: string,
  options: { port?: number } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const entry = resolve(entryPoint);
  let userRoot = dirname(entry);
  if (basename(userRoot) === 'src') userRoot = dirname(userRoot);
  const rendersDir = mkdtempSync(join(tmpdir(), 'remover-studio-'));

  const studioHtml =
    `<!doctype html><html><head><meta charset="utf-8"><title>remover studio</title>` +
    `<style>html,body,#root{margin:0;height:100%;background:#0a0a0c}</style></head>` +
    `<body><div id="root"></div>` +
    `<script type="module">import ${JSON.stringify('/@fs/' + entry)};` +
    `import { bootStudioApp } from ${JSON.stringify('/@fs/' + STUDIO_MAIN)};bootStudioApp();</script></body></html>`;

  const server = await createServer({
    configFile: false,
    root: userRoot,
    clearScreen: false,
    logLevel: 'silent',
    plugins: [
      react(),
      {
        name: 'remover-studio',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            const url = req.url ?? '/';
            const path = url.split('?')[0]!;

            if (path.startsWith('/renders/')) {
              const file = join(rendersDir, basename(path));
              if (existsSync(file)) {
                res.setHeader('content-type', 'video/mp4');
                createReadStream(file).pipe(res);
              } else {
                res.statusCode = 404;
                res.end('not found');
              }
              return;
            }

            if (path === '/api/render') {
              const q = new URL(url, 'http://x').searchParams;
              void (async (): Promise<void> => {
                res.setHeader('content-type', 'application/json');
                try {
                  const inputProps = JSON.parse(q.get('props') ?? '{}') as Record<string, unknown>;
                  const b = await bundle(entry);
                  try {
                    const composition = await selectComposition({ serveUrl: b.serveUrl, id: q.get('comp') ?? '', inputProps });
                    const file = `${composition.id}-${Date.now()}.mp4`;
                    await renderMedia({ composition, serveUrl: b.serveUrl, outputLocation: join(rendersDir, file), inputProps });
                    res.end(JSON.stringify({ url: `/renders/${file}` }));
                  } finally {
                    await b.close();
                  }
                } catch (e) {
                  res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
                }
              })();
              return;
            }

            if (path === '/' || path === '/index.html') {
              s.transformIndexHtml(url, studioHtml)
                .then((html) => {
                  res.setHeader('content-type', 'text/html');
                  res.end(html);
                })
                .catch(next);
              return;
            }
            next();
          });
        },
      },
    ],
    resolve: { alias: removerAliases, dedupe: ['react', 'react-dom'] },
    optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    server: { port: options.port ?? 0, fs: { allow: [userRoot, REMOVER_ROOT, rendersDir] }, hmr: false },
  });

  await server.listen();
  const local = server.resolvedUrls?.local?.[0];
  if (!local) throw new Error('Vite server did not report a local URL');
  return { url: local.replace(/\/$/, ''), close: () => server.close() };
}
