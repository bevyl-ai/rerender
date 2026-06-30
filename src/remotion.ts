// `remotion` drop-in shim. Alias `remotion` → this file (see vite.config + tsconfig
// paths) and existing `import { … } from 'remotion'` compositions run on rerender
// unchanged. rerender renders to real DOM, so their arbitrary CSS just works.
export * from './index';
