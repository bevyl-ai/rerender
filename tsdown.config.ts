import { defineConfig } from 'tsdown';

// Builds the published extract + media-parser entries. Only true externals are
// listed — everything else inlines from our own MIT src. `bun run build:lib`
// then runs check-dist to enforce that.
export default defineConfig({
  entry: {
    extract: 'src/extract/index.ts',
    'media-parser': 'src/media-parser/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2022',
  fixedExtension: false,
  hash: false,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: { neverBundle: ['mediabunny'] },
});
