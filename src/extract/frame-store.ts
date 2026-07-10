// rerender/extract's batteries-included layer: a multi-subscriber frame store on top
// of createFrameExtractor. Owns per-src extractor lifecycle, snaps requests to the
// sample grid so cache keys are stable across request granularities, dedupes in-flight
// decodes, and fans each decoded frame out to every waiting subscriber. This is the
// layer a timeline-filmstrip consumer would otherwise rebuild.

import { type FrameExtractor, createFrameExtractor } from './extractor';
import { type ClosestCachedFrame, FrameCache } from './frame-cache';

const MICROSECONDS = 1_000_000;

const NOOP_CLEANUP = () => undefined;

const closeFrame = (frame: VideoFrame | null | undefined) => {
  if (!frame) {
    return;
  }

  try {
    frame.close();
  } catch {
    // Closing is best-effort. Browsers can throw if the frame is already closed.
  }
};

export interface FrameStore {
  subscribeToExtraction: (src: string, timestamps: number[], onFrame: (frame: VideoFrame) => void) => () => void;
  getClosestCachedFrame: (src: string, targetTimestamp: number) => ClosestCachedFrame | null;
  /**
   * The exact frame timestamp (µs) extraction delivers for a requested time —
   * the slot's frame identity — or null until the src's extractor has
   * resolved (before which nothing is cached for the src either). Fill
   * planners match on this instead of distance heuristics, so a slot is only
   * ever painted with the frame extraction targets for it.
   */
  snapToSampleMicros: (src: string, timestampMicros: number) => number | null;
  markCachedFrameUsed: (key: ClosestCachedFrame['key']) => void;
  pruneCachedFrames: () => void;
  dispose: () => void;
}

export interface FrameStoreOptions {
  /** Injectable for tests; defaults to the real createFrameExtractor factory. */
  createExtractor?: typeof createFrameExtractor;
}

