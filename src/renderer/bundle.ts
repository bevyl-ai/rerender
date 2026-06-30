// bundle() — the in-process equivalent of @remotion/bundler's bundle(). Starts a
// Vite dev server (no separate process) over an arbitrary user entry, serving a
// render page that imports the entry (firing registerRoot) and boots the studio.
// rerender's `remotion`/`@remotion/*` aliases are applied, so the user's project
// resolves to rerender exactly as the dev server does.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rerenderAliases } from '../../render/aliases';

const RERENDER_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STUDIO_CORE = fileURLToPath(new URL('../../render/studio-render-core.tsx', import.meta.url));

export interface RerenderBundle {
  serveUrl: string;
  close: () => Promise<void>;
}

export async function bundle(entryPoint: string, options: { port?: number } = {}): Promise<RerenderBundle> {
  const entry = resolve(entryPoint);
  // Serve from the project root (parent of src/) so public/ assets resolve like Remotion.
  let userRoot = dirname(entry);
  if (basename(userRoot) === 'src') userRoot = dirname(userRoot);

  // inputProps are threaded per-render via the ?props= query (see render-media/cli), so the
  // page just needs a default; props never vary for a given bundle.
  const renderPage = (): string =>
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#000;overflow:hidden}</style></head>` +
    `<body><div id="stage"></div>` +
    `<script>window.__rerenderInputProps={};window.__rerenderEnv='rendering';</script>` +
    `<script type="module">import ${JSON.stringify('/@fs/' + entry)};` +
    `import { bootStudio } from ${JSON.stringify('/@fs/' + STUDIO_CORE)};bootStudio();</script>` +
    `</body></html>`;

  const server = await createServer({
    configFile: false,
    root: userRoot,
    // Vite's dep-optimizer cache defaults to <root>/node_modules/.vite, but on AWS Lambda
    // the image fs is read-only except /tmp. RERENDER_VITE_CACHE lets the image build
    // pre-populate the cache (so the worker doesn't pay the ~4s optimize on cold start).
    cacheDir: process.env.RERENDER_VITE_CACHE ?? (process.env.AWS_LAMBDA_FUNCTION_NAME ? '/tmp/.vite-cache' : undefined),
    clearScreen: false,
    logLevel: 'silent',
    plugins: [
      react(),
      {
        name: 'rerender-render-page',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            const path = (req.url ?? '').split('?')[0];
            if (path === '/' || path === '/index.html' || path === '/__rerender.html') {
              s.transformIndexHtml(req.url ?? '/', renderPage())
                .then((html) => {
                  res.statusCode = 200;
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
    // dedupe react: rerender's modules are served from /@fs/ (outside the user root),
    // so without this the dep optimizer loads a second React copy → "Invalid hook call".
    resolve: { alias: rerenderAliases, dedupe: ['react', 'react-dom'] },
    // entries: scan the project entry at startup so the user's deps (zod, @remotion/*) are
    // optimized up front instead of discovered mid-page-load (which triggers a reload).
    optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'], entries: [entry] },
    server: { port: options.port ?? 0, strictPort: Boolean(options.port), fs: { allow: [userRoot, RERENDER_ROOT] }, hmr: false },
  });

  await server.listen();
  const local = server.resolvedUrls?.local?.[0];
  if (!local) throw new Error('Vite server did not report a local URL');
  const serveUrl = local.replace(/\/$/, '');

  return {
    serveUrl,
    close: () => server.close(),
  };
}
