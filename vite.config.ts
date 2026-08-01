import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rerenderAliases } from './render/aliases';

// The demo runs the real @remotion/webcodecs next to rerender/extract, and that package needs the
// real @remotion/media-parser: its worker imports members our drop-in shim doesn't have
// (MediaParserInternals, mediaParserController, …), and because the alias is a prefix match it also
// rewrote `@remotion/media-parser/worker` to a path *inside* the shim file. Nothing in demo/ or
// src/ imports that specifier at runtime, so the demo build drops this one entry. The renderer's
// in-process bundle keeps the full table, which is what user projects resolve against.
const demoAliases = rerenderAliases.filter((entry) => entry.find !== '@remotion/media-parser');

// drop-in: `import … from 'remotion'` / '@remotion/*' resolves to rerender (shared
// with the renderer's in-process bundle, so dev + render resolve identically).
export default defineConfig({
  root: '.',
  plugins: [react()],
  resolve: { alias: demoAliases, dedupe: ['react', 'react-dom'] },
  // @remotion/media-parser spawns its worker from its own module URL and throws outright
  // ("Detected Vite pre-bundling, which will break the worker") if it has been rewritten into
  // .vite/deps. Its own error message asks for exactly this.
  optimizeDeps: { exclude: ['@remotion/media-parser/worker'] },
  // Two pages: the demo, and one section per supported codec.
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), codecs: resolve(__dirname, 'codecs.html') } } },
  server: { open: false },
});
