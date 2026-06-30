import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rerenderAliases } from './render/aliases';

// drop-in: `import … from 'remotion'` / '@remotion/*' resolves to rerender (shared
// with the renderer's in-process bundle, so dev + render resolve identically).
export default defineConfig({
  root: '.',
  plugins: [react()],
  resolve: { alias: rerenderAliases, dedupe: ['react', 'react-dom'] },
  server: { open: false },
});
