# Entry points

One package, five entry points.

| import | what it is |
| -- | -- |
| `@bevyl-ai/rerender` | Remotion-compatible runtime, primitives, `<Player>` |
| `@bevyl-ai/rerender/extract` | mp4 frame extraction + frame store. Zero dependencies |
| `@bevyl-ai/rerender/media-parser` | `@remotion/media-parser`'s `parseMedia`, over mediabunny |
| `@bevyl-ai/rerender/media` | `@remotion/media`'s `<Video>`/`<Audio>`, over mediabunny sinks |
| `@bevyl-ai/rerender/audio-engine` | the Web Audio preview scheduler, for external players |

## Requirements

`extract` is browser-only — fetch and WebCodecs, nothing else, no transitive dependencies.

`react` and `react-dom` >=18 are peer dependencies for everything that renders. The CLI needs
Node >=20.3.

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

## `media`, `audio-engine`, and the runtime

See [rendering](./rendering.md) for the runtime and the two render paths, and
[remotion-media-spec.md](./remotion-media-spec.md) for the `<Video>`/`<Audio>` surface.
