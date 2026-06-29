// bundle() — the in-process equivalent of @remotion/bundler's bundle(). Starts a
// Vite dev server (no separate process) over an arbitrary user entry, serving a
// render page that imports the entry (firing registerRoot) and boots the studio.
// remover's `remotion`/`@remotion/*` aliases are applied, so the user's project
// resolves to remover exactly as the dev server does.
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removerAliases } from '../../render/aliases';

const REMOVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STUDIO_CORE = fileURLToPath(new URL('../../render/studio-render-core.tsx', import.meta.url));

export interface RemoverBundle {
  serveUrl: string;
  /** Set the inputProps injected into the next page load (window.__removerInputProps). */
  setProps: (props: Record<string, unknown>) => void;
  close: () => Promise<void>;
  server: ViteDevServer;
}

export async function bundle(entryPoint: string, options: { port?: number } = {}): Promise<RemoverBundle> {
  const entry = resolve(entryPoint);
  // Serve from the project root (parent of src/) so public/ assets resolve like Remotion.
  let userRoot = dirname(entry);
  if (basename(userRoot) === 'src') userRoot = dirname(userRoot);
  let props: Record<string, unknown> = {};

  const renderPage = (): string =>
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#000;overflow:hidden}</style></head>` +
    `<body><div id="stage"></div>` +
    `<script>window.__removerInputProps=${JSON.stringify(props)};window.__removerEnv='rendering';</script>` +
    `<script type="module">import ${JSON.stringify('/@fs/' + entry)};` +
    `import { bootStudio } from ${JSON.stringify('/@fs/' + STUDIO_CORE)};bootStudio();</script>` +
    `</body></html>`;

  const server = await createServer({
    configFile: false,
    root: userRoot,
    clearScreen: false,
    logLevel: 'silent',
    plugins: [
      react(),
      {
        name: 'remover-render-page',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            const path = (req.url ?? '').split('?')[0];
            if (path === '/' || path === '/index.html' || path === '/__remover.html') {
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
    // dedupe react: remover's modules are served from /@fs/ (outside the user root),
    // so without this the dep optimizer loads a second React copy → "Invalid hook call".
    resolve: { alias: removerAliases, dedupe: ['react', 'react-dom'] },
    optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    server: { port: options.port ?? 0, strictPort: Boolean(options.port), fs: { allow: [userRoot, REMOVER_ROOT] }, hmr: false },
  });

  await server.listen();
  const local = server.resolvedUrls?.local?.[0];
  if (!local) throw new Error('Vite server did not report a local URL');
  const serveUrl = local.replace(/\/$/, '');

  return {
    serveUrl,
    setProps: (p) => {
      props = p;
    },
    close: () => server.close(),
    server,
  };
}
