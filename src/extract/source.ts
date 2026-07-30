// Ranged-fetch access to an mp4 URL: locate + fetch the moov (front- or back-of-file),
// fetch GOP byte ranges. Uses default fetch cache semantics on purpose — immutable/cacheable
// video URLs get browser disk-cache hits on repeat ranges for free.

export interface RangeSource {
  /** Bytes from `start` (inclusive) to `end` (exclusive). */
  read(start: number, end: number, signal?: AbortSignal): Promise<Uint8Array>;
  /** Bytes spanning file offset 0 through the end of the moov box. */
  readThroughMoov(signal?: AbortSignal): Promise<Uint8Array>;
  /** Total file size once a response has reported it, else null. */
  size(): number | null;
  /** Pull the whole file once; every later read is served from it without touching the network. */
  preload(signal?: AbortSignal): Promise<void>;
}

/** How many bytes to speculatively read when probing box headers. Covers ftyp+free+small moovs in one request. */
const HEAD_PROBE_BYTES = 64 * 1024;

interface TopLevelBox {
  type: string;
  start: number;
  size: number;
}

function readTopLevelBox(view: DataView, at: number): TopLevelBox | null {
  if (at + 8 > view.byteLength) return null;
  const size32 = view.getUint32(at);
  const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
  const size = size32 === 1 ? (at + 16 <= view.byteLength ? Number(view.getBigUint64(at + 8)) : null) : size32;
  if (size === null || size < 8) return null;
  return { type, start: at, size };
}

export function createUrlSource(src: string, fetchFn: typeof fetch = fetch): RangeSource {
  let totalSize: number | null = null;
  let whole: Uint8Array | null = null;

  const read = async (start: number, end: number, signal?: AbortSignal): Promise<Uint8Array> => {
    if (whole) return whole.subarray(start, Math.min(end, whole.byteLength));
    const res = await fetchFn(src, { headers: { Range: `bytes=${start}-${end - 1}` }, signal });
    if (res.status !== 206 && res.status !== 200) throw new Error(`range request failed for ${src}: ${res.status}`);
    const total = res.headers?.get('Content-Range')?.split('/')[1];
    if (total && total !== '*') totalSize = Number(total);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (res.status === 200) totalSize = bytes.byteLength;
    // A 200 means the server ignored the Range header; slice locally so callers still work.
    return res.status === 200 ? bytes.slice(start, end) : bytes;
  };

  const preload = async (signal?: AbortSignal): Promise<void> => {
    if (whole) return;
    const res = await fetchFn(src, { signal });
    if (!res.ok) throw new Error(`whole-file read failed for ${src}: ${res.status}`);
    whole = new Uint8Array(await res.arrayBuffer());
    totalSize = whole.byteLength;
  };

  const readThroughMoov = async (signal?: AbortSignal): Promise<Uint8Array> => {
    const head = await read(0, HEAD_PROBE_BYTES, signal);
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);

    // Walk top-level boxes from the front until we find moov or hit mdat (moov-at-end layout).
    let at = 0;
    for (;;) {
      const box = at + 16 <= head.byteLength ? readTopLevelBox(view, at) : null;
      if (!box) break;
      if (box.type === 'moov') {
        const moovEnd = box.start + box.size;
        if (moovEnd <= head.byteLength) return head.subarray(0, moovEnd);
        // Only the part the probe didn't already cover. Re-reading from 0 costs the probe's
        // bytes a second time, which is most of a round trip's worth on a long file's moov
        // (a 30-minute rendition indexes ~400 KB of sample table).
        const rest = await read(head.byteLength, moovEnd, signal);
        const moov = new Uint8Array(moovEnd);
        moov.set(head, 0);
        moov.set(rest, head.byteLength);
        return moov;
      }
      if (box.type === 'mdat') {
        // moov is behind the media data: probe the box header right after mdat.
        const afterMdat = box.start + box.size;
        const tailProbe = await read(afterMdat, afterMdat + 16, signal);
        const tailBox = readTopLevelBox(new DataView(tailProbe.buffer, tailProbe.byteOffset, tailProbe.byteLength), 0);
        if (tailBox?.type !== 'moov') throw new Error(`no moov after mdat in ${src}`);
        // The moov box alone is a valid buffer for parseSampleTable (it walks whatever
        // top-level boxes it's given), and stco offsets are file-absolute so no rebasing.
        return read(afterMdat, afterMdat + tailBox.size, signal);
      }
      at = box.start + box.size;
    }
    throw new Error(`could not locate moov in ${src} (probed first ${HEAD_PROBE_BYTES} bytes)`);
  };

  return { read, readThroughMoov, size: () => totalSize, preload };
}
