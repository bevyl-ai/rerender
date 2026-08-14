// Frame extraction: requested seconds → GOP byte ranges → VideoDecoder → VideoFrames.
// One decoder pass per GOP; samples are fed in decode (= file) order and matched to
// requested timestamps by presentation time. Never mutates the caller's timestamp array;
// out-of-range timestamps clamp; every requested timestamp gets exactly one frame callback.

import { decodeRun } from './decode';
import { ExtractError } from './errors';
import { mfraIndexAdapter } from './fmp4';
import { type FrameIndex, lastAtOrBefore } from './frame-index';
import { moovIndexAdapter } from './moov-index';
import { parseTrackConfig, type SampleTable } from './mp4-sample-table';
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
  signal?: AbortSignal | undefined;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch | undefined;
  /** Max GOP fetches in flight per extract() call. Default 16. */
  maxParallelFetches?: number | undefined;
}

export interface ExtractOptions {
  /** Cancels this call's fetches and decodes when aborted; the extractor stays usable. */
  signal?: AbortSignal | undefined;
}

export type OnFrame = (frame: VideoFrame, requestedSeconds: number) => void;

export interface FrameExtractor {
  /**
   * Which index the file turned out to carry.
   *
   * `'moov'` is a progressive file: one sample table for the whole thing, so every sample's time
   * and size is known up front. `'mfra'` is a fragmented one, where each fragment keeps its own
   * table and only the sync samples are known before a read. Everything below that says "exact for
   * moov, coarser for mfra" is keyed off this.
   */
  readonly indexKind: 'moov' | 'mfra';
  /**
   * The file's own sample table, or `null` when the index cannot state one.
   *
   * Null for `'mfra'`: a fragmented file's per-sample detail lives inside the fragments, and
   * materialising it would mean reading the whole file to answer a question nobody asked. It is
   * null rather than a table full of zeros, because a shape that type-checks and means something
   * else is worse than an absence you have to handle.
   */
  readonly sampleTable: SampleTable | null;
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
   * What {@link snapToSampleMicros} resolves to: `'sample'` when the index knows every sample —
   * and the returned value is then exactly the `VideoFrame.timestamp` `extract` will deliver — or
   * `'gop'` when it can only name the group's keyframe without a read, which is the fragmented
   * case. A cache keyed on the snapped value is exact in the first case and coarse in the second.
   */
  readonly snapGranularity: 'sample' | 'gop';
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

/** Two wanted byte runs closer than this are fetched as one: the bytes in between cost less than
 *  the round trip they save. */
const COALESCE_GAP_BYTES = 128 * 1024;

/** How many unwanted bytes one merged read may accumulate before it is split. The gap rule alone
 *  bounds each step, not the total — sixteen thumbnails 100 KB apart chain into one span covering
 *  the lot, which on the demo rendition meant pulling 59% of the file. This is the actual ceiling
 *  on waste, and it is per read, so it does not grow with how much of the video is on screen. */
const COALESCE_WASTE_BUDGET_BYTES = 384 * 1024;

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

/**
 * Every index shape this build can read. The first to claim a file gets it; adding a shape — a
 * WebM `Cues` table, a DASH `sidx` — is adding a row, and the extractor below never learns which
 * one answered.
 */
const INDEX_ADAPTERS = [moovIndexAdapter, mfraIndexAdapter] as const;

interface GopJob {
  gopIndex: number;
  targets: { requestedSeconds: number; targetTicks: number }[];
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
  const config = parseTrackConfig(moovBytes);

  const adapter = INDEX_ADAPTERS.find((candidate) => candidate.claims(config));
  if (!adapter) {
    throw new ExtractError('malformed', `mp4: no index adapter claims this file (fragmented: ${config.fragmented})`, { src: options.src });
  }
  const index: FrameIndex = await resolveUnlessAborted(adapter.open(source, moovBytes, config, extractorSignal), extractorSignal);

  // Reads of one URL used to queue behind each other, which made this number a formality — the
  // note here used to say raising it bought nothing. Since source.ts stopped contending for the
  // HTTP cache entry they were all waiting on, it is a real concurrency limit again, and 8 was
  // low enough to show: a 12-thumbnail filmstrip finished in two waves on production, reads at
  // t=402-590 and then t=554-713, the second wave being frames that waited for a slot rather
  // than for the network.
  // Math.min(0 | NaN | -1, n) feeds Array.from a length it treats as zero, which made extract()
  // resolve having fetched nothing — a blank filmstrip and no error, from `Number(env.X)` being NaN.
  const requestedParallel = options.maxParallelFetches ?? 16;
  const maxParallel = Number.isFinite(requestedParallel) ? Math.max(1, Math.floor(requestedParallel)) : 16;

