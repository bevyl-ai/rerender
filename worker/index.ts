// Range-correct asset serving for the demo's media.
//
// Cloudflare's static-asset layer only honours a Range request once that exact URL is warm at the
// edge. The first request for a URL comes back as a full-body 200 with no Content-Range, and every
// new PoP starts cold. rerender/extract survives that (src/extract/source.ts slices a 200 locally),
// but @remotion/media-parser refuses: its opening read asks for `bytes=0-`, sees a 200 instead of a
// 206, decides the server has no range support and throws before parsing anything. That made the
// head-to-head on the deployed site show an error instead of a comparison.
//
// So the Worker answers ranges itself. Everything non-media passes straight through.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface Span {
  start: number;
  end: number; // inclusive, per RFC 7233
}

/** `bytes=start-end`, `bytes=start-`, `bytes=-suffix`. Null if unparseable or unsatisfiable. */
function parseRange(header: string, size: number): Span | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  // Suffix form: the last N bytes.
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (suffix === 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start > end || start >= size) return null;
  return { start, end };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const wantsRange = request.headers.get('Range');
    if (!wantsRange || !/\.(mp4|mp3)$/.test(pathname)) return env.ASSETS.fetch(request);

    const asset = await env.ASSETS.fetch(request);
    // Already a proper partial response — nothing to do but advertise range support.
    if (asset.status === 206) {
      const headers = new Headers(asset.headers);
      headers.set('Accept-Ranges', 'bytes');
      return new Response(asset.body, { status: 206, statusText: asset.statusText, headers });
    }
    if (asset.status !== 200) return asset;

    const body = await asset.arrayBuffer();
    const span = parseRange(wantsRange, body.byteLength);
    if (!span) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${body.byteLength}`, 'Accept-Ranges': 'bytes' },
      });
    }

    const headers = new Headers(asset.headers);
    headers.set('Content-Range', `bytes ${span.start}-${span.end}/${body.byteLength}`);
    headers.set('Content-Length', String(span.end - span.start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(body.slice(span.start, span.end + 1), { status: 206, headers });
  },
};
