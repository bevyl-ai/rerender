import { defineConfig } from 'tsup';

// Builds the npm dist for the library entry points (the CLI and renderer run
// from source via tsx and are not bundled here). Only true externals are listed —
// everything else inlines from our own MIT src; in particular nothing may resolve
// to the real `remotion` devDependency (its license does not permit redistribution),
// which `npm run check:dist` enforces after every build.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    extract: 'src/extract/index.ts',
    'media-parser': 'src/media-parser/index.ts',
    media: 'src/media/index.ts',
    'audio-engine': 'src/core/audio-engine.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2022',
  external: ['react', 'react-dom', 'mediabunny', '@mediabunny/aac-encoder'],
});
