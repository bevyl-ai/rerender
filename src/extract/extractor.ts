// Frame extraction: requested seconds → GOP byte ranges → VideoDecoder → VideoFrames.
// One decoder pass per GOP; samples are fed in decode (= file) order and matched to
// requested timestamps by presentation time. Never mutates the caller's timestamp array;
// out-of-range timestamps clamp; every requested timestamp gets exactly one frame callback.

import { parseSampleTable, type SampleTable } from './mp4-sample-table';
import { createUrlSource, type RangeSource } from './source';

export interface FrameExtractorOptions {
  src: string;
  /**
   * Cancels setup and all in-flight work when aborted — same effect as dispose().
   * Tie it to the extractor's lifetime (e.g. component unmount). To bound setup
   * only, don't pass AbortSignal.timeout (it would kill the extractor at T even
   * after a successful setup) — abort a dedicated controller from a timer you
   * clear once createFrameExtractor settles.
   */
  signal?: AbortSignal;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Max GOP fetches in flight per extract() call. Default 8. */
  maxParallelFetches?: number;
}

export interface ExtractOptions {
  /** Cancels this call's fetches and decodes when aborted; the extractor stays usable. */
  signal?: AbortSignal;
}

export type OnFrame = (frame: VideoFrame, requestedSeconds: number) => void;

export interface FrameExtractor {
  readonly sampleTable: SampleTable;
  /** Presentation time of the last displayed frame, in seconds — the media's duration
   *  (loop points and end-of-clip clamping key off this, not the container's stated duration). */
  readonly durationSeconds: number;
  /**
   * Presentation timestamp (µs) of the sample nearest a requested time — the exact
   * `VideoFrame.timestamp` that `extract` would deliver for it. Stable across calls,
   * so it works as a cache key for the requested time at any granularity.
   */
  snapToSampleMicros(seconds: number): number;
  /**
   * Decodes the frame nearest each requested timestamp and delivers it via `onFrame`.
   * Frames arrive as they decode (not in request order); the receiver owns each frame
   * and must `close()` it. Resolves when every requested timestamp has been delivered;
   * rejects promptly (closing this call's decoders) when `options.signal` aborts.
   */
  extract(timestampsInSeconds: readonly number[], onFrame: OnFrame, options?: ExtractOptions): Promise<void>;
  /** Aborts in-flight work and closes decoders. The extractor is unusable afterwards. */
  dispose(): void;
}

const MICROSECONDS = 1_000_000;

/** Two wanted byte runs closer than this are fetched as one. Small enough that the bytes in
 *  between are cheaper than the round trip they save, and far below the size at which merging
 *  would amount to downloading the file. */
const COALESCE_GAP_BYTES = 128 * 1024;

/** Index of the last element <= target in a sorted ascending array-like, or 0. */
function lastAtOrBefore(sorted: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid]! <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface GopJob {
  gopIndex: number;
  /** requested seconds grouped into this GOP, each resolved to a sample's presentation µs
   *  and its decode index (which bounds how much of the GOP has to be read at all) */
  targets: { requestedSeconds: number; presentationMicros: number; sampleIndex: number }[];
}

/**
 * Resolve `promise`, then fail if `signal` aborted while it settled. Every abortable
 * read must come through here: a read can settle with bytes in the same tick its
 * signal aborts, and abort events are not replayed, so any listener registered after
 * the await would never fire and downstream work would run against a dead signal.
 * (Explicit aborted/reason check, not throwIfAborted — Chrome 94–99 has WebCodecs
 * but not that method, and this also runs on signal-free paths.)
 */
async function resolveUnlessAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const value = await promise;
  if (signal.aborted) throw signal.reason;
  return value;
}