  const decodeGop = async (job: GopJob, bytes: Uint8Array, bytesStart: number, onFrame: OnFrame, signal: AbortSignal): Promise<void> => {
    const targetTicks = job.targets.map((target) => target.targetTicks);
    const { run, micros } = index.resolve(job.gopIndex, targetTicks, bytes, bytesStart);

    // presentation µs → requested seconds still waiting on that frame
    const wanted = new Map<number, number[]>();
    job.targets.forEach((target, i) => {
      const ts = micros[i];
      if (ts === undefined) return;
      const list = wanted.get(ts) ?? [];
      list.push(target.requestedSeconds);
      wanted.set(ts, list);
    });

    // A codec with no out-of-band configuration gets no description; see CodecHandler.describes.
    const decoderConfig: VideoDecoderConfig = index.config.describes
      ? { codec: index.config.codec, description: index.config.description }
      : { codec: index.config.codec };
    await decodeRun(decoderConfig, run, bytes, bytesStart, wanted, onFrame, signal);
  };

  const extract: FrameExtractor['extract'] = async (timestampsInSeconds, onFrame, extractOptions) => {
    const signal = extractOptions?.signal ? AbortSignal.any([extractorSignal, extractOptions.signal]) : extractorSignal;
    if (signal.aborted) throw signal.reason;
    const byGop = new Map<number, GopJob>();
    for (const seconds of timestampsInSeconds) {
      const targetTicks = index.clampTicks(seconds);
      const gopIndex = lastAtOrBefore(index.gopStartTicks, targetTicks);
      const job = byGop.get(gopIndex) ?? { gopIndex, targets: [] };
      job.targets.push({ requestedSeconds: seconds, targetTicks });
      byGop.set(gopIndex, job);
    }

    // Reads that sit close together become one read. Concurrent ranges of a single URL serialize
    // at some origins, so each extra request can cost a whole round trip: measured against the
    // deployed demo, eight adjacent GOPs cost 323 ms as separate ranges and 42 ms as one, for
    // 14 KB of bytes nobody asked for. Two caps decide where merging stops — the gap, so a run
    // far from its neighbour is never dragged in, and the running total of unwanted bytes, so a
    // long chain of individually-cheap merges cannot add up to downloading the file.
    const ranges = Array.from(byGop.values())
      .map((job) => ({
        job,
        ...index.planRead(
          job.gopIndex,
          job.targets.map((target) => target.targetTicks),
        ),
      }))
      .sort((a, b) => a.start - b.start);

    const spans: { start: number; end: number; jobs: GopJob[]; wasted: number }[] = [];
    for (const range of ranges) {
      const open = spans[spans.length - 1];
      const gap = open ? range.start - open.end : 0;
      if (open && gap <= COALESCE_GAP_BYTES && open.wasted + Math.max(gap, 0) <= COALESCE_WASTE_BUDGET_BYTES) {
        open.wasted += Math.max(gap, 0);
        open.end = Math.max(open.end, range.end);
        open.jobs.push(range.job);
      } else {
        spans.push({ start: range.start, end: range.end, jobs: [range.job], wasted: 0 });
      }
    }

    // Bounded parallelism without a scheduler dependency: N workers draining a shared queue.
    //
    // Promise.all rejects on the first failure but cannot cancel: without this controller the
    // surviving workers drain the whole queue, issuing every remaining fetch and pushing frames
    // into onFrame long after the caller saw the rejection — at an owner that has already torn down.
    const failed = new AbortController();
    const callSignal = AbortSignal.any([signal, failed.signal]);
    const queue = spans;
    const workers = Array.from({ length: Math.min(maxParallel, queue.length) }, async () => {
      for (let span = queue.shift(); span; span = queue.shift()) {
        const bytes = await resolveUnlessAborted(source.read(span.start, span.end, callSignal), callSignal);
        for (const job of span.jobs) {
          if (callSignal.aborted) throw callSignal.reason;
          // Each job gets its OWN window of the span, not the whole span. An index that reads its
          // sample table out of the bytes — a fragmented file's, which lives in the moof at the
          // front of each fragment — would otherwise find the FIRST fragment in the merged buffer
          // and decode that one for every job sharing the span. Fragments abut exactly, so they
          // always merge, so that was every adjacent pair.
          const window = index.planRead(
            job.gopIndex,
            job.targets.map((target) => target.targetTicks),
          );
          await decodeGop(job, bytes.subarray(window.start - span.start, window.end - span.start), window.start, onFrame, callSignal);
        }
      }
    });
    try {
      await Promise.all(workers);
    } catch (error) {
      failed.abort(error);
      // Let the siblings unwind against the tripped signal before the rejection reaches the caller,
      // so no fetch or frame lands after it. Their rejections are already owned by Promise.all.
      await Promise.allSettled(workers);
      throw error;
    }
  };

  return {
    indexKind: index.kind,
    snapGranularity: index.kind === 'moov' ? 'sample' : 'gop',
    sampleTable: index.sampleTable,
    durationSeconds: index.durationSeconds,
    snapToSampleMicros: (seconds) => index.snapMicros(index.clampTicks(seconds)),
    extract,
    dispose: () => abort.abort(),
  };
}