export const createFrameStore = (options?: FrameStoreOptions): FrameStore => {
  const create = options?.createExtractor ?? createFrameExtractor;
  const frameCache = new FrameCache();
  /**
   * One extractor per src, created on first use and kept for the store's
   * lifetime. The extractor front-loads the file's sample table, so later
   * subscriptions with new timestamps are lookups + small ranged fetches —
   * there is no abort-restart cycle and nothing to re-parse.
   */
  const extractorsBySrc = new Map<string, Promise<FrameExtractor>>();
  /** Resolved extractors, for synchronous sample-grid lookups. */
  const readyExtractorsBySrc = new Map<string, FrameExtractor>();
  /**
   * Sample timestamps (µs) currently being decoded, per src, with the
   * subscribers waiting on each. Requests at different granularities snap to
   * the same sample grid, so without this a burst of staggered subscriptions
   * would decode the same GOP once per subscriber.
   */
  const pendingBySrc = new Map<string, Map<number, ((frame: VideoFrame) => void)[]>>();
  let disposed = false;

  const getExtractor = (src: string): Promise<FrameExtractor> => {
    const existing = extractorsBySrc.get(src);
    if (existing) {
      return existing;
    }

    const created = create({ src });
    created
      .then((extractor) => {
        if (!disposed) {
          readyExtractorsBySrc.set(src, extractor);
        }
      })
      .catch(() => {
        // Failed setup (network, malformed file) must not poison the src forever;
        // the next subscription retries. Slots stay unfilled meanwhile — the
        // consumer's owned degraded state (e.g. a filmstrip's background color
        // + later refill).
        extractorsBySrc.delete(src);
      });
    extractorsBySrc.set(src, created);
    return created;
  };

  const snapToSampleMicros = (src: string, timestampMicros: number): number | null => {
    const extractor = readyExtractorsBySrc.get(src);
    if (!extractor) {
      return null;
    }

    return extractor.snapToSampleMicros(timestampMicros / MICROSECONDS);
  };

  const subscribeToExtraction: FrameStore['subscribeToExtraction'] = (src, timestamps, onFrame) => {
    if (disposed) {
      return NOOP_CLEANUP;
    }

    let delivering = true;

    const deliver = (frame: VideoFrame) => {
      if (!delivering) {
        closeFrame(frame);
        return;
      }

      try {
        onFrame(frame);
      } finally {
        closeFrame(frame);
      }
    };

    getExtractor(src)
      .then((extractor) => {
        if (disposed) {
          return undefined;
        }

        // Requested timestamps are the caller's quantized slot targets; the
        // sample grid is the stable key space. Snapping first makes the cache
        // and the in-flight index actually hit across passes.
        const sampleMicros = new Set<number>();
        for (const timestamp of timestamps) {
          sampleMicros.add(extractor.snapToSampleMicros(timestamp / MICROSECONDS));
        }

        const pending = pendingBySrc.get(src) ?? new Map<number, ((frame: VideoFrame) => void)[]>();
        pendingBySrc.set(src, pending);

        const toExtract: number[] = [];

        for (const micros of sampleMicros) {
          const cached = frameCache.getExact(src, micros);
          if (cached) {
            frameCache.markUsed(cached.key);
            let clone: VideoFrame | null = null;
            try {
              clone = cached.frame.clone();
            } catch {
              // A dead cached frame (GPU context loss) misses; fall through to decode.
            }
            if (clone) {
              deliver(clone);
              continue;
            }
          }

          const waiters = pending.get(micros);
          if (waiters) {
            waiters.push(deliver);
            continue;
          }

          pending.set(micros, [deliver]);
          toExtract.push(micros);
        }

        if (toExtract.length === 0) {
          return undefined;
        }

        return extractor
          .extract(
            toExtract.map((micros) => micros / MICROSECONDS),
            (frame) => {
              // A frame can arrive after dispose() has cleared the cache and
              // torn down subscribers; caching it then would leak it (nothing
              // closes a cleared cache's late entries).
              if (disposed) {
                closeFrame(frame);
                return;
              }

              const waiters = pending.get(frame.timestamp) ?? [];
              pending.delete(frame.timestamp);

              try {
                frameCache.put({
                  src,
                  timestamp: frame.timestamp,
                  frame: frame.clone(),
                });
              } catch {
                // Cache insertion is an optimization; delivery still proceeds.
              }

              if (waiters.length === 0) {
                closeFrame(frame);
                return;
              }

              // Each waiter is isolated: one subscriber throwing (e.g. a bad
              // canvas draw) must not starve the others of the shared decode
              // or leak the frames still to be delivered.
              for (let i = 0; i < waiters.length; i++) {
                const isLast = i === waiters.length - 1;
                let toDeliver: VideoFrame | null = frame;
                if (!isLast) {
                  try {
                    toDeliver = frame.clone();
                  } catch {
                    continue;
                  }
                }
                try {
                  waiters[i]?.(toDeliver);
                } catch {
                  closeFrame(toDeliver);
                }
              }
            },
          )
          .finally(() => {
            // Normally all entries were consumed on delivery; after a decode
            // failure this clears the leftovers so a later subscription retries
            // instead of parking on a decode that will never arrive.
            for (const micros of toExtract) {
              pending.delete(micros);
            }
          });
      })
      .catch(() => {
        // Extraction failure leaves slots unfilled — the consumer's owned
        // degraded state. A later subscription (scroll, zoom) retries.
      });

    return () => {
      delivering = false;
    };
  };

  return {
    subscribeToExtraction,
    getClosestCachedFrame: (src, targetTimestamp) => frameCache.getClosest(src, targetTimestamp),
    snapToSampleMicros,
    markCachedFrameUsed: (key) => frameCache.markUsed(key),
    pruneCachedFrames: () => frameCache.pruneOld(),
    dispose: () => {
      disposed = true;
      for (const pending of extractorsBySrc.values()) {
        pending.then((extractor) => extractor.dispose()).catch(NOOP_CLEANUP);
      }
      extractorsBySrc.clear();
      readyExtractorsBySrc.clear();
      pendingBySrc.clear();
      frameCache.clear();
    },
  };
};