export async function createFrameExtractor(options: FrameExtractorOptions): Promise<FrameExtractor> {
  const abort = new AbortController();
  // dispose() and the caller's signal compose into one extractor-level signal.
  // AbortSignal.any covers a pre-aborted caller signal and detaches cleanly — a
  // manual listener on a long-lived caller signal would pin the internal
  // controller past dispose().
  const extractorSignal = options.signal ? AbortSignal.any([abort.signal, options.signal]) : abort.signal;
  const source: RangeSource = createUrlSource(options.src, options.fetchFn);
  const moovBytes = await resolveUnlessAborted(source.readThroughMoov(extractorSignal), extractorSignal);
  const table = parseSampleTable(moovBytes);
  const { presentationTicks, byteOffsets, byteSizes, keySampleIndices, timescale } = table;
  // Concurrent range requests to the *same* URL do not actually run concurrently. Measured
  // against the deployed demo: twelve in flight took 943 ms against one URL and 163 ms against
  // twelve distinct URLs, so they queue roughly one at a time behind the origin's cache lock.
  // Raising this alone buys nothing; see the whole-file path below for what to do about it.
  const maxParallel = options.maxParallelFetches ?? 8;

  // Presentation ticks of each GOP's keyframe — ascending, used to route a timestamp to its GOP.
  const gopStartTicks = new Float64Array(keySampleIndices.length);
  for (let i = 0; i < keySampleIndices.length; i++) gopStartTicks[i] = presentationTicks[keySampleIndices[i]!]!;
  // Max presentation tick, not the last decode-order sample: with B-frames the file's
  // final decoded sample presents *before* the last displayed frame, and clamping to it
  // would resolve past-end requests to the second-to-last displayed frame.
  const lastTicks = presentationTicks.reduce((max, ticks) => Math.max(max, ticks), 0);

  const toMicros = (ticks: number) => Math.round((ticks / timescale) * MICROSECONDS);

  const nearestSampleInGop = (gopIndex: number, targetTicks: number): number => {
    const first = keySampleIndices[gopIndex]!;
    const end = gopIndex + 1 < keySampleIndices.length ? keySampleIndices[gopIndex + 1]! : table.sampleCount;
    let best = first;
    for (let i = first; i < end; i++) {
      if (Math.abs(presentationTicks[i]! - targetTicks) < Math.abs(presentationTicks[best]! - targetTicks)) best = i;
    }
    return best;
  };

  /** Byte run a job needs: its GOP's keyframe through the deepest sample any of its targets wants.
   *  Samples are fed in decode order and every reference precedes its dependents there, so nothing
   *  past that sample can be needed to decode it. A thumbnail near the front of a one-second GOP
   *  therefore costs a couple of frames rather than the whole GOP, on the wire and in decode time. */
  const jobRange = (job: GopJob): { start: number; end: number } => {
    const first = keySampleIndices[job.gopIndex]!;
    const last = job.targets.reduce((deepest, target) => Math.max(deepest, target.sampleIndex), first);
    return { start: byteOffsets[first]!, end: byteOffsets[last]! + byteSizes[last]! };
  };

  const decodeGop = async (job: GopJob, bytes: Uint8Array, bytesStart: number, onFrame: OnFrame, signal: AbortSignal): Promise<void> => {
    const first = keySampleIndices[job.gopIndex]!;
    const end = job.targets.reduce((deepest, target) => Math.max(deepest, target.sampleIndex), first) + 1;
    const rangeStart = bytesStart;

    // presentation µs → requested seconds still waiting on that frame
    const wanted = new Map<number, number[]>();
    for (const target of job.targets) {
      const list = wanted.get(target.presentationMicros) ?? [];
      list.push(target.requestedSeconds);
      wanted.set(target.presentationMicros, list);
    }

    await new Promise<void>((resolve, reject) => {
      const decoder = new VideoDecoder({
        output: (frame) => {
          const requesters = wanted.get(frame.timestamp);
          if (!requesters) {
            frame.close();
            return;
          }
          wanted.delete(frame.timestamp);
          for (let i = 0; i < requesters.length; i++) {
            // Last requester gets the frame itself; earlier ones get clones. Receiver closes all.
            onFrame(i === requesters.length - 1 ? frame : frame.clone(), requesters[i]!);
          }
          // Early resolve keeps GOP pipelining: the worker moves on while the
          // flush drains. The abort listener stays armed until the flush-side
          // close — the decoder can outlive this promise.
          if (wanted.size === 0) resolve();
        },
        error: reject,
      });
      const closeDecoder = () => {
        try {
          decoder.close();
        } catch {
          // already closed
        }
      };
      const onAbort = () => {
        // Close eagerly: a wedged decode never settles flush(), so waiting for
        // the flush-side close would leak the hardware decoder past the abort.
        closeDecoder();
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      const detach = () => signal.removeEventListener('abort', onAbort);
      try {
        decoder.configure({ codec: table.codec, description: table.description });
        for (let i = first; i < end; i++) {
          decoder.decode(
            new EncodedVideoChunk({
              type: i === first ? 'key' : 'delta',
              timestamp: toMicros(presentationTicks[i]!),
              data: bytes.subarray(byteOffsets[i]! - rangeStart, byteOffsets[i]! - rangeStart + byteSizes[i]!),
            }),
          );
        }
      } catch (error) {
        detach();
        closeDecoder();
        throw error;
      }
      // The decoder-lifecycle finally owns both the close and the listener
      // removal, so an abort can reach a still-open decoder even after the
      // early resolve above. Aborting closes the decoder, which settles a
      // pending flush, which runs this cleanup.
      decoder
        .flush()
        .then(() => {
          if (wanted.size > 0) reject(new Error(`decoder flushed with ${wanted.size} requested timestamps undelivered`));
        }, reject)
        .finally(() => {
          closeDecoder();
          detach();
        });
    });
  };

  const resolveTarget = (seconds: number): { gopIndex: number; presentationMicros: number; sampleIndex: number } => {
    const targetTicks = Math.min(Math.max(seconds * timescale, gopStartTicks[0]!), lastTicks);
    const gopIndex = lastAtOrBefore(gopStartTicks, targetTicks);
    const sampleIndex = nearestSampleInGop(gopIndex, targetTicks);
    return { gopIndex, presentationMicros: toMicros(presentationTicks[sampleIndex]!), sampleIndex };
  };

  const extract: FrameExtractor['extract'] = async (timestampsInSeconds, onFrame, extractOptions) => {
    const signal = extractOptions?.signal ? AbortSignal.any([extractorSignal, extractOptions.signal]) : extractorSignal;
    if (signal.aborted) throw signal.reason;
    const byGop = new Map<number, GopJob>();
    for (const seconds of timestampsInSeconds) {
      const { gopIndex, presentationMicros, sampleIndex } = resolveTarget(seconds);
      const job = byGop.get(gopIndex) ?? { gopIndex, targets: [] };
      job.targets.push({ requestedSeconds: seconds, presentationMicros, sampleIndex });
      byGop.set(gopIndex, job);
    }

    // Reads that sit close together become one read. Concurrent ranges of a single URL serialize
    // at some origins, so each extra request can cost a whole round trip: measured against the
    // deployed demo, eight adjacent GOPs cost 323 ms as separate ranges and 42 ms as one, for
    // 14 KB of bytes nobody asked for. The gap is capped so this only ever merges neighbours —
    // the same eight GOPs spread across the file stay eight reads, because merging those would
    // mean pulling 3.5 MB to use 48 KB.
    const ranges = Array.from(byGop.values())
      .map((job) => ({ job, ...jobRange(job) }))
      .sort((a, b) => a.start - b.start);

    const spans: { start: number; end: number; jobs: GopJob[] }[] = [];
    for (const range of ranges) {
      const open = spans[spans.length - 1];
      if (open && range.start - open.end <= COALESCE_GAP_BYTES) {
        open.end = Math.max(open.end, range.end);
        open.jobs.push(range.job);
      } else {
        spans.push({ start: range.start, end: range.end, jobs: [range.job] });
      }
    }

    // Bounded parallelism without a scheduler dependency: N workers draining a shared queue.
    const queue = spans;
    const workers = Array.from({ length: Math.min(maxParallel, queue.length) }, async () => {
      for (let span = queue.shift(); span; span = queue.shift()) {
        const bytes = await resolveUnlessAborted(source.read(span.start, span.end, signal), signal);
        for (const job of span.jobs) await decodeGop(job, bytes, span.start, onFrame, signal);
      }
    });
    await Promise.all(workers);
  };

  return {
    sampleTable: table,
    durationSeconds: lastTicks / timescale,
    snapToSampleMicros: (seconds) => resolveTarget(seconds).presentationMicros,
    extract,
    dispose: () => abort.abort(new Error('frame extractor disposed')),
  };
}
