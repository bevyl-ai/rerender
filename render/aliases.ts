// The `remotion` / `@remotion/*` → rerender alias table, shared by vite.config.ts
// (dev server) and the renderer's in-process bundle (src/renderer/bundle.ts), so a
// user project's imports resolve to rerender identically in both. Subpaths before
// their base package; `remotion` is an exact regex so it never catches `@remotion/*`.
import { fileURLToPath } from 'node:url';

const abs = (p: string): string => fileURLToPath(new URL('../' + p, import.meta.url));

export const rerenderAliases = [
  { find: '@remotion/transitions/slide', replacement: abs('src/transitions/presentations/slide.tsx') },
  { find: '@remotion/transitions/fade', replacement: abs('src/transitions/presentations/fade.tsx') },
  { find: '@remotion/transitions/wipe', replacement: abs('src/transitions/presentations/wipe.tsx') },
  { find: '@remotion/transitions', replacement: abs('src/transitions/index.ts') },
  { find: '@remotion/media-utils', replacement: abs('src/media-utils/index.ts') },
  { find: '@remotion/media-parser', replacement: abs('src/media-parser/index.ts') },
  { find: '@remotion/lambda-client', replacement: abs('cloud/lambda-client.ts') },
  { find: '@remotion/lambda', replacement: abs('cloud/lambda-client.ts') },
  { find: '@remotion/player', replacement: abs('src/core/player.tsx') },
  { find: /^remotion$/, replacement: abs('src/remotion.ts') },
];
