import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const abs = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// drop-in: `import … from 'remotion'` / '@remotion/*' resolves to remover.
// Order matters — subpaths before their base package (first match wins).
export default defineConfig({
  root: '.',
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@remotion/transitions/slide', replacement: abs('./src/transitions/presentations/slide.tsx') },
      { find: '@remotion/transitions/fade', replacement: abs('./src/transitions/presentations/fade.tsx') },
      { find: '@remotion/transitions/wipe', replacement: abs('./src/transitions/presentations/wipe.tsx') },
      { find: '@remotion/transitions', replacement: abs('./src/transitions/index.ts') },
      { find: '@remotion/media-utils', replacement: abs('./src/media-utils/index.ts') },
      { find: /^remotion$/, replacement: abs('./src/remotion.ts') },
    ],
  },
  server: { open: false },
});
