// Ranged-fetch access to an mp4 URL: locate + fetch the moov (front- or back-of-file),
// fetch GOP byte ranges. Uses default fetch cache semantics on purpose — immutable/cacheable
// video URLs get browser disk-cache hits on repeat ranges for free.

import { ExtractError } from './errors';

export interface RangeSource {
  /** Bytes from `start` (inclusive) to `end` (exclusive). */
  read(start: number, end: number, signal?: AbortSignal): Promise<Uint8Array>;
  /** Bytes spanning file offset 0 through the end of the moov box. */
  readThroughMoov(signal?: AbortSignal): Promise<Uint8Array>;
  /**
   * The last `length` bytes, and the offset they start at. A fragmented file keeps its random-access
   * index (`mfra`) at the very end, and the only way to find it without knowing the file's length is
   * the suffix range this sends. Optional: a custom source that cannot express one simply cannot
   * read fragmented files.
   */
  readSuffix?(length: number, signal?: AbortSignal): Promise<{ bytes: Uint8Array; start: number }>;
}

/**
 * How many bytes to speculatively read when probing box headers. Sized so an ordinary clip's whole
 * index arrives in one request, because missing costs a second round trip: the demo's 12-minute
 * rendition indexes to 164 KB, and reading it as 64 KB + a 102 KB remainder measured 156 ms against
 * production where a single 192 KB read measured 68 ms.
 *
 * Sample tables run about 8 bytes per frame, so this covers roughly 13 minutes at 30fps. Going
 * bigger keeps helping longer videos and costs everyone else the extra bytes; the trade turns on
 * whether those bytes cost less than the round trip they save, which is bandwidth * RTT. At the
 * 72 ms RTT measured against production that break-even sits near 15 Mbps, and on mobile — higher
 * latency, so a dearer round trip — nearer 5 Mbps. Overrunning is not a cliff either way, just the
 * second request this is trying to avoid.
 */
const HEAD_PROBE_BYTES = 192 * 1024;

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
  const fetchRange = async (start: number, end: number, signal?: AbortSignal, cache?: RequestCache): Promise<Uint8Array> => {
    const res = await fetchFn(src, { headers: { Range: `bytes=${start}-${end - 1}` }, signal, ...(cache ? { cache } : {}) });
    if (res.status !== 206 && res.status !== 200) {
      throw new ExtractError('range-request-failed', `range request failed for ${src}: ${res.status}`, { src });
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A 200 means the server ignored the Range header; slice locally so callers still work.
    return res.status === 200 ? bytes.slice(start, end) : bytes;
  };

  // Concurrent range requests for one URL queue behind that URL's cache entry, so twelve reads
  // issued at once come back one at a time: measured on the deployed demo, 12 scattered reads took
  // 642-805 ms under default cache mode and 129-166 ms bypassing it. Repeating the same twelve
  // ranges under default mode took 907 ms, so the entry we are queueing for never serves us
  // anyway — the cost is real and the benefit it was supposed to buy is not.
  //
  // force-cache is faster still (4 ms on a repeat) but returns stale bodies whatever the server
  // said about freshness, and a frame extractor that quietly decodes last week's file is a worse
  // bug than a slow one.
  const read = (start: number, end: number, signal?: AbortSignal): Promise<Uint8Array> => fetchRange(start, end, signal, 'no-store');

  // The index reads go the other way: they run one after another, so they never queue behind each
  // other, and every new extractor over a URL asks for the same head bytes. Default cache mode is
  // what makes the second extractor over a file cheap.
  const readIndex = (start: number, end: number, signal?: AbortSignal): Promise<Uint8Array> => fetchRange(start, end, signal);

  /** `Range: bytes=-N`, whose 206 reports where the tail actually began. */
  const readSuffix = async (length: number, signal?: AbortSignal): Promise<{ bytes: Uint8Array; start: number }> => {
    const res = await fetchFn(src, { cache: 'no-store', headers: { Range: `bytes=-${length}` }, signal });
    if (res.status !== 206 && res.status !== 200) {
      throw new ExtractError('range-request-failed', `suffix request failed for ${src}: ${res.status}`, { src });
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A server that ignored the Range handed back the whole file; the tail is still in there.
    if (res.status === 200)
      return { bytes: bytes.slice(Math.max(0, bytes.byteLength - length)), start: Math.max(0, bytes.byteLength - length) };
    const contentRange = res.headers.get('content-range');
    const start = contentRange ? Number(/bytes (\d+)-/.exec(contentRange)?.[1] ?? Number.NaN) : Number.NaN;
    if (!Number.isFinite(start)) {
      throw new ExtractError('range-request-failed', `suffix request for ${src} answered 206 without a usable Content-Range`, { src });
    }
    return { bytes, start };
  };

  const readThroughMoov = async (signal?: AbortSignal): Promise<Uint8Array> => {
    const head = await readIndex(0, HEAD_PROBE_BYTES, signal);
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
        const rest = await readIndex(head.byteLength, moovEnd, signal);
        const moov = new Uint8Array(moovEnd);
        moov.set(head, 0);
        moov.set(rest, head.byteLength);
        return moov;
      }
      if (box.type === 'mdat') {
        // moov is behind the media data: probe the box header right after mdat.
        const afterMdat = box.start + box.size;
        const tailProbe = await readIndex(afterMdat, afterMdat + 16, signal);
        const tailBox = readTopLevelBox(new DataView(tailProbe.buffer, tailProbe.byteOffset, tailProbe.byteLength), 0);
        if (tailBox?.type !== 'moov') throw new ExtractError('no-moov', `no moov after mdat in ${src}`, { src });
        // The moov box alone is a valid buffer for parseSampleTable (it walks whatever
        // top-level boxes it's given), and stco offsets are file-absolute so no rebasing.
        return readIndex(afterMdat, afterMdat + tailBox.size, signal);
      }
      at = box.start + box.size;
    }
    throw new ExtractError('no-moov', `could not locate moov in ${src} (probed first ${HEAD_PROBE_BYTES} bytes)`, { src });
  };

  return { read, readThroughMoov, readSuffix };
}
