# Entry points

The npm package ships two modules. The Remotion-compatible renderer lives in this
repo and is not published.

| import | what it is |
| -- | -- |
| `@bevyl-ai/rerender` | same as `./extract` |
| `@bevyl-ai/rerender/extract` | mp4 frame extraction + frame store. Zero dependencies |
| `@bevyl-ai/rerender/media-parser` | `@remotion/media-parser`'s `parseMedia`, over mediabunny |

## Requirements

`extract` is browser-only — fetch and WebCodecs, nothing else, no transitive dependencies.

`parseMedia` needs [mediabunny](https://mediabunny.dev), declared as an optional peer.

The CLI (`rerender render`, studio, cloud) is Node. It needs Node >=20.19. Install the
repo with Bun >=1.3.14 (`packageManager` in `package.json`).

## `media-parser`

`parseMedia`, over mediabunny. Codec, duration, dimensions, fps — the metadata call an editor needs
on drag-and-drop import. It keeps Remotion's field-selection contract, so the fields you ask for are
the fields present in the returned type.

```ts
import { parseMedia } from '@bevyl-ai/rerender/media-parser';

const { dimensions, videoCodec } = await parseMedia({
  src: file,
  fields: { dimensions: true, videoCodec: true },
});
```

## `extract`

See [frame extraction](./frame-extraction.md).

## In this repo, not on npm

| path | what it is |
| -- | -- |
| `src/index.ts` (tsconfig/vite alias: `remotion`) | Remotion-compatible runtime, primitives, `<Player>` |
| `src/media` | `@remotion/media`'s `<Video>`/`<Audio>`, over mediabunny sinks |
| `src/core/audio-engine.ts` | the Web Audio preview scheduler |
| `src/renderer` + `bin/rerender.mjs` | headless Chrome CLI (always respawns Node) |

See [rendering](./rendering.md) for the runtime and the two render paths, and
[remotion-media-spec.md](./remotion-media-spec.md) for the `<Video>`/`<Audio>` surface.
